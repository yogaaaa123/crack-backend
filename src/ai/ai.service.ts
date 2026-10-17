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

/**
 * Render free instances tidur setelah idle dan butuh ~40 detik untuk bangun,
 * jadi timeout-nya longgar dan request diulang sekali kalau koneksi gagal.
 */
const AI_REQUEST_TIMEOUT_MS = 90_000;
const AI_COLD_START_RETRY_DELAY_MS = 5_000;

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
    let aiTokensTotal = 0;
    let aiTokensRemaining = 0;

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

      aiTokensTotal = tenant.aiTokens;
      aiTokensRemaining = tenant.aiTokens - tenant.aiTokensUsed;
    }

    // Inject info kuota ke context supaya AI bisa menjawab pertanyaan
    // "sisa token berapa" dan menjelaskan limit saat layanan bermasalah.
    const quotaContext =
      user && !user.isSuperAdmin
        ? `\n\n[System info: kuota token AI toko ini sisa ${aiTokensRemaining} dari total ${aiTokensTotal}. `
          + 'Jika user bertanya soal sisa token/kuota AI, jawab dengan angka sisa ini. '
          + 'Jika user bertanya kenapa AI tidak bisa dipakai atau sedang error, jelaskan kemungkinan penyebabnya: '
          + '(1) kuota token AI toko habis sehingga diblokir sistem, '
          + '(2) provider model AI gratis (OpenRouter free tier) sedang limit rate atau sedang down sehingga permintaan gagal, '
          + '(3) server AI free hosting sempat sleep sehingga butuh beberapa detik untuk bangun. '
          + 'Jangan mengarang angka kuota selain yang diberikan di system info ini.]'
        : '';

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
      const response = await this.postWithColdStartRetry<AiChatResponse>(
        url,
        { message: `${message}${quotaContext}`, history: transformedHistory },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-API-Key': this.internalApiKey,
            Authorization: `Bearer ${token}`,
          },
          timeout: AI_REQUEST_TIMEOUT_MS,
        },
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

  /**
   * POST ke service AI dengan toleransi cold start.
   *
   * Instance free di Render tidur saat idle; request pertama bisa gagal
   * (connection reset / timeout / 502 / 503). Percobaan pertama tetap membangunkan
   * instance, jadi sekali ulang setelah jeda singkat biasanya sudah berhasil.
   */
  private async postWithColdStartRetry<T>(
    url: string,
    data: unknown,
    config: { headers: Record<string, string>; timeout: number },
  ) {
    try {
      return await firstValueFrom(this.httpService.post<T>(url, data, config));
    } catch (error: unknown) {
      if (!this.looksLikeColdStart(error)) {
        throw error;
      }
      this.logger.warn(
        `AI service looks asleep (${(error as AxiosError).code || 'no response'}) — waking it and retrying once`,
      );
      await new Promise((resolve) => setTimeout(resolve, AI_COLD_START_RETRY_DELAY_MS));
      return firstValueFrom(this.httpService.post<T>(url, data, config));
    }
  }

  private looksLikeColdStart(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('isAxiosError' in error)) {
      return false;
    }
    const axiosError = error as AxiosError;
    if (!axiosError.isAxiosError) {
      return false;
    }
    const status = axiosError.response?.status;
    return (
      !axiosError.response ||
      status === HttpStatus.BAD_GATEWAY ||
      status === HttpStatus.SERVICE_UNAVAILABLE ||
      axiosError.code === 'ECONNABORTED' ||
      axiosError.code === 'ECONNRESET' ||
      axiosError.code === 'ETIMEDOUT'
    );
  }
}
