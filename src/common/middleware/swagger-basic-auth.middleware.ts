import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Swagger Basic Auth Middleware
 *
 * Melindungi endpoint dokumentasi (/api, /api-json) agar tidak bisa diakses
 * sembarang orang. Hanya user dengan kredensial yang benar yang boleh membuka
 * Swagger UI maupun OpenAPI spec.
 *
 * SECURITY:
 * - Kredensial diambil dari environment (SWAGGER_USER / SWAGGER_PASSWORD),
 *   TIDAK di-hardcode di source
 * - Perbandingan memakai timing-safe equal untuk cegah timing attack
 * - Jika kredensial tidak di-set, Swagger DI TUTUP TOTAL (fail-closed),
 *   bukan terbuka — mencegah dokumentasi bocor karena lupa konfigurasi
 */
@Injectable()
export class SwaggerBasicAuthMiddleware implements NestMiddleware {
  private readonly username: string | undefined = process.env.SWAGGER_USER;
  private readonly password: string | undefined = process.env.SWAGGER_PASSWORD;

  private isConfigured(): boolean {
    return Boolean(this.username && this.password);
  }

  /** Constant-time string comparison to avoid timing attacks. */
  private safeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);

    if (bufferA.length !== bufferB.length) {
      // Compare against self to keep timing uniform, then return false
      timingSafeEqual(bufferA, bufferA);
      return false;
    }
    return timingSafeEqual(bufferA, bufferB);
  }

  private parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
    if (!header || !header.startsWith('Basic ')) {
      return null;
    }

    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      if (separatorIndex === -1) {
        return null;
      }
      return {
        user: decoded.slice(0, separatorIndex),
        pass: decoded.slice(separatorIndex + 1),
      };
    } catch {
      return null;
    }
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    // Fail-closed: tanpa kredensial terkonfigurasi, Swagger dianggap tidak ada
    if (!this.isConfigured()) {
      throw new NotFoundException();
    }

    const credentials = this.parseBasicAuth(req.headers.authorization);

    if (
      !credentials ||
      !this.safeEquals(credentials.user, this.username!) ||
      !this.safeEquals(credentials.pass, this.password!)
    ) {
      throw new UnauthorizedException('Invalid Swagger credentials');
    }

    next();
  }
}
