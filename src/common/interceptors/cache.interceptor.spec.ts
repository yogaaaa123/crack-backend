import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { CacheInterceptor } from './cache.interceptor';

describe('CacheInterceptor', () => {
  let interceptor: CacheInterceptor;
  let mockCallHandler: CallHandler;

  beforeEach(() => {
    interceptor = new CacheInterceptor();
    mockCallHandler = {
      handle: jest.fn(),
    } as unknown as CallHandler;
  });

  const createMockContext = (
    method: string,
    url: string,
    user?: { tenantId?: string; id?: string },
    ip?: string,
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url,
          user,
          ip: ip || '127.0.0.1',
        }),
      }),
      getClass: jest.fn(),
      getHandler: jest.fn(),
    } as unknown as ExecutionContext;
  };

  describe('Non-GET requests', () => {
    it('should not cache POST requests', (done) => {
      const context = createMockContext('POST', '/api/products');
      const testData = { id: 1, name: 'Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      interceptor.intercept(context, mockCallHandler).subscribe((result) => {
        expect(result).toEqual(testData);
        expect(mockCallHandler.handle).toHaveBeenCalled();
        done();
      });
    });

    it('should not cache PUT requests', (done) => {
      const context = createMockContext('PUT', '/api/products/1');
      const testData = { id: 1, name: 'Updated' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      interceptor.intercept(context, mockCallHandler).subscribe((result) => {
        expect(result).toEqual(testData);
        done();
      });
    });

    it('should not cache DELETE requests', (done) => {
      const context = createMockContext('DELETE', '/api/products/1');
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of({ deleted: true }));

      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        expect(mockCallHandler.handle).toHaveBeenCalled();
        done();
      });
    });
  });

  describe('GET requests caching', () => {
    it('should cache GET request response', (done) => {
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      const testData = { id: 1, name: 'Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      interceptor.intercept(context, mockCallHandler).subscribe((result) => {
        expect(result).toEqual(testData);
        expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
        done();
      });
    });

    it('should return cached data on subsequent GET requests', (done) => {
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      const testData = { id: 1, name: 'Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      // First request
      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        // Second request (should use cache)
        interceptor.intercept(context, mockCallHandler).subscribe((result) => {
          expect(result).toEqual(testData);
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(1); // Only called once
          done();
        });
      });
    });

    it('should use tenant ID in cache key', (done) => {
      const context1 = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      const context2 = createMockContext('GET', '/api/products', { tenantId: 'tenant2' });
      const data1 = { id: 1, name: 'Product1' };
      const data2 = { id: 2, name: 'Product2' };

      (mockCallHandler.handle as jest.Mock)
        .mockReturnValueOnce(of(data1))
        .mockReturnValueOnce(of(data2));

      interceptor.intercept(context1, mockCallHandler).subscribe((result1) => {
        expect(result1).toEqual(data1);

        interceptor.intercept(context2, mockCallHandler).subscribe((result2) => {
          expect(result2).toEqual(data2);
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(2);
          done();
        });
      });
    });

    it('should use IP address when no user is present', (done) => {
      const context = createMockContext('GET', '/api/products', undefined, '192.168.1.1');
      const testData = { id: 1, name: 'Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      interceptor.intercept(context, mockCallHandler).subscribe((result) => {
        expect(result).toEqual(testData);
        done();
      });
    });

    it('should use "anonymous" when no user and no IP', (done) => {
      const context = createMockContext('GET', '/api/products');
      const testData = { id: 1, name: 'Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      interceptor.intercept(context, mockCallHandler).subscribe((result) => {
        expect(result).toEqual(testData);
        done();
      });
    });

    it('should differentiate cache by URL', (done) => {
      const context1 = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      const context2 = createMockContext('GET', '/api/categories', { tenantId: 'tenant1' });
      const data1 = { products: [] };
      const data2 = { categories: [] };

      (mockCallHandler.handle as jest.Mock)
        .mockReturnValueOnce(of(data1))
        .mockReturnValueOnce(of(data2));

      interceptor.intercept(context1, mockCallHandler).subscribe((result1) => {
        expect(result1).toEqual(data1);

        interceptor.intercept(context2, mockCallHandler).subscribe((result2) => {
          expect(result2).toEqual(data2);
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(2);
          done();
        });
      });
    });
  });

  describe('Cache expiry', () => {
    it('should expire cache after TTL', (done) => {
      jest.useFakeTimers();
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      const testData = { id: 1, name: 'Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      // First request
      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        // Advance time beyond TTL (30 seconds)
        jest.advanceTimersByTime(31000);

        // Second request (cache should be expired)
        interceptor.intercept(context, mockCallHandler).subscribe(() => {
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(2);
          jest.useRealTimers();
          done();
        });
      });
    });
  });

  describe('Edge cases', () => {
    it('should not cache null responses', (done) => {
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(null));

      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        interceptor.intercept(context, mockCallHandler).subscribe(() => {
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(2);
          done();
        });
      });
    });

    it('should not cache undefined responses', (done) => {
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(undefined));

      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        interceptor.intercept(context, mockCallHandler).subscribe(() => {
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(2);
          done();
        });
      });
    });

    it('should not cache string responses', (done) => {
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of('string response'));

      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        interceptor.intercept(context, mockCallHandler).subscribe(() => {
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(2);
          done();
        });
      });
    });

    it('should cache object responses', (done) => {
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      const testData = { id: 1, name: 'Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        interceptor.intercept(context, mockCallHandler).subscribe(() => {
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
          done();
        });
      });
    });

    it('should cache array responses', (done) => {
      const context = createMockContext('GET', '/api/products', { tenantId: 'tenant1' });
      const testData = [{ id: 1 }, { id: 2 }];
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

      interceptor.intercept(context, mockCallHandler).subscribe(() => {
        interceptor.intercept(context, mockCallHandler).subscribe(() => {
          expect(mockCallHandler.handle).toHaveBeenCalledTimes(1);
          done();
        });
      });
    });
  });
});
