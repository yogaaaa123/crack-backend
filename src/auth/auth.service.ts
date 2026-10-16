import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { CreateStoreDto } from './dto/create-store.dto';

const MAX_FAILED_ATTEMPTS = 5;

const LOCK_DURATION_MINUTES = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly ACCESS_TOKEN_EXPIRES = '15m';
  private readonly REFRESH_TOKEN_EXPIRES_DAYS = 7;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  private googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  async googleLogin(dto: GoogleLoginDto) {
    if (!process.env.GOOGLE_CLIENT_ID) {
      this.logger.error('GOOGLE_CLIENT_ID is not configured — Google login is disabled');
      throw new UnauthorizedException('Google login is not configured');
    }

    let ticket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch {
      // Expired, malformed or wrong-audience tokens must be a 401, not a 500.
      throw new UnauthorizedException('Invalid Google token');
    }

    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new UnauthorizedException('Invalid Google token');
    }

    let platformUser = await this.prisma.platformUser.findUnique({
      where: { email: payload.email },
    });

    if (!platformUser) {
      platformUser = await this.prisma.platformUser.create({
        data: {
          email: payload.email,
          name: payload.name || null,
          googleId: payload.sub,
        },
      });
      this.logger.log(`New platform user created: ${payload.email}`);
    }

    const memberships = await this.prisma.tenantMember.findMany({
      where: { platformUserId: platformUser.id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    const accessToken = this.jwtService.sign(
      {
        sub: platformUser.id,
        email: platformUser.email,
        isPlatformUser: true,
      },
      { expiresIn: '5m' },
    );

    return {
      accessToken,
      user: {
        id: platformUser.id,
        email: platformUser.email,
        name: platformUser.name,
      },
      needsStore: memberships.length === 0,
      stores: memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name })),
    };
  }

  /**
   * Stores owned by the platform (Google) user — used by the store picker.
   */
  async listStores(platformUserId: string) {
    const memberships = await this.prisma.tenantMember.findMany({
      where: { platformUserId },
      include: { tenant: { select: { id: true, name: true } } },
    });
    return memberships.map((m) => ({ id: m.tenant.id, name: m.tenant.name }));
  }

  /**
   * Exchange a platform (Google) JWT for a tenant session of a store the
   * platform user owns. Keeps the same Google account bound to its stores.
   */
  async selectStore(platformUserId: string, tenantId: string) {
    const membership = await this.prisma.tenantMember.findUnique({
      where: { platformUserId_tenantId: { platformUserId, tenantId } },
    });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this store');
    }

    const tenantUser = await this.prisma.tenantUser.findFirst({
      where: { tenantId, role: 'ADMIN', deletedAt: null },
    });
    if (!tenantUser) {
      throw new UnauthorizedException('No admin account is linked to this store');
    }

    const payload = {
      username: tenantUser.username,
      sub: tenantUser.id,
      role: tenantUser.role,
      tenantId: tenantUser.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES,
    });

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const hashedRefreshToken = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + this.REFRESH_TOKEN_EXPIRES_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: tenantUser.id,
        expiresAt: refreshExpiresAt,
      },
    });

    this.logger.log(`Platform user ${platformUserId} entered store ${tenantId}`);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: tenantUser.id,
        username: tenantUser.username,
        role: tenantUser.role,
        tenantId: tenantUser.tenantId,
      },
    };
  }

  async createStore(dto: CreateStoreDto, platformUserId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const slug = dto.storeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const existingSlug = await tx.tenant.findUnique({ where: { slug } });
      if (existingSlug) throw new ConflictException('Store name already registered');

      const existingUser = await tx.tenantUser.findFirst({ where: { username: dto.username } });
      if (existingUser) throw new ConflictException('Username already registered');

      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(dto.password, salt);

      const tenant = await tx.tenant.create({
        data: { name: dto.storeName, slug, aiTokens: 10000 },
      });
      const tenantUser = await tx.tenantUser.create({
        data: {
          username: dto.username,
          passwordHash,
          role: 'ADMIN',
          displayName: dto.displayName || dto.username,
          tenantId: tenant.id,
        },
      });
      await tx.tenantMember.create({
        data: { role: 'OWNER', platformUserId, tenantId: tenant.id },
      });

      return { tenant, tenantUser };
    });

    const payload = {
      sub: result.tenantUser.id,
      username: result.tenantUser.username,
      role: result.tenantUser.role,
      tenantId: result.tenant.id,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const hashedRefreshToken = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + this.REFRESH_TOKEN_EXPIRES_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: result.tenantUser.id,
        expiresAt: refreshExpiresAt,
      },
    });

    this.logger.log(`Store created: ${result.tenant.name} by platform user ${platformUserId}`);

    return {
      message: 'Store created successfully',
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: result.tenantUser.id,
        username: result.tenantUser.username,
        role: result.tenantUser.role,
        tenantId: result.tenant.id,
        storeName: result.tenant.name,
      },
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByUsernameOrEmail(loginDto.username);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.isAccountLocked(user.lockedUntil)) {
      const remainingMinutes = Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 60000);
      this.logger.warn(
        `Login blocked: user ${user.username} is locked for ${remainingMinutes} more minutes`,
      );
      throw new ForbiddenException(
        `Account is temporarily locked. Please try again in ${remainingMinutes} minutes.`,
      );
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);

    if (!isPasswordValid) {
      await this.incrementFailedAttempts(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.failedLoginAttempts > 0) {
      await this.prisma.tenantUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES,
    });

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const hashedRefreshToken = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + this.REFRESH_TOKEN_EXPIRES_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: user.id,
        expiresAt: refreshExpiresAt,
      },
    });

    this.logger.log(`User ${user.username} logged in successfully`);

    return {
      accessToken: access_token,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    const payload = {
      username: storedToken.user.username,
      sub: storedToken.user.id,
      role: storedToken.user.role,
      tenantId: storedToken.user.tenantId,
    };

    const newAccessToken = this.jwtService.sign(payload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES,
    });

    const newRawToken = crypto.randomBytes(40).toString('hex');
    const newHashedToken = crypto.createHash('sha256').update(newRawToken).digest('hex');
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + this.REFRESH_TOKEN_EXPIRES_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        token: newHashedToken,
        userId: storedToken.user.id,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawToken,
    };
  }

  async register(registerDto: RegisterDto) {
    const { storeName, username, email, password, displayName } = registerDto;

    const existingPlatformUser = await this.prisma.platformUser.findUnique({
      where: { email },
    });
    if (existingPlatformUser) {
      throw new ConflictException('Email sudah terdaftar');
    }

    const slug = storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    if (existingTenant) {
      throw new ConflictException('Nama toko sudah terdaftar');
    }

    const existingUsername = await this.prisma.tenantUser.findFirst({
      where: { username },
    });
    if (existingUsername) {
      throw new ConflictException('Username sudah terdaftar');
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await this.prisma.$transaction(async (tx) => {
      const platformUser = await tx.platformUser.create({
        data: {
          email,
          name: displayName || username,
          passwordHash,
        },
      });

      const tenant = await tx.tenant.create({
        data: {
          name: storeName,
          slug,
        },
      });

      await tx.tenantMember.create({
        data: {
          role: 'OWNER',
          platformUserId: platformUser.id,
          tenantId: tenant.id,
        },
      });

      const tenantUser = await tx.tenantUser.create({
        data: {
          username,
          passwordHash,
          role: 'ADMIN',
          displayName: displayName || username,
          tenantId: tenant.id,
        },
      });

      return { platformUser, tenant, tenantUser };
    });

    this.logger.log(
      `New registration: store="${result.tenant.name}", user="${result.tenantUser.username}"`,
    );

    const payload = {
      username: result.tenantUser.username,
      sub: result.tenantUser.id,
      role: result.tenantUser.role,
      tenantId: result.tenant.id,
    };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES,
    });

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const hashedRefreshToken = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + this.REFRESH_TOKEN_EXPIRES_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: result.tenantUser.id,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      message: 'Registrasi berhasil',
      accessToken: access_token,
      refreshToken: rawRefreshToken,
      user: {
        id: result.tenantUser.id,
        username: result.tenantUser.username,
        role: result.tenantUser.role,
        tenantId: result.tenant.id,
        storeName: result.tenant.name,
      },
    };
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`User ${userId} logged out, all refresh tokens revoked`);
    return { message: 'Logged out successfully' };
  }

  private isAccountLocked(lockedUntil: Date | null): boolean {
    if (!lockedUntil) return false;
    return new Date() < lockedUntil;
  }

  private async incrementFailedAttempts(userId: string): Promise<void> {
    const user = await this.prisma.tenantUser.findUnique({
      where: { id: userId },
      select: { id: true, failedLoginAttempts: true, lockedUntil: true },
    });

    if (!user) return;

    const newAttempts = user.failedLoginAttempts + 1;
    const lockedUntil =
      newAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
        : null;

    await this.prisma.tenantUser.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: newAttempts,
        lockedUntil,
      },
    });

    if (lockedUntil) {
      this.logger.warn(
        `Account ${userId} locked for ${LOCK_DURATION_MINUTES} minutes after ${newAttempts} failed attempts`,
      );
    }
  }
}
