import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma.service';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

interface ChatHistoryMessage {
  role?: string;
  parts?: string[];
  content?: string;
  text?: string;
}

/** Konteks percakapan yang diteruskan ke service AI (20 pasang tanya-jawab). */
const MAX_HISTORY_MESSAGES = 40;

export interface AiChatResponse {
  reply: string;
  toolsUsed: string[];
  [key: string]: unknown;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiBaseUrl: string;
  private readonly internalApiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {
    this.aiBaseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8001';
    this.internalApiKey = process.env.AI_INTERNAL_API_KEY || '';
  }

  async chat(
    message: string,
    history: ChatHistoryMessage[],
    token: string,
    user?: AuthenticatedUser,
  ): Promise<AiChatResponse> {
    if (user && !user.isSuperAdmin) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { aiTokens: true, aiTokensUsed: true },
      });

      if (!tenant || tenant.aiTokens - tenant.aiTokensUsed <= 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            message: 'Token AI toko habis. Hubungi admin untuk menambah token.',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    const url = `${this.aiBaseUrl}/chat`;
    const transformedHistory = (history || [])
      .map((msg: ChatHistoryMessage) => {
        // Frontend lama mengirim role 'model'; service AI hanya menerima
        // 'user'/'assistant', jadi normalisasi di sini.
        const role = msg.role === 'model' ? 'assistant' : msg.role;
        if (msg.parts) {
          return { ...msg, role };
        }
        return {
          role,
          parts: [msg.content || msg.text || ''],
        };
      })
      .slice(-MAX_HISTORY_MESSAGES);

    this.logger.log(`Proxying chat to AI service [user=${user?.username || 'unknown'}]: ${url}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post<AiChatResponse>(
          url,
          { message, history: transformedHistory },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-API-Key': this.internalApiKey,
              Authorization: `Bearer ${token}`,
            },
            timeout: 30000,
          },
        ),
      );

      return response.data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      const isAxiosError =
        typeof error === 'object' &&
        error !== null &&
        'isAxiosError' in error &&
        (error as AxiosError).isAxiosError;

      if (isAxiosError) {
        const axiosError = error as AxiosError<{ detail?: string; message?: string }>;

        this.logger.error(
          `AI service HTTP error [user=${user?.username || 'unknown'}]: ${axiosError.message}`,
          axiosError.response?.data || axiosError.stack,
        );

        if (axiosError.response) {
          const statusCode: number = axiosError.response.status;
          const errorData = axiosError.response.data;

          if (statusCode === HttpStatus.UNAUTHORIZED) {
            throw new BadGatewayException({
              statusCode: HttpStatus.BAD_GATEWAY,
              message: 'AI service authentication failed',
              detail: errorData?.detail || 'Invalid or missing credentials to AI service',
            });
          }

          throw new HttpException(
            {
              statusCode,
              message: errorData?.detail || errorData?.message || 'AI service error',
              data: errorData,
            },
            statusCode >= 100 && statusCode < 600 ? statusCode : HttpStatus.BAD_GATEWAY,
          );
        }
      } else {
        this.logger.error(
          `AI service internal error [user=${user?.username || 'unknown'}]: ${errorMessage}`,
          errorStack,
        );
      }

      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'AI service is unavailable or encountered an unexpected error',
      });
    }
  }
}
