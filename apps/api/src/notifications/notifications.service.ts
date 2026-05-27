import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  NotificationLog,
  NotificationChannel,
  NotificationStatus,
} from '@mediflow/database';

export class CreateNotificationDto {
  patientId: string;
  phone: string;
  channel: NotificationChannel;
  notificationType: string;
  templateId?: string;
  payload: Record<string, any>;
  scheduledAt?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationLog)
    private notificationLogRepo: Repository<NotificationLog>,
    @InjectQueue('notifications')
    private notificationsQueue: Queue,
  ) {}

  async create(tenantId: string, dto: CreateNotificationDto) {
    const log = await this.notificationLogRepo.save(
      this.notificationLogRepo.create({
        tenantId,
        patientId: dto.patientId,
        channel: dto.channel,
        notificationType: dto.notificationType,
        templateId: dto.templateId ?? null,
        payload: dto.payload,
        status: NotificationStatus.QUEUED,
      }),
    );

    this.logger.log(`Created notification log ${log.id} for patient ${dto.patientId}`);

    const jobName =
      dto.channel === NotificationChannel.WHATSAPP ? 'send-whatsapp' : 'send-sms';

    const jobOptions: any = { jobId: log.id };
    if (dto.scheduledAt) {
      const delay = new Date(dto.scheduledAt).getTime() - Date.now();
      if (delay > 0) {
        jobOptions.delay = delay;
      }
    }

    await this.notificationsQueue.add(
      jobName,
      {
        notificationLogId: log.id,
        tenantId,
        patientId: dto.patientId,
        phone: dto.phone,
        notificationType: dto.notificationType,
        payload: dto.payload,
      },
      jobOptions,
    );

    this.logger.log(`Enqueued ${jobName} job for notification ${log.id}`);
    return log;
  }

  async updateStatus(wamid: string, status: NotificationStatus, timestamp: string) {
    const log = await this.notificationLogRepo
      .createQueryBuilder('log')
      .where('log.wamid = :wamid', { wamid })
      .getOne();

    if (!log) {
      this.logger.warn(`NotificationLog not found for wamid: ${wamid}`);
      return null;
    }

    const updateData: Partial<NotificationLog> = { status };

    if (status === NotificationStatus.SENT) {
      updateData.sentAt = new Date(timestamp);
    } else if (status === NotificationStatus.DELIVERED) {
      updateData.deliveredAt = new Date(timestamp);
    } else if (status === NotificationStatus.READ) {
      updateData.readAt = new Date(timestamp);
    }

    await this.notificationLogRepo.update(log.id, updateData);
    return this.notificationLogRepo.findOne({ where: { id: log.id } });
  }

  async findByPatient(patientId: string, tenantId: string) {
    return this.notificationLogRepo.find({
      where: { patientId, tenantId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async findById(id: string, tenantId: string) {
    const log = await this.notificationLogRepo.findOne({
      where: { id, tenantId },
    });
    if (!log) throw new NotFoundException(`Notification log ${id} not found`);
    return log;
  }

  async enqueueWithDelay(tenantId: string, dto: CreateNotificationDto, delayMs: number) {
    const log = await this.notificationLogRepo.save(
      this.notificationLogRepo.create({
        tenantId,
        patientId: dto.patientId,
        channel: dto.channel,
        notificationType: dto.notificationType,
        templateId: dto.templateId ?? null,
        payload: dto.payload,
        status: NotificationStatus.QUEUED,
      }),
    );

    const jobName =
      dto.channel === NotificationChannel.WHATSAPP ? 'send-whatsapp' : 'send-sms';

    await this.notificationsQueue.add(
      jobName,
      {
        notificationLogId: log.id,
        tenantId,
        patientId: dto.patientId,
        phone: dto.phone,
        notificationType: dto.notificationType,
        payload: dto.payload,
      },
      { delay: delayMs > 0 ? delayMs : 0, jobId: `delayed-${log.id}` },
    );

    this.logger.log(`Enqueued ${jobName} with delay ${delayMs}ms for notification ${log.id}`);
    return log;
  }

  async markFailed(id: string, reason: string) {
    await this.notificationLogRepo.update(id, {
      status: NotificationStatus.FAILED,
      failureReason: reason,
    });
    return this.notificationLogRepo.findOne({ where: { id } });
  }

  async markSent(id: string, wamid?: string) {
    await this.notificationLogRepo.update(id, {
      status: NotificationStatus.SENT,
      wamid: wamid ?? null,
      sentAt: new Date(),
    });
    return this.notificationLogRepo.findOne({ where: { id } });
  }
}
