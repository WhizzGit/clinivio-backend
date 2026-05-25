import { IsEmail, IsString, IsUUID, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@hospital.com' }) @IsEmail() email: string;
  @ApiProperty({ example: 'SecurePass123!' }) @IsString() @MinLength(6) password: string;
  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Required for all roles except SUPER_ADMIN' })
  @IsOptional() @IsUUID() tenantId?: string;
}
