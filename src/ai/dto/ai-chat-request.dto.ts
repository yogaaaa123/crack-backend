import {
  IsString,
  IsArray,
  IsOptional,
  MinLength,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AiChatHistoryMessage {
  @ApiPropertyOptional({
    example: 'user',
    description: 'Role of the message sender: "user" or "model"',
  })
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({
    example: ['Hello, how can you help me?'],
    description: 'Array of text parts for this message',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  parts?: string[];

  @ApiPropertyOptional({
    example: 'Hello, how can you help me?',
    description: 'Plain text content (alternative to parts)',
  })
  @IsString()
  @IsOptional()
  content?: string;
}

export class AiChatRequestDto {
  @ApiProperty({
    example: 'Tampilkan produk yang stoknya mau habis',
    description: 'The user message to send to the AI (1–2000 characters)',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(1, { message: 'Message must not be empty' })
  @MaxLength(2000, { message: 'Message too long (max 2000 characters)' })
  message: string;

  @ApiPropertyOptional({
    type: [AiChatHistoryMessage],
    description: 'Optional chat history (max 40 messages) for maintaining conversation context',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiChatHistoryMessage)
  @ArrayMaxSize(40, { message: 'History too long (max 40 messages)' })
  @IsOptional()
  history?: AiChatHistoryMessage[];
}
