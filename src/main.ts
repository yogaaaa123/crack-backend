import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import * as express from 'express';
import cookieParser from 'cookie-parser';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SwaggerBasicAuthMiddleware } from './common/middleware/swagger-basic-auth.middleware';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';

  const requiredVars: { name: string; value: string | undefined; weakDefaults: string[] }[] = [
    {
      name: 'JWT_SECRET',
      value: process.env.JWT_SECRET,
      weakDefaults: ['super-secret-dont-share-123', 'secret', 'changeme', ''],
    },
    { name: 'DATABASE_URL', value: process.env.DATABASE_URL, weakDefaults: [''] },
    { name: 'AI_INTERNAL_API_KEY', value: process.env.AI_INTERNAL_API_KEY, weakDefaults: [''] },
  ];

  let hasError = false;
  for (const envVar of requiredVars) {
    if (!envVar.value || envVar.weakDefaults.includes(envVar.value)) {
      logger.error(`❌ ${envVar.name} environment variable is not set or using an unsafe default!`);
      hasError = true;
    }
  }
  if (hasError) {
    logger.error('❌ Application startup aborted due to missing or unsafe environment variables.');
    process.exit(1);
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(cookieParser());

  const corsOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3001'];

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...corsOrigins],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      frameguard: { action: 'deny' },
      noSniff: true,
    }),
  );

  const corsOptions: CorsOptions = {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'x-refresh-token',
      'idempotency-key',
    ],
    credentials: true,
  };
  app.enableCors(corsOptions);

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new PrismaClientExceptionFilter(httpAdapter),
    new HttpExceptionFilter(),
    new AllExceptionsFilter(),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());

  const config = new DocumentBuilder()
    .setTitle('CrackPOS Inventory API')
    .setDescription(
      `
# 🔐 CrackPOS Inventory Management API

Enterprise-grade inventory management system dengan multi-tenant architecture.

## 📋 Features

- **Multi-Tenant Architecture** - Setiap toko memiliki data yang terisolasi
- **Role-Based Access Control** - Admin, Staff, Super Admin
- **HttpOnly Cookie Auth** - Secure authentication dengan JWT tokens
- **CSRF Protection** - Double-submit cookie pattern
- **Rate Limiting** - Protection against brute force attacks
- **Audit Logging** - Automatic activity tracking

## 🔑 Authentication

API ini menggunakan **HttpOnly Cookie-based Authentication**:

1. **Login:** \`POST /auth/login\` → Mendapatkan cookies \`auth_token\` dan \`refresh_token\`
2. **CSRF:** \`GET /auth/csrf-token\` → Mendapatkan CSRF token untuk mutations
3. **Protected Routes:** Cookies dikirim otomatis, tambahkan header \`X-CSRF-Token\` untuk POST/PUT/PATCH/DELETE

## 📚 Response Format

Semua response menggunakan format:
\`\`\`json
{
  "statusCode": 200,
  "message": "Success",
  "data": { ... },
  "timestamp": "2026-05-05T..."
}
\`\`\`

## 🚀 Rate Limits

- **Global:** 60 requests per 60 seconds per tenant
- **Auth endpoints:** 10 requests per 60 seconds per IP

## 📖 Quick Start

1. Register toko baru: \`POST /auth/register\`
2. Login: \`POST /auth/login\`
3. Get CSRF token: \`GET /auth/csrf-token\`
4. Use API dengan cookies + CSRF token

## 🛡️ Security

- Password di-hash dengan bcrypt (cost 12)
- Refresh token rotation
- Account locking setelah 5 failed attempts
- All mutations logged untuk audit trail
    `,
    )
    .setVersion('2.0.0')
    .setContact('CrackPOS Team', 'https://crackpos.com', 'support@crackpos.com')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer('http://localhost:8080', 'CrackPOS API')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT Authorization header (fallback untuk cookie auth)',
      },
      'bearer-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-CSRF-Token',
        in: 'header',
        description: 'CSRF token untuk POST/PUT/PATCH/DELETE requests',
      },
      'csrf-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);

  // Protect Swagger UI (/api) and OpenAPI spec (/api-json) with Basic Auth.
  // Credentials come from SWAGGER_USER / SWAGGER_PASSWORD env vars.
  // If unset, middleware fails closed → docs return 404 instead of staying public.
  const swaggerAuth = new SwaggerBasicAuthMiddleware();
  app.use('/api', swaggerAuth.use.bind(swaggerAuth));
  app.use('/api-json', swaggerAuth.use.bind(swaggerAuth));

  SwaggerModule.setup('api', app, document, {
    customCss: `
      .swagger-ui .topbar { background: #1a3a2a; padding: 14px 20px; display: block !important; }
      .swagger-ui .topbar .topbar-wrapper .topbar-logo { display: flex; align-items: center; gap: 10px; }
      .swagger-ui .topbar .topbar-wrapper a:first-child { display: flex; align-items: center; gap: 10px; }
      .swagger-ui .topbar .topbar-wrapper a span { color: #fff; font-size: 1.3rem; font-weight: 700; letter-spacing: -0.02em; }
      .swagger-ui .topbar .select-label { color: #94a3b8; font-size: 0.8rem; }
      .swagger-ui .topbar select { background: #2d5a40; color: #e2e8f0; border: 1px solid #3a7a50; border-radius: 6px; }
    `,
    customSiteTitle: 'CrackPOS API Docs',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      syntaxHighlight: { activate: true, theme: 'monokai' },
    },
  });

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger UI: http://localhost:${port}/api`);
  logger.log(`Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  logger.log(`Health check: http://localhost:${port}/health`);
}
void bootstrap();
