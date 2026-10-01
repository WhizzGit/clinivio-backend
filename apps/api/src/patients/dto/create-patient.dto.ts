import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsDateString,
  IsBoolean,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, Language } from '@mediflow/database';

// Strips spaces/dashes/parens so numbers typed with human formatting
// (e.g. "+91 98765 43210") still pass the digits-only regex below.
function normalizePhone({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.replace(/[\s\-().]/g, '') : value;
}

export class CreatePatientDto {
  @ApiProperty() @IsString() @MinLength(1) firstName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?: string;
  @ApiProperty()
  @Transform(normalizePhone)
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizePhone)
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  whatsappPhone?: string;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  hasWhatsapp?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() familyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dob?: string;
  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() bloodGroup?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() abhaId?: string;
  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  preferredLanguage?: Language;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyContactName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;
}
