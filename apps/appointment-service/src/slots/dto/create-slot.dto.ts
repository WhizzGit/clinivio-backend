import {
  IsUUID,
  IsDateString,
  IsString,
  IsInt,
  IsArray,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSlotDto {
  @ApiProperty({ description: 'Doctor profile ID (UUID)' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ description: 'Slot date in ISO format (YYYY-MM-DD)' })
  @IsDateString()
  slotDate: string;

  @ApiProperty({ description: 'Start time in HH:MM format', example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'startTime must be in HH:MM format' })
  startTime: string;

  @ApiProperty({ description: 'End time in HH:MM format', example: '09:30' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'endTime must be in HH:MM format' })
  endTime: string;

  @ApiProperty({ description: 'Duration in minutes (15-120)', minimum: 15, maximum: 120 })
  @IsInt()
  @Min(15)
  @Max(120)
  durationMinutes: number;

  @ApiProperty({ description: 'Maximum patients per slot (1-20)', minimum: 1, maximum: 20 })
  @IsInt()
  @Min(1)
  @Max(20)
  maxPatients: number;
}

export class CreateSlotsBulkDto {
  @ApiProperty({ description: 'Doctor profile ID (UUID)' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ description: 'Start date in ISO format (YYYY-MM-DD)' })
  @IsDateString()
  fromDate: string;

  @ApiProperty({ description: 'End date in ISO format (YYYY-MM-DD)' })
  @IsDateString()
  toDate: string;

  @ApiProperty({
    description: 'Days of week to create slots for',
    type: [String],
    example: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  })
  @IsArray()
  @IsString({ each: true })
  daysOfWeek: string[];

  @ApiProperty({ description: 'Daily start time in HH:MM format', example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'startTime must be in HH:MM format' })
  startTime: string;

  @ApiProperty({ description: 'Daily end time in HH:MM format', example: '17:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'endTime must be in HH:MM format' })
  endTime: string;

  @ApiProperty({ description: 'Slot duration in minutes', minimum: 15 })
  @IsInt()
  @Min(15)
  durationMinutes: number;

  @ApiProperty({ description: 'Maximum patients per slot', minimum: 1 })
  @IsInt()
  @Min(1)
  maxPatients: number;
}

export class BlockSlotDto {
  @ApiPropertyOptional({ description: 'Reason for blocking the slot' })
  @IsString()
  reason: string;
}
