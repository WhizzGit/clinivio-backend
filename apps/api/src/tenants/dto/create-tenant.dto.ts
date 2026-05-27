import { IsEmail, IsOptional, IsString, IsEnum, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionTier } from '@mediflow/database';

export class CreateTenantDto {
  @ApiProperty() @IsString() @MinLength(2) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pincode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gstin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() drugLicenseNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() whatsappPhoneNumberId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() wabaId?: string;
  @ApiPropertyOptional({ enum: SubscriptionTier, default: 'BASIC' })
  @IsOptional() @IsEnum(SubscriptionTier) subscriptionTier?: SubscriptionTier;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() registrationNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tagline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() printHeader?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pharmacyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() portalUrl?: string;
  @ApiProperty({ example: 'admin@hospital.com' }) @IsEmail() adminEmail: string;
  @ApiProperty() @IsString() @MinLength(8) adminPassword: string;
  @ApiProperty() @IsString() adminFirstName: string;
  @ApiProperty() @IsString() adminLastName: string;
  @ApiProperty({ example: '+919876543210' }) @IsString() @Matches(/^\+?[1-9]\d{9,14}$/) adminPhone: string;
}
