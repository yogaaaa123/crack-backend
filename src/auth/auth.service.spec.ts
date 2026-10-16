import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma.service';

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

const createMockUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-uuid-1',
  username: 'admin1',
  email: 'admin@example.com',
  role: 'ADMIN',
  passwordHash: '',
  deletedAt: null,
  tenantId: 'tenant-uuid-1',
  failedLoginAttempts: 0,
  lockedUntil: null,
  ...overrides,
});

const mockUsersService = () => ({
  findByUsername: jest.fn(),
  findByUsernameOrEmail: jest.fn(),
});

const mockJwtService = () => ({
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
});

const mockPrismaService = () => ({
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  tenantUser: {
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  platformUser: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
  tenantMember: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('AuthService', () => {
  let service: AuthService;
  let usersService: ReturnType<typeof mockUsersService>;
  let jwtService: ReturnType<typeof mockJwtService>;
  let prisma: ReturnType<typeof mockPrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useFactory: mockUsersService },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: PrismaService, useFactory: mockPrismaService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    const loginDto = { username: 'admin1', password: 'password123' };

    it('should return accessToken and user on valid credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser = createMockUser({ passwordHash: hashedPassword });

      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      const result = await service.login(loginDto);

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.username).toBe('admin1');
      expect(result.user.role).toBe('ADMIN');
      expect(result.user.tenantId).toBe('tenant-uuid-1');
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          username: 'admin1',
          sub: 'user-uuid-1',
          role: 'ADMIN',
          tenantId: 'tenant-uuid-1',
        },
        expect.objectContaining({ expiresIn: expect.any(String) }),
      );
    });

    it('should throw UnauthorizedException when user not found', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      const hashedPassword = await bcrypt.hash('correctpassword', 10);
      const mockUser = createMockUser({ passwordHash: hashedPassword });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should return same error for wrong username and wrong password', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(null);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');

      const hashedPassword = await bcrypt.hash('differentpassword', 10);
      usersService.findByUsernameOrEmail.mockResolvedValue(
        createMockUser({ passwordHash: hashedPassword }),
      );
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should create a refresh token on successful login', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser = createMockUser({ passwordHash: hashedPassword });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      await service.login(loginDto);

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-uuid-1',
            token: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should hash the refresh token before storing (SHA-256)', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser = createMockUser({ passwordHash: hashedPassword });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      const result = await service.login(loginDto);

      expect(result.refreshToken).toHaveLength(80);
      const storedToken = prisma.refreshToken.create.mock.calls[0][0].data.token;
      expect(storedToken).toHaveLength(64);
      expect(storedToken).not.toBe(result.refreshToken);
      const expectedHash = crypto.createHash('sha256').update(result.refreshToken).digest('hex');
      expect(storedToken).toBe(expectedHash);
    });

    it('should reset failedLoginAttempts on successful login', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const mockUser = createMockUser({
        passwordHash: hashedPassword,
        failedLoginAttempts: 3,
      });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      await service.login(loginDto);

      expect(prisma.tenantUser.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });

    it('should block login when account is locked', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const lockedUntil = new Date(Date.now() + 20 * 60 * 1000);
      const mockUser = createMockUser({
        passwordHash: hashedPassword,
        failedLoginAttempts: 5,
        lockedUntil,
      });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });

    it('should allow login after lock period expires', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const lockedUntil = new Date(Date.now() - 5 * 60 * 1000);
      const mockUser = createMockUser({
        passwordHash: hashedPassword,
        failedLoginAttempts: 5,
        lockedUntil,
      });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      const result = await service.login(loginDto);
      expect(result.accessToken).toBe('mock.jwt.token');
    });

    it('should track failed attempts on wrong password', async () => {
      const hashedPassword = await bcrypt.hash('correctpassword', 10);
      const mockUser = createMockUser({
        passwordHash: hashedPassword,
        failedLoginAttempts: 0,
      });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);
      prisma.tenantUser.findUnique.mockResolvedValue(mockUser);

      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');

      expect(prisma.tenantUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid-1' },
          data: expect.objectContaining({ failedLoginAttempts: 1 }),
        }),
      );
    });

    it('should lock account after MAX_FAILED_ATTEMPTS', async () => {
      const hashedPassword = await bcrypt.hash('correctpassword', 10);
      const mockUser = createMockUser({
        passwordHash: hashedPassword,
        failedLoginAttempts: 0,
      });
      usersService.findByUsernameOrEmail.mockResolvedValue(mockUser);

      for (let i = 1; i <= 5; i++) {
        prisma.tenantUser.findUnique.mockResolvedValue({
          id: 'user-uuid-1',
          failedLoginAttempts: i - 1,
          lockedUntil: null,
        });
        await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
      }

      const lastCall = prisma.tenantUser.update.mock.calls[4][0];
      expect(lastCall.data.lockedUntil).toBeDefined();
      expect(lastCall.data.lockedUntil).toBeInstanceOf(Date);
    });
  });

  describe('refreshAccessToken', () => {
    const rawToken = 'valid-refresh-token-1234567890abcdef';
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const mockValidToken = {
      id: 'rt-1',
      token: hashedToken,
      userId: 'user-uuid-1',
      expiresAt: new Date(Date.now() + 86400000),
      revokedAt: null,
      user: {
        id: 'user-uuid-1',
        username: 'admin1',
        role: 'ADMIN',
        tenantId: 'tenant-uuid-1',
      },
    };

    it('should return new tokens when refresh token is valid', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(mockValidToken);

      const result = await service.refreshAccessToken(rawToken);

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBeDefined();
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('should hash incoming token before database lookup', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(mockValidToken);

      await service.refreshAccessToken(rawToken);

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { token: hashedToken } }),
      );
    });

    it('should throw UnauthorizedException when token does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshAccessToken('nonexistent')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when token is revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...mockValidToken,
        revokedAt: new Date(),
      });

      await expect(service.refreshAccessToken(rawToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token is expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...mockValidToken,
        expiresAt: new Date(Date.now() - 86400000),
      });

      await expect(service.refreshAccessToken(rawToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke all active refresh tokens for the user', async () => {
      const result = await service.logout('user-uuid-1');

      expect(result.message).toBe('Logged out successfully');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-uuid-1', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('googleLogin', () => {
    const dto = { idToken: 'valid-google-token' };

    beforeEach(() => {
      const googleClient = (service as any).googleClient;
      googleClient.verifyIdToken.mockReset();
      prisma.tenantMember.findMany.mockResolvedValue([]);
    });

    it('should flag needsStore for a Google account without stores', async () => {
      const googleClient = (service as any).googleClient;
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ email: 'fresh@example.com', name: 'Fresh', sub: 'google-sub-789' }),
      });
      prisma.platformUser.findUnique.mockResolvedValue({
        id: 'platform-uuid-3',
        email: 'fresh@example.com',
        name: 'Fresh',
      });

      const result = await service.googleLogin(dto);
      expect(result.needsStore).toBe(true);
      expect(result.stores).toEqual([]);
    });

    it('should list existing stores so the same Google account resumes them', async () => {
      const googleClient = (service as any).googleClient;
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ email: 'owner@example.com', name: 'Owner', sub: 'google-sub-999' }),
      });
      prisma.platformUser.findUnique.mockResolvedValue({
        id: 'platform-uuid-4',
        email: 'owner@example.com',
        name: 'Owner',
      });
      prisma.tenantMember.findMany.mockResolvedValue([
        { id: 'member-1', tenant: { id: 'tenant-1', name: 'Toko Satu' } },
      ]);

      const result = await service.googleLogin(dto);
      expect(result.needsStore).toBe(false);
      expect(result.stores).toEqual([{ id: 'tenant-1', name: 'Toko Satu' }]);
    });

    it('should create a new platform user and return accessToken', async () => {
      const googleClient = (service as any).googleClient;
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'new@example.com',
          name: 'New User',
          sub: 'google-sub-123',
        }),
      });
      prisma.platformUser.findUnique.mockResolvedValue(null);
      prisma.platformUser.create.mockResolvedValue({
        id: 'platform-uuid-1',
        email: 'new@example.com',
        name: 'New User',
        createdAt: new Date(),
      });
      jwtService.sign.mockReturnValue('mock.jwt.token');

      const result = await service.googleLogin(dto);
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user.email).toBe('new@example.com');
      expect(prisma.platformUser.create).toHaveBeenCalled();
    });

    it('should return existing platform user without creating new one', async () => {
      const googleClient = (service as any).googleClient;
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'existing@example.com',
          name: 'Existing User',
          sub: 'google-sub-456',
        }),
      });
      prisma.platformUser.findUnique.mockResolvedValue({
        id: 'platform-uuid-2',
        email: 'existing@example.com',
        name: 'Existing User',
      });

      const result = await service.googleLogin(dto);
      expect(result.user.email).toBe('existing@example.com');
      expect(prisma.platformUser.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when Google token is invalid', async () => {
      const googleClient = (service as any).googleClient;
      googleClient.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      await expect(service.googleLogin(dto)).rejects.toThrow(Error);
    });
  });

  describe('selectStore', () => {
    it('should issue tenant tokens for a store the platform user owns', async () => {
      prisma.tenantMember.findUnique.mockResolvedValue({ id: 'member-1', role: 'OWNER' });
      prisma.tenantUser.findFirst.mockResolvedValue(
        createMockUser({ id: 'tenant-user-1', username: 'admin1', tenantId: 'tenant-1' }),
      );
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.selectStore('platform-1', 'tenant-1');

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user).toMatchObject({ username: 'admin1', tenantId: 'tenant-1' });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('should reject stores the platform user does not belong to', async () => {
      prisma.tenantMember.findUnique.mockResolvedValue(null);

      await expect(service.selectStore('platform-1', 'other-tenant')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject when the store has no admin account', async () => {
      prisma.tenantMember.findUnique.mockResolvedValue({ id: 'member-1', role: 'OWNER' });
      prisma.tenantUser.findFirst.mockResolvedValue(null);

      await expect(service.selectStore('platform-1', 'tenant-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('register', () => {
    const registerDto = {
      storeName: 'New Store',
      username: 'newuser',
      email: 'new@example.com',
      password: 'Password123!',
      displayName: 'New User',
    };

    it('should register a new store and user successfully', async () => {
      prisma.platformUser.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenantUser.findFirst.mockResolvedValue(null);

      const mockTx = {
        platformUser: { create: jest.fn().mockResolvedValue({ id: 'pu-1', email: 'new@example.com' }) },
        tenant: { create: jest.fn().mockResolvedValue({ id: 't-1', name: 'New Store' }) },
        tenantMember: { create: jest.fn().mockResolvedValue({}) },
        tenantUser: { create: jest.fn().mockResolvedValue({ id: 'tu-1', username: 'newuser', role: 'ADMIN', tenantId: 't-1' }) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
      jwtService.sign.mockReturnValue('mock.jwt.token');
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.register(registerDto);
      expect(result.message).toBe('Registrasi berhasil');
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user.username).toBe('newuser');
    });

    it('should throw ConflictException when email is already registered', async () => {
      prisma.platformUser.findUnique.mockResolvedValue({ id: 'existing', email: 'new@example.com' });

      await expect(service.register(registerDto)).rejects.toThrow('Email sudah terdaftar');
    });

    it('should throw ConflictException when store name already exists', async () => {
      prisma.platformUser.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't-1', slug: 'new-store' });

      await expect(service.register(registerDto)).rejects.toThrow('Nama toko sudah terdaftar');
    });

    it('should throw ConflictException when username already exists', async () => {
      prisma.platformUser.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.tenantUser.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(service.register(registerDto)).rejects.toThrow('Username sudah terdaftar');
    });
  });

  describe('createStore', () => {
    const dto = {
      storeName: 'My Store',
      username: 'storeadmin',
      password: 'StrongPass1!',
      displayName: 'Store Admin',
    };

    it('should create store, tenant user, and return tokens', async () => {
      const mockTx = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 't-1', name: 'My Store' }),
        },
        tenantUser: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'tu-1', username: 'storeadmin', role: 'ADMIN', tenantId: 't-1' }),
        },
        tenantMember: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
      jwtService.sign.mockReturnValue('mock.jwt.token');
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.createStore(dto, 'platform-user-id');
      expect(result.message).toBe('Store created successfully');
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user.storeName).toBe('My Store');
    });

    it('should throw ConflictException when store slug already exists', async () => {
      const mockTx = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ id: 'existing', slug: 'my-store' }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await expect(service.createStore(dto, 'platform-user-id')).rejects.toThrow('Store name already registered');
    });

    it('should throw ConflictException when username already exists', async () => {
      const mockTx = {
        tenant: { findUnique: jest.fn().mockResolvedValue(null) },
        tenantUser: { findFirst: jest.fn().mockResolvedValue({ id: 'existing-user' }) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));

      await expect(service.createStore(dto, 'platform-user-id')).rejects.toThrow('Username already registered');
    });
  });
});
