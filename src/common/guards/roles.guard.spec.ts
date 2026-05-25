import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
      const context = createMockContext({ id: 1, role: ROLES.STAFF });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Super Admin access', () => {
    it('should allow access for super admin (isSuperAdmin flag)', () => {
      const user = { id: 1, role: ROLES.ADMIN, isSuperAdmin: true };
      const context = createMockContext(user, [ROLES.ADMIN]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access for super admin (role)', () => {
      const user = { id: 1, role: ROLES.SUPER_ADMIN };
      const context = createMockContext(user, [ROLES.ADMIN]);
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Role-based access', () => {
    it('should allow access when user has required role', () => {
      const user = { id: 1, role: ROLES.ADMIN };
      const context = createMockContext(user, [ROLES.ADMIN]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access when user has one of multiple required roles', () => {
      const user = { id: 1, role: ROLES.STAFF };
      const context = createMockContext(user, [ROLES.ADMIN, ROLES.STAFF]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException when user does not have required role', () => {
      const user = { id: 1, role: ROLES.STAFF };
      const context = createMockContext(user, [ROLES.ADMIN]);
      
      try {
        guard.canActivate(context);
        throw new Error('Should have thrown ForbiddenException');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toContain('You do not have permission to access this resource');
      }
    });

    it('should throw ForbiddenException when user is not authenticated', () => {
      const context = createMockContext(undefined, [ROLES.ADMIN]);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('User is not authenticated');
    });

    it('should throw ForbiddenException when user is null', () => {
      const context = createMockContext(null, [ROLES.ADMIN]);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(context)).toThrow('User is not authenticated');
    });
  });

  describe('Multiple roles', () => {
    it('should allow ADMIN when ADMIN or STAFF is required', () => {
      const user = { id: 1, role: ROLES.ADMIN };
      const context = createMockContext(user, [ROLES.ADMIN, ROLES.STAFF]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow STAFF when ADMIN or STAFF is required', () => {
      const user = { id: 1, role: ROLES.STAFF };
      const context = createMockContext(user, [ROLES.ADMIN, ROLES.STAFF]);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny CASHIER when ADMIN or STAFF is required', () => {
      const user = { id: 1, role: ROLES.CASHIER };
      const context = createMockContext(user, [ROLES.ADMIN, ROLES.STAFF]);
      
      try {
        guard.canActivate(context);
        throw new Error('Should have thrown ForbiddenException');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toContain('You do not have permission to access this resource');
      }
    });
  });
});
