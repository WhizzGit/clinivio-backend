import {
  IsString, IsOptional, IsNumber, IsInt, IsArray, IsBoolean,
  ValidateNested, Min, Max, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class VitalsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(60) @Max(250) bpSystolic?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(40) @Max(160) bpDiastolic?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(30) @Max(250) pulseRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(35) @Max(45) temperature?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(300) weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(30) @Max(250) heightCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(70) @Max(100) spo2?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(600) rbsMgDl?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(8) @Max(40) respiratoryRate?: number;
}

export class SaveConsultationDto {
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => VitalsDto) vitals?: VitalsDto;
  @ApiPropertyOptional() @IsOptional() @IsString() observations?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() icdCodes?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() doctorNotes?: string;
}

export class PrescriptionItemDto {
  @ApiProperty() @IsString() medicineName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() genericName?: string;
  @ApiProperty({ example: '500mg' }) @IsString() dosage: string;
  @ApiProperty({ example: '1-0-1' }) @IsString() frequency: string;
  @ApiProperty({ example: '5 days' }) @IsString() duration: string;
  @ApiPropertyOptional({ example: 'After food' }) @IsOptional() @IsString() instructions?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) quantity?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isSubstitutable?: boolean;
}

export class SavePrescriptionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];
}

export class CreateFollowUpDto {
  @ApiProperty({ example: '2026-06-15' }) @IsDateString() followUpDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
