import {
  IsString, IsOptional, IsBoolean, IsNumber, IsEnum, IsArray,
  IsUUID, ValidateNested, Min, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLabTestDto {
  @IsString() name: string;
  @IsString() code: string;
  @IsString() category: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() normalRange?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsNumber() @Min(1) turnaround?: number;
}

export class UpdateLabTestDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() normalRange?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsNumber() @Min(1) turnaround?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class LabOrderItemDto {
  @IsUUID() labTestId: string;
}

export class CreateLabOrderDto {
  @IsUUID() patientId: string;
  @IsOptional() @IsUUID() appointmentId?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LabOrderItemDto) items: LabOrderItemDto[];
  @IsOptional() @IsIn(['ROUTINE', 'URGENT', 'STAT']) priority?: string;
  @IsOptional() @IsString() clinicalNotes?: string;
  @IsOptional() @IsString() sampleType?: string;
}

export class CollectSampleDto {
  @IsOptional() @IsString() sampleType?: string;
}

export class EnterResultDto {
  @IsUUID() itemId: string;
  @IsString() result: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() normalRange?: string;
  @IsOptional() @IsEnum(['NORMAL', 'ABNORMAL', 'CRITICAL']) flag?: string;
  @IsOptional() @IsString() notes?: string;
}

export class EnterResultsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => EnterResultDto) results: EnterResultDto[];
}
