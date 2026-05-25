import {
  IsString, IsEmail, IsOptional, IsEnum, IsDateString,
  IsBoolean, IsUUID, Matches, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, Language } from '@prisma/client';

export class CreatePatientDto {
  @ApiProperty() @IsString() @MinLength(1) firstName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?: string;

  @ApiProperty({ example: '9876543210', description: "Patient's own phone number" })
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone: string;

  @ApiPropertyOptional({
    example: '9876543210',
    description: 'WhatsApp number to send notifications to (may be a guardian/family number)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  whatsappPhone?: string;

  @ApiPropertyOptional({ default: true, description: 'Whether the whatsappPhone has WhatsApp' })
  @IsOptional()
  @IsBoolean()
  hasWhatsapp?: boolean;

  @ApiPropertyOptional({ description: 'Family group ID — link to existing family for shared WhatsApp number' })
  @IsOptional()
  @IsUUID()
  familyId?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ example: '1990-01-15' }) @IsOptional() @IsDateString() dob?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional({ example: 'O+' }) @IsOptional() @IsString() bloodGroup?: string;
  @ApiPropertyOptional({ description: '14-digit ABHA number' }) @IsOptional() @IsString() abhaId?: string;
  @ApiPropertyOptional({ enum: Language }) @IsOptional() @IsEnum(Language) preferredLanguage?: Language;
  @ApiPropertyOptional() @IsOptional() @IsString() emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() emergencyContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() consentGiven?: boolean;
}
