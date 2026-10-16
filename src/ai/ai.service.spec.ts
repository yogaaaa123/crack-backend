import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  HttpStatus,
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma.service';

describe('AiService', () => {
  let service: AiService;
  let httpService: HttpService;
  let prismaService: PrismaService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockPrismaService = {
    tenant: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    httpService = module.get<HttpService>(HttpService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('chat', () => {
    const mockUser = {
      id: 'user1',
      username: 'testuser',
      tenantId: 'tenant1',
      role: 'ADMIN' as any,
      isSuperAdmin: false,
    };

    it('should successfully send chat message to AI service', async () => {
      const mockResponse: AxiosResponse = {
        data: { reply: 'AI response', toolsUsed: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 1000,
        aiTokensUsed: 100,
      });
      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.chat('Hello', [], 'token123', mockUser);

      expect(result.reply).toBe('AI response');
      expect(mockHttpService.post).toHaveBeenCalled();
    });

    it('should throw PAYMENT_REQUIRED when tenant has no tokens', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 100,
        aiTokensUsed: 100,
      });

      await expect(service.chat('Hello', [], 'token123', mockUser)).rejects.toThrow(HttpException);
      await expect(service.chat('Hello', [], 'token123', mockUser)).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: HttpStatus.PAYMENT_REQUIRED,
        }),
      });
    });

    it('should allow super admin to chat without token check', async () => {
      const superAdminUser = { ...mockUser, isSuperAdmin: true };
      const mockResponse: AxiosResponse = {
        data: { reply: 'AI response', toolsUsed: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      await service.chat('Hello', [], 'token123', superAdminUser);

      expect(mockPrismaService.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('should transform history format correctly', async () => {
      const mockResponse: AxiosResponse = {
        data: { reply: 'AI response', toolsUsed: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', text: 'Hi there' },
      ];

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 1000,
        aiTokensUsed: 100,
      });
      mockHttpService.post.mockReturnValue(of(mockResponse));

      await service.chat('Test', history, 'token123', mockUser);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({ parts: expect.any(Array) }),
          ]),
        }),
        expect.any(Object),
      );
    });

    it('should handle AI service 401 Unauthorized error', async () => {
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Unauthorized',
        name: 'AxiosError',
        config: {} as any,
        response: {
          status: 401,
          data: { detail: 'Invalid credentials' },
          statusText: 'Unauthorized',
          headers: {},
          config: {} as any,
        },
        toJSON: () => ({}),
      };

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 1000,
        aiTokensUsed: 100,
      });
      mockHttpService.post.mockReturnValue(throwError(() => axiosError));

      await expect(service.chat('Hello', [], 'token123', mockUser)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('retries once when the AI service looks asleep (cold start)', async () => {
      jest.useFakeTimers();
      try {
        const coldStartError: AxiosError = {
          isAxiosError: true,
          message: 'socket hang up',
          name: 'AxiosError',
          code: 'ECONNRESET',
          config: {} as any,
          toJSON: () => ({}),
        };
        const mockResponse: AxiosResponse = {
          data: { reply: 'AI response after wake', toolsUsed: [] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        };

        mockPrismaService.tenant.findUnique.mockResolvedValue({
          aiTokens: 1000,
          aiTokensUsed: 100,
        });
        mockHttpService.post
          .mockReturnValueOnce(throwError(() => coldStartError))
          .mockReturnValueOnce(of(mockResponse));

        const pending = service.chat('Hello', [], 'token123', mockUser);
        await jest.advanceTimersByTimeAsync(5000);
        const result = await pending;

        expect(result.reply).toBe('AI response after wake');
        expect(mockHttpService.post).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not retry when the AI service returns a real error', async () => {
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Bad Request',
        name: 'AxiosError',
        config: {} as any,
        response: {
          status: 400,
          data: { detail: 'invalid tool call' },
          statusText: 'Bad Request',
          headers: {},
          config: {} as any,
        },
        toJSON: () => ({}),
      };

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 1000,
        aiTokensUsed: 100,
      });
      mockHttpService.post.mockReturnValue(throwError(() => axiosError));

      await expect(service.chat('Hello', [], 'token123', mockUser)).rejects.toThrow(HttpException);
      expect(mockHttpService.post).toHaveBeenCalledTimes(1);
    });

    it('should handle AI service HTTP errors', async () => {
      const axiosError: AxiosError = {
        isAxiosError: true,
        message: 'Bad Request',
        name: 'AxiosError',
        config: {} as any,
        response: {
          status: 400,
          data: { detail: 'Invalid request' },
          statusText: 'Bad Request',
          headers: {},
          config: {} as any,
        },
        toJSON: () => ({}),
      };

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 1000,
        aiTokensUsed: 100,
      });
      mockHttpService.post.mockReturnValue(throwError(() => axiosError));

      await expect(service.chat('Hello', [], 'token123', mockUser)).rejects.toThrow(HttpException);
    });

    it('should handle network errors', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 1000,
        aiTokensUsed: 100,
      });
      mockHttpService.post.mockReturnValue(throwError(() => new Error('Network error')));

      await expect(service.chat('Hello', [], 'token123', mockUser)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should handle empty history', async () => {
      const mockResponse: AxiosResponse = {
        data: { reply: 'AI response', toolsUsed: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockPrismaService.tenant.findUnique.mockResolvedValue({
        aiTokens: 1000,
        aiTokensUsed: 100,
      });
      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.chat('Hello', [], 'token123', mockUser);

      expect(result.reply).toBe('AI response');
    });

    it('should work without user (anonymous)', async () => {
      const mockResponse: AxiosResponse = {
        data: { reply: 'AI response', toolsUsed: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.chat('Hello', [], 'token123');

      expect(result.reply).toBe('AI response');
      expect(mockPrismaService.tenant.findUnique).not.toHaveBeenCalled();
    });
  });
});
