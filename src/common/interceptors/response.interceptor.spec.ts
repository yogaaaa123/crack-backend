import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor<any>;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();

    const mockResponse = {
      statusCode: 200,
    };

    mockExecutionContext = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: jest.fn(),
      }),
      getClass: jest.fn(),
      getHandler: jest.fn(),
    } as unknown as ExecutionContext;

    mockCallHandler = {
      handle: jest.fn(),
    } as unknown as CallHandler;
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should wrap response data in standard format', (done) => {
    const testData = { id: 1, name: 'Test' };
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('timestamp');
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Success');
      expect(result.data).toEqual(testData);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      done();
    });
  });

  it('should handle array data', (done) => {
    const testData = [
      { id: 1, name: 'Test1' },
      { id: 2, name: 'Test2' },
    ];
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of(testData));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toEqual(testData);
      expect(Array.isArray(result.data)).toBe(true);
      done();
    });
  });

  it('should handle null data', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of(null));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toBeNull();
      expect(result.statusCode).toBe(200);
      done();
    });
  });

  it('should handle undefined data', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of(undefined));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toBeUndefined();
      expect(result.statusCode).toBe(200);
      done();
    });
  });

  it('should use correct status code from response', (done) => {
    const mockResponse = { statusCode: 201 };
    mockExecutionContext = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: jest.fn(),
      }),
      getClass: jest.fn(),
      getHandler: jest.fn(),
    } as unknown as ExecutionContext;

    (mockCallHandler.handle as jest.Mock).mockReturnValue(of({ created: true }));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.statusCode).toBe(201);
      done();
    });
  });

  it('should include ISO timestamp', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of({ test: 'data' }));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      const timestamp = new Date(result.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).not.toBeNaN();
      done();
    });
  });

  it('should handle empty object data', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of({}));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toEqual({});
      expect(result.message).toBe('Success');
      done();
    });
  });

  it('should handle string data', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of('test string'));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toBe('test string');
      done();
    });
  });

  it('should handle number data', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of(42));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toBe(42);
      done();
    });
  });

  it('should handle boolean data', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of(true));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toBe(true);
      done();
    });
  });
});
