import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES } from '../constants/roles.constant';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const createMockContext = (
    user: any,
    requiredRoles: string[] | undefined = undefined,
  ): ExecutionContext => {
    const mockRequest = { user };

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles);

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  };

  describe('No role requirements', () => {
    it('should allow access when no roles are required', () => {
      const context = createMockContext({ id: 1, role: TenantRole.STAFF });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Super Admin access', () => {
    it('should allow access for super admin (isSuperAdmin flag)', () => {
      const user = { id: 1, role: TenantRole.ADMIN, isSuperAdmin: true };
      const context = createMockContext(user, [TenantRole.ADMIN]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access for super admin (role)', () => {
      const user = { id: 1, role: ROLES.SUPER_ADMIN };
      const context = createMockContext(user, [TenantRole.ADMIN]);
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Role-based access', () => {
    it('should allow access when user has required role', () => {
      const user = { id: 1, role: TenantRole.ADMIN };
      const context = createMockContext(user, [TenantRole.ADMIN]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access when user has one of multiple required roles', () => {
      const user = { id: 1, role: TenantRole.STAFF };
      const context = createMockContext(user, [TenantRole.ADMIN, TenantRole.STAFF]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException when user does not have required role', () => {
      const user = { id: 1, role: TenantRole.STAFF };
      const context = createMockContext(user, [TenantRole.ADMIN]);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'You do not have permission to access this resource',
      );
    });

    it('should throw ForbiddenException when user is not authenticated', () => {
      const context = createMockContext(undefined, [TenantRole.ADMIN]);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('User is not authenticated');
    });

    it('should throw ForbiddenException when user is null', () => {
      const context = createMockContext(null, [TenantRole.ADMIN]);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('User is not authenticated');
    });
  });

  describe('Multiple roles', () => {
    it('should allow ADMIN when ADMIN or STAFF is required', () => {
      const user = { id: 1, role: TenantRole.ADMIN };
      const context = createMockContext(user, [TenantRole.ADMIN, TenantRole.STAFF]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow STAFF when ADMIN or STAFF is required', () => {
      const user = { id: 1, role: TenantRole.STAFF };
      const context = createMockContext(user, [TenantRole.ADMIN, TenantRole.STAFF]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny CASHIER when ADMIN or STAFF is required', () => {
      // CASHIER isn't in the TenantRole enum (only ADMIN/STAFF), but the JWT
      // payload role is a plain string — unknown/legacy roles must be denied.
      const cashierUser = { id: 1, role: 'CASHIER' };
      const context = createMockContext(cashierUser, [TenantRole.ADMIN, TenantRole.STAFF]);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow(
        'You do not have permission to access this resource',
      );
    });
  });
});
