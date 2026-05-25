import { TenantThrottlerGuard } from './tenant-throttler.guard';

describe('TenantThrottlerGuard', () => {
  let guard: TenantThrottlerGuard;

  beforeEach(() => {
    guard = new TenantThrottlerGuard(
      { ttl: 60, limit: 10 } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  describe('getTracker', () => {
    it('should return user tracker when user ID is present', async () => {
      const req = {
        user: { id: 'user123', tenantId: 'tenant456' },
        ip: '192.168.1.1',
      };
      const tracker = await guard['getTracker'](req);
      expect(tracker).toBe('user:user123');
    });

    it('should return tenant tracker when only tenant ID is present', async () => {
      const req = {
        user: { tenantId: 'tenant456' },
        ip: '192.168.1.1',
      };
      const tracker = await guard['getTracker'](req);
      expect(tracker).toBe('tenant:tenant456');
    });

    it('should return IP tracker when no user info is present', async () => {
      const req = {
        ip: '192.168.1.1',
      };
      const tracker = await guard['getTracker'](req);
      expect(tracker).toBe('ip:192.168.1.1');
    });

    it('should return IP tracker when user is undefined', async () => {
      const req = {
        user: undefined,
        ip: '10.0.0.1',
      };
      const tracker = await guard['getTracker'](req);
      expect(tracker).toBe('ip:10.0.0.1');
    });

    it('should prioritize user ID over tenant ID', async () => {
      const req = {
        user: { id: 'user123', tenantId: 'tenant456' },
        ip: '192.168.1.1',
      };
      const tracker = await guard['getTracker'](req);
      expect(tracker).toBe('user:user123');
      expect(tracker).not.toBe('tenant:tenant456');
    });

    it('should prioritize tenant ID over IP', async () => {
      const req = {
        user: { tenantId: 'tenant456' },
        ip: '192.168.1.1',
      };
      const tracker = await guard['getTracker'](req);
      expect(tracker).toBe('tenant:tenant456');
      expect(tracker).not.toBe('ip:192.168.1.1');
    });
  });
});
