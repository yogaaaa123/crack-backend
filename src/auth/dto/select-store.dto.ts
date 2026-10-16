import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SelectStoreDto {
  @ApiProperty({ example: '3f1c8b1e-3f1c-4b1e-9f1c-3f1c8b1e3f1c' })
  @IsUUID()
  tenantId!: string;
}
