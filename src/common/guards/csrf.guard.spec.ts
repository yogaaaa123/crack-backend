import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new CsrfGuard(reflector);
  });

  const createMockContext = (
    method: string,
    cookies: Record<string, string> = {},
    headers: Record<string, string> = {},
    isPublic = false,
  ): ExecutionContext => {
    const mockRequest = {
      method,
      cookies,
      headers,
    };

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  };

  describe('Public routes', () => {
    it('should allow access to public routes', () => {
      const context = createMockContext('POST', {}, {}, true);
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Safe HTTP methods', () => {
    it('should allow GET requests without CSRF token', () => {
      const context = createMockContext('GET');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow HEAD requests without CSRF token', () => {
      const context = createMockContext('HEAD');
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow OPTIONS requests without CSRF token', () => {
      const context = createMockContext('OPTIONS');
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Unsafe HTTP methods', () => {
    it('should throw ForbiddenException when CSRF cookie is missing', () => {
      const context = createMockContext('POST', {}, { 'x-csrf-token': 'token123' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('CSRF token missing');
    });

    it('should throw ForbiddenException when CSRF header is missing', () => {
      const context = createMockContext('POST', { csrf_token: 'token123' }, {});
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('CSRF token missing');
    });

    it('should throw ForbiddenException when CSRF tokens do not match', () => {
      const context = createMockContext(
        'POST',
        { csrf_token: 'token123' },
        { 'x-csrf-token': 'token456' },
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('CSRF token mismatch');
    });

    it('should allow POST request when CSRF tokens match', () => {
      const context = createMockContext(
        'POST',
        { csrf_token: 'token123' },
        { 'x-csrf-token': 'token123' },
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow PUT request when CSRF tokens match', () => {
      const context = createMockContext(
        'PUT',
        { csrf_token: 'token123' },
        { 'x-csrf-token': 'token123' },
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow PATCH request when CSRF tokens match', () => {
      const context = createMockContext(
        'PATCH',
        { csrf_token: 'token123' },
        { 'x-csrf-token': 'token123' },
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow DELETE request when CSRF tokens match', () => {
      const context = createMockContext(
        'DELETE',
        { csrf_token: 'token123' },
        { 'x-csrf-token': 'token123' },
      );
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle lowercase method names', () => {
      const context = createMockContext(
        'post',
        { csrf_token: 'token123' },
        { 'x-csrf-token': 'token123' },
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should handle mixed case method names', () => {
      const context = createMockContext(
        'PoSt',
        { csrf_token: 'token123' },
        { 'x-csrf-token': 'token123' },
      );
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
