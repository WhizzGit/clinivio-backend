import {
  IsUUID, IsEnum, IsString, IsBoolean, IsOptional, IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentType, VisitType } from '@mediflow/database';

export class CreateAppointmentDto {
  @ApiProperty({ description: 'Patient ID (UUID)' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: 'Doctor (User) ID (UUID)' })
  @IsUUID()
  doctorId: string;

  @ApiPropertyOptional({ description: 'Doctor Slot ID — required for pre-scheduled appointments' })
  @IsOptional()
  @IsUUID()
  slotId?: string;

  @ApiPropertyOptional({ description: 'Department ID' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ enum: VisitType, default: VisitType.OPD, description: 'OPD (walk-in) or IPD (admission)' })
  @IsEnum(VisitType)
  @IsOptional()
  visitType?: VisitType;

  @ApiPropertyOptional({ enum: AppointmentType, description: 'In-Person / Video / Follow-Up' })
  @IsEnum(AppointmentType)
  @IsOptional()
  appointmentType?: AppointmentType;

  @ApiPropertyOptional({ description: 'Chief complaint / reason for visit' })
  @IsString()
  @IsOptional()
  chiefComplaint?: string;

  @ApiPropertyOptional({ description: 'Referring doctor / hospital name (external or internal)' })
  @IsString()
  @IsOptional()
  referredBy?: string;

  @ApiPropertyOptional({ description: 'Specialist / consultant whose opinion was sought' })
  @IsString()
  @IsOptional()
  opinionObtainedBy?: string;

  @ApiPropertyOptional({ description: 'true = payment collected at counter (status stays REGISTERED until billed)' })
  @IsBoolean()
  @IsOptional()
  payAtCounter?: boolean;

  @ApiPropertyOptional({ description: 'Scheduled date/time ISO 8601 — defaults to now if omitted' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
