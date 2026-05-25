import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '@mediflow/database';
import { NotificationChannel, NotificationStatus } from '@mediflow/database';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  async create(tenantId: string, dto: CreateNotificationDto) {
    const log = await this.prisma.notificationLog.create({
      data: {
        tenantId,
        patientId: dto.patientId,
        channel: dto.channel,
        notificationType: dto.notificationType,
        templateId: dto.templateId,
        payload: dto.payload as any,
        status: NotificationStatus.QUEUED,
      },
    });

    this.logger.log(
      `Created notification log ${log.id} for patient ${dto.patientId}`,
    );

    const jobName =
      dto.channel === NotificationChannel.WHATSAPP
        ? 'send-whatsapp'
        : 'send-sms';

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

  async updateStatus(
    wamid: string,
    status: NotificationStatus,
    timestamp: string,
  ) {
    const log = await this.prisma.notificationLog.findFirst({
      where: { wamid },
    });

    if (!log) {
      this.logger.warn(`NotificationLog not found for wamid: ${wamid}`);
      return null;
    }

    const updateData: any = { status };

    if (status === NotificationStatus.SENT) {
      updateData.sentAt = new Date(timestamp);
    } else if (status === NotificationStatus.DELIVERED) {
      updateData.deliveredAt = new Date(timestamp);
    } else if (status === NotificationStatus.READ) {
      updateData.readAt = new Date(timestamp);
    }

    return this.prisma.notificationLog.update({
      where: { id: log.id },
      data: updateData,
    });
  }

  async findByPatient(patientId: string, tenantId: string) {
    return this.prisma.notificationLog.findMany({
      where: { patientId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findById(id: string, tenantId: string) {
    const log = await this.prisma.notificationLog.findFirst({
      where: { id, tenantId },
    });
    if (!log) {
      throw new NotFoundException(`Notification log ${id} not found`);
    }
    return log;
  }

  async enqueueWithDelay(
    tenantId: string,
    dto: CreateNotificationDto,
    delayMs: number,
  ) {
    const log = await this.prisma.notificationLog.create({
      data: {
        tenantId,
        patientId: dto.patientId,
        channel: dto.channel,
        notificationType: dto.notificationType,
        templateId: dto.templateId,
        payload: dto.payload as any,
        status: NotificationStatus.QUEUED,
      },
    });

    const jobName =
      dto.channel === NotificationChannel.WHATSAPP
        ? 'send-whatsapp'
        : 'send-sms';

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

    this.logger.log(
      `Enqueued ${jobName} with delay ${delayMs}ms for notification ${log.id}`,
    );
    return log;
  }
}
