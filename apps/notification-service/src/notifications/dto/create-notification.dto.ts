import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsUUID,
} from 'class-validator';
import { NotificationChannel } from '@mediflow/database';

export class CreateNotificationDto {
  @IsUUID()
  patientId: string;

  @IsString()
  phone: string;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsString()
  notificationType: string;

  @IsString()
  templateId: string;

  @IsObject()
  payload: Record<string, any>;

  @IsOptional()
  @IsString()
  scheduledAt?: string;
}
