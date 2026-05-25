import {
  IsString, IsUUID, IsOptional, IsNumber, IsDateString,
  IsArray, ValidateNested, IsBoolean, Min, Max, IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AdmitPatientDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty() @IsUUID() attendingDoctorId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() appointmentId?: string;
  @ApiProperty() @IsUUID() roomId: string;
  @ApiProperty() @IsUUID() bedId: string;
  @ApiProperty() @IsString() admissionReason: string;
  @ApiPropertyOptional() @IsOptional() @IsString() referredBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() opinionObtainedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() estimatedDischargeAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class IPDVitalsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(60) @Max(250) @Type(() => Number) bpSystolic?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(40) @Max(160) @Type(() => Number) bpDiastolic?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(30) @Max(250) @Type(() => Number) pulseRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(34) @Max(42) @Type(() => Number) temperature?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(300) @Type(() => Number) weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(30) @Max(250) @Type(() => Number) heightCm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(70) @Max(100) @Type(() => Number) spo2?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(600) @Type(() => Number) rbsMgDl?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(5) @Max(60) @Type(() => Number) respiratoryRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class AddTreatmentDto {
  @ApiProperty() @IsString() treatmentName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateTreatmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() instructions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AddProcedureDto {
  @ApiProperty() @IsString() procedureName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() outcomes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complications?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() performedAt?: string;
}

export class SaveDischargeAdviceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() medications?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dietAdvice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() activityAdvice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() woundCare?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() otherAdvice?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() followUpDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() followUpNotes?: string;
}

export class SaveDischargeSummaryDto {
  @ApiProperty() @IsString() finalDiagnosis: string;
  @ApiProperty() @IsString() presentingComplaints: string;
  @ApiProperty() @IsString() treatmentSummary: string;
  @ApiPropertyOptional() @IsOptional() @IsString() proceduresDone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() investigationFindings?: string;
  @ApiProperty() @IsString() conditionAtDischarge: string;
}

export class DischargePatientDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
