import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { SelectStoreDto } from './dto/select-store.dto';
import { CreateStoreDto } from './dto/create-store.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PlatformJwtGuard } from '../common/guards/platform-jwt.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: '📝 Register toko baru',
    description: `
Mendaftarkan toko baru secara otomatis dengan fitur:

### 🔄 Auto-Create:
1. ✅ **Platform User** - Akun global untuk login/recovery
2. ✅ **Tenant** - Data toko baru dengan slug unik
3. ✅ **Tenant Member** - Relasi user sebagai OWNER
4. ✅ **Tenant User** - Admin toko dengan role ADMIN
5. ✅ **Auto Login** - HttpOnly cookies langsung di-set

### 🔒 Security Features:
- Password minimal 8 karakter (huruf besar, kecil, angka)
- Username hanya huruf/angka/underscore
- Email unique (tidak bisa daftar 2x)
- Nama toko unique
- Password di-hash bcrypt (cost 12)
- Transaksi atomik (gagal satu = gagal semua)

### ⚡ Rate Limit:
5 percobaan per 60 detik per IP
    `,
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      example1: {
        summary: 'Contoh registrasi toko',
        value: {
          storeName: 'Toko Sembako Makmur',
          username: 'admin_toko1',
          email: 'admin@tokosembako.com',
          password: 'SecurePass123',
          displayName: 'Admin Toko',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '✅ Registrasi berhasil',
    schema: {
      example: {
        statusCode: 201,
        message: 'Success',
        data: {
          message: 'Registrasi berhasil',
          user: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            username: 'admin_toko1',
            role: 'ADMIN',
            tenantId: '660e8400-e29b-41d4-a716-446655440001',
            storeName: 'Toko Sembako Makmur',
          },
        },
        timestamp: '2026-05-05T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '❌ Validation error - Password tidak memenuhi requirements',
  })
  @ApiResponse({
    status: 409,
    description: '⚠️ Conflict - Email/username/nama toko sudah terdaftar',
  })
  @ApiResponse({
    status: 429,
    description: '🚫 Too Many Requests - Rate limit exceeded',
  })
  async register(@Body() registerDto: RegisterDto, @Res({ passthrough: true }) res: any) {
    const result = await this.authService.register(registerDto);
    const cookieOpts = this.getCookieOptions();
    res.cookie('auth_token', result.accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', result.refreshToken, {
      ...cookieOpts,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { message: result.message, user: result.user };
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: 'Login via Google OAuth',
    description: 'Verify Google ID token and create/return platform user.',
  })
  @ApiBody({ type: GoogleLoginDto })
  @ApiResponse({ status: 200, description: 'Google login successful' })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  async googleLogin(
    @Body() dto: GoogleLoginDto,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.authService.googleLogin(dto);
    // Platform session cookie — lets /auth/create-store and /auth/platform/select-store
    // work right after Google login without exposing the token to JS.
    res.cookie('auth_token', result.accessToken, {
      ...this.getCookieOptions(),
      maxAge: 5 * 60 * 1000,
    });
    return result;
  }

  @Post('create-store')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PlatformJwtGuard)
  @Throttle({ auth: { ttl: 60000, limit: 3 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create store after Google login',
    description: 'Requires platform JWT from /auth/google.',
  })
  @ApiBody({ type: CreateStoreDto })
  @ApiResponse({ status: 201, description: 'Store created' })
  @ApiResponse({ status: 401, description: 'Invalid or missing platform JWT' })
  @ApiResponse({ status: 409, description: 'Store name or username already taken' })
  async createStore(
    @Body() dto: CreateStoreDto,
    @CurrentUser('id') platformUserId: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.authService.createStore(dto, platformUserId);
    const cookieOpts = this.getCookieOptions();
    res.cookie('auth_token', result.accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', result.refreshToken, {
      ...cookieOpts,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { message: result.message, user: result.user };
  }

  @Post('platform/select-store')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformJwtGuard)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Enter an existing store after Google login',
    description:
      'Exchanges the platform JWT (from /auth/google) for a tenant session of a store the Google account owns.',
  })
  @ApiBody({ type: SelectStoreDto })
  @ApiResponse({ status: 200, description: 'Tenant session created' })
  @ApiResponse({ status: 403, description: 'Platform user does not own this store' })
  async selectStore(
    @Body() dto: SelectStoreDto,
    @CurrentUser('id') platformUserId: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.authService.selectStore(platformUserId, dto.tenantId);
    const cookieOpts = this.getCookieOptions();
    res.cookie('auth_token', result.accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', result.refreshToken, {
      ...cookieOpts,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { user: result.user };
  }

  @Get('platform/stores')
  @UseGuards(PlatformJwtGuard)
  @Throttle({ auth: { ttl: 60000, limit: 20 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List stores owned by the Google account',
    description: 'Requires the platform JWT cookie/header from /auth/google.',
  })
  @ApiResponse({ status: 200, description: 'Stores owned by the platform user' })
  async listStores(@CurrentUser('id') platformUserId: string) {
    const stores = await this.authService.listStores(platformUserId);
    return { stores, needsStore: stores.length === 0 };
  }

  @Public()
  @Get('csrf-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🛡️ Get CSRF token',
    description: `
Mendapatkan CSRF token untuk proteksi terhadap Cross-Site Request Forgery.

### 🍪 Double-Submit Cookie Pattern:
1. Server mengirim CSRF token via cookie (non-HttpOnly)
2. Client membaca dari \`document.cookie\`
3. Client kirim via header \`X-CSRF-Token\` untuk mutations

### ⚙️ Kapan diperlukan?
CSRF token **WAJIB** untuk:
- ✅ POST requests
- ✅ PUT requests
- ✅ PATCH requests
- ✅ DELETE requests

### ❌ Tidak diperlukan untuk:
- GET requests
- HEAD requests
- OPTIONS requests
- Public endpoints (login, register, refresh)

### 💡 Usage:
\`\`\`javascript
// 1. Fetch CSRF token
const response = await fetch('/auth/csrf-token', { credentials: 'include' });
const { csrf_token } = await response.json();

// 2. Include in mutation requests
fetch('/products', {
  method: 'POST',
  headers: { 'X-CSRF-Token': csrf_token },
  credentials: 'include',
  body: JSON.stringify(data)
});
\`\`\`
    `,
  })
  @ApiResponse({
    status: 200,
    description: '✅ CSRF token generated',
    headers: {
      'Set-Cookie': {
        description: 'Non-HttpOnly CSRF token cookie',
        schema: {
          type: 'string',
          example: 'csrf_token=abc123...; Path=/; SameSite=Lax',
        },
      },
    },
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: { csrf_token: 'a1b2c3d4e5f6...' },
        timestamp: '2026-05-05T10:30:00.000Z',
      },
    },
  })
  getCsrfToken(@Res({ passthrough: true }) res: any) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    return { csrf_token: token };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: '🔑 User login',
    description: `
Login dengan username dan password untuk mendapatkan akses ke API.

### 🍪 Cookies yang di-set:
- **auth_token** - JWT access token (15 menit)
- **refresh_token** - Refresh token (7 hari)

### 📝 Cara Kerja:
1. Kirim \`username\` dan \`password\`
2. Server validasi kredensial
3. HttpOnly cookies otomatis di-set
4. Gunakan cookies untuk akses API

### 🔐 Default Accounts (untuk testing):
| Role | Username | Password |
|------|----------|----------|
| Admin | \`admin1\` | \`password123\` |
| Staff | \`staff1\` | \`password123\` |

### ⚠️ Rate Limit:
10 percoboan per 60 detik per IP

### 🚫 Account Locking:
Akun terkunci 30 menit setelah 5 failed attempts
    `,
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      example1: {
        summary: 'Login sebagai admin',
        value: {
          username: 'admin1',
          password: 'password123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '✅ Login berhasil - Cookies set',
    headers: {
      'Set-Cookie': {
        description: 'HttpOnly cookies for authentication',
        schema: {
          type: 'string',
          example: 'auth_token=eyJhbGc...; Path=/; HttpOnly; SameSite=Lax',
        },
      },
    },
    schema: {
      example: {
        statusCode: 200,
        message: 'Success',
        data: {
          user: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            username: 'admin1',
            role: 'ADMIN',
            tenantId: '660e8400-e29b-41d4-a716-446655440001',
          },
        },
        timestamp: '2026-05-05T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '❌ Unauthorized - Invalid credentials',
  })
  @ApiResponse({
    status: 403,
    description: '🔒 Forbidden - Account locked',
  })
  @ApiResponse({
    status: 429,
    description: '🚫 Too Many Requests - Rate limit exceeded',
  })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: any) {
    const result = await this.authService.login(loginDto);
    const cookieOpts = this.getCookieOptions();
    // Set HttpOnly cookies (primary auth method)
    res.cookie('auth_token', result.accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', result.refreshToken, {
      ...cookieOpts,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    // Expose tokens in response body for cross-domain proxying
    res.setHeader('X-Access-Token', result.accessToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token menggunakan refresh token',
    description: `
Kirim refresh_token yang valid untuk mendapatkan access_token baru.

**Cara kerja:**
1. Refresh token lama akan di-revoke (token rotation — security best practice)
2. Dapatkan access_token + refresh_token baru
3. Refresh token berlaku 7 hari

Rate limit: 5 requests per 60 detik.
    `,
  })
  @Throttle({ refresh: { ttl: 60000, limit: 5 } })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required in cookie');
    }
    const result = await this.authService.refreshAccessToken(refreshToken);
    const cookieOpts = this.getCookieOptions();
    res.cookie('auth_token', result.accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', result.refreshToken, {
      ...cookieOpts,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { message: 'Token refreshed' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout — revoke semua refresh token user',
    description: 'Revoke semua refresh token aktif untuk user yang sedang login.',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@CurrentUser('id') userId: string, @Res({ passthrough: true }) res: any) {
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return this.authService.logout(userId);
  }

  private getCookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
