import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SwaggerBasicAuthMiddleware } from './swagger-basic-auth.middleware';

/**
 * Unit tests for Swagger Basic Auth middleware.
 *
 * Covers:
 * - Fail-closed: no credentials configured → 404 (docs hidden)
 * - Correct credentials → request passes through
 * - Wrong password / wrong user / malformed header → 401
 * - Missing Authorization header → 401
 * - Basic auth with colon in password (base64 parsing)
 */

const VALID_USER = 'swagger-admin';
const VALID_PASS = 'super-secret-password-123';

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function makeMiddleware(): SwaggerBasicAuthMiddleware {
  process.env.SWAGGER_USER = VALID_USER;
  process.env.SWAGGER_PASSWORD = VALID_PASS;
  return new SwaggerBasicAuthMiddleware();
}

function runMiddleware(
  middleware: SwaggerBasicAuthMiddleware,
  authHeader: string | undefined,
): { nextCalled: boolean; error?: unknown } {
  let nextCalled = false;
  const req = { headers: { authorization: authHeader } } as any;
  const res = {} as any;

  try {
    middleware.use(req, res, () => {
      nextCalled = true;
    });
    return { nextCalled };
  } catch (error) {
    return { nextCalled, error };
  }
}

describe('SwaggerBasicAuthMiddleware', () => {
  afterEach(() => {
    delete process.env.SWAGGER_USER;
    delete process.env.SWAGGER_PASSWORD;
  });

  describe('Fail-closed when not configured', () => {
    it('throws NotFoundException when both env vars are missing', () => {
      delete process.env.SWAGGER_USER;
      delete process.env.SWAGGER_PASSWORD;
      const middleware = new SwaggerBasicAuthMiddleware();

      const result = runMiddleware(middleware, basicHeader(VALID_USER, VALID_PASS));

      expect(result.nextCalled).toBe(false);
      expect(result.error).toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when only user is set', () => {
      process.env.SWAGGER_USER = VALID_USER;
      delete process.env.SWAGGER_PASSWORD;
      const middleware = new SwaggerBasicAuthMiddleware();

      const result = runMiddleware(middleware, basicHeader(VALID_USER, VALID_PASS));

      expect(result.error).toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when password is empty string', () => {
      process.env.SWAGGER_USER = VALID_USER;
      process.env.SWAGGER_PASSWORD = '';
      const middleware = new SwaggerBasicAuthMiddleware();

      const result = runMiddleware(middleware, basicHeader(VALID_USER, ''));

      expect(result.error).toBeInstanceOf(NotFoundException);
    });
  });

  describe('Valid credentials', () => {
    it('calls next() when user and password are correct', () => {
      const middleware = makeMiddleware();

      const result = runMiddleware(middleware, basicHeader(VALID_USER, VALID_PASS));

      expect(result.error).toBeUndefined();
      expect(result.nextCalled).toBe(true);
    });

    it('accepts a password containing a colon', () => {
      process.env.SWAGGER_USER = VALID_USER;
      process.env.SWAGGER_PASSWORD = 'pass:with:colons';
      const middleware = new SwaggerBasicAuthMiddleware();

      const result = runMiddleware(middleware, basicHeader(VALID_USER, 'pass:with:colons'));

      expect(result.nextCalled).toBe(true);
    });
  });

  describe('Invalid credentials', () => {
    it('throws UnauthorizedException on wrong password', () => {
      const middleware = makeMiddleware();

      const result = runMiddleware(middleware, basicHeader(VALID_USER, 'wrong-pass'));

      expect(result.nextCalled).toBe(false);
      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong user', () => {
      const middleware = makeMiddleware();

      const result = runMiddleware(middleware, basicHeader('hacker', VALID_PASS));

      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when Authorization header is missing', () => {
      const middleware = makeMiddleware();

      const result = runMiddleware(middleware, undefined);

      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException on non-Basic scheme (e.g. Bearer)', () => {
      const middleware = makeMiddleware();

      const result = runMiddleware(middleware, 'Bearer some-jwt-token');

      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException on malformed base64 payload', () => {
      const middleware = makeMiddleware();

      const result = runMiddleware(middleware, 'Basic not-valid-base64!!!');

      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when decoded value has no colon separator', () => {
      const middleware = makeMiddleware();
      const noColon = `Basic ${Buffer.from('userwithoutcolon').toString('base64')}`;

      const result = runMiddleware(middleware, noColon);

      expect(result.error).toBeInstanceOf(UnauthorizedException);
    });
  });
});
