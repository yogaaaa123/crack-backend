import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 90000,
      maxRedirects: 0,
    }),
    AuthModule,
    PrismaModule,
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
