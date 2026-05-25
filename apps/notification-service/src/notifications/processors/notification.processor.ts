import {
  Processor,
  Process,
  OnQueueFailed,
  OnQueueCompleted,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import axios from 'axios';
import { PrismaService } from '@mediflow/database';
import { NotificationStatus } from '@mediflow/database';

export interface WhatsAppJobData {
  notificationLogId: string;
  tenantId: string;
  patientId: string;
  phone: string;
  notificationType: string;
  payload: Record<string, any>;
}

export interface SmsJobData {
  notificationLogId: string;
  tenantId: string;
  patientId: string;
  phone: string;
  notificationType: string;
  payload: Record<string, any>;
}

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Process('send-whatsapp')
  async processWhatsApp(job: Job<WhatsAppJobData>) {
    const { notificationLogId, tenantId, phone, notificationType, payload } =
      job.data;

    this.logger.log(
      `Processing WhatsApp job ${job.id} for notification ${notificationLogId}`,
    );

    const whatsappEngineUrl = this.config.get<string>(
      'WHATSAPP_ENGINE_URL',
      'http://whatsapp-engine:3000',
    );

    try {
      const response = await axios.post(
        `${whatsappEngineUrl}/internal/send`,
        {
          tenantId,
          to: phone,
          type: notificationType,
          data: payload,
        },
        {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const wamid = response.data?.wamid ?? null;

      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: NotificationStatus.SENT,
          wamid,
          sentAt: new Date(),
        },
      });

      this.logger.log(
        `WhatsApp message sent successfully. wamid=${wamid}, log=${notificationLogId}`,
      );
      return { success: true, wamid };
    } catch (err: any) {
      this.logger.error(
        `WhatsApp send failed for log ${notificationLogId}: ${err.message}`,
      );

      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: NotificationStatus.FAILED,
          failureReason: err.message ?? 'Unknown error',
        },
      });

      throw err;
    }
  }

  @Process('send-sms')
  async processSms(job: Job<SmsJobData>) {
    const { notificationLogId, phone, notificationType, payload } = job.data;

    this.logger.log(
      `Processing SMS job ${job.id} for notification ${notificationLogId}`,
    );

    const msg91AuthKey = this.config.get<string>('MSG91_AUTH_KEY', '');
    const msg91SenderId = this.config.get<string>('MSG91_SENDER_ID', 'MDIFLW');

    if (!msg91AuthKey) {
      this.logger.warn('MSG91_AUTH_KEY not configured, skipping SMS send');
      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: NotificationStatus.FAILED,
          failureReason: 'MSG91_AUTH_KEY not configured',
        },
      });
      return { success: false };
    }

    try {
      const message = this.buildSmsMessage(notificationType, payload);

      const response = await axios.post(
        'https://api.msg91.com/api/v5/flow/',
        {
          template_id: notificationType,
          short_url: '0',
          recipients: [
            {
              mobiles: phone.replace('+', ''),
              ...payload,
            },
          ],
        },
        {
          headers: {
            authkey: msg91AuthKey,
            'Content-Type': 'application/JSON',
          },
          timeout: 15000,
        },
      );

      this.logger.log(
        `SMS sent successfully for log ${notificationLogId}: ${JSON.stringify(response.data)}`,
      );

      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });

      return { success: true };
    } catch (err: any) {
      this.logger.error(
        `SMS send failed for log ${notificationLogId}: ${err.message}`,
      );

      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: NotificationStatus.FAILED,
          failureReason: err.message ?? 'Unknown error',
        },
      });

      throw err;
    }
  }

  @OnQueueFailed()
  async onFailed(job: Job, err: Error) {
    const maxAttempts = job.opts?.attempts ?? 3;
    const attemptsMade = job.attemptsMade;

    this.logger.error(
      `Job ${job.id} (${job.name}) failed on attempt ${attemptsMade}/${maxAttempts}: ${err.message}`,
      err.stack,
    );

    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `Job ${job.id} exhausted all ${maxAttempts} attempts. Marking as permanently failed.`,
      );
      const data = job.data as WhatsAppJobData;
      if (data?.notificationLogId) {
        await this.prisma.notificationLog
          .update({
            where: { id: data.notificationLogId },
            data: {
              status: NotificationStatus.FAILED,
              failureReason: `Exhausted ${maxAttempts} attempts. Last error: ${err.message}`,
            },
          })
          .catch((e) => {
            this.logger.error(
              `Failed to update notification log on exhaustion: ${e.message}`,
            );
          });
      }
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(
      `Job ${job.id} (${job.name}) completed successfully: ${JSON.stringify(result)}`,
    );
  }

  private buildSmsMessage(
    notificationType: string,
    payload: Record<string, any>,
  ): string {
    switch (notificationType) {
      case 'APPOINTMENT_REMINDER_24H':
        return `Dear ${payload.patientName}, your appointment with Dr. ${payload.doctorName} is scheduled tomorrow at ${payload.appointmentTime}. Token: ${payload.tokenNumber}. - MediFlow`;
      case 'APPOINTMENT_REMINDER_1H':
        return `Dear ${payload.patientName}, your appointment with Dr. ${payload.doctorName} is in 1 hour at ${payload.appointmentTime}. Token: ${payload.tokenNumber}. - MediFlow`;
      case 'QUEUE_ALERT':
        return `Dear ${payload.patientName}, you are next in queue. Please proceed to the consultation room. - MediFlow`;
      default:
        return `Dear ${payload.patientName}, you have a notification from MediFlow. Please check the app for details.`;
    }
  }
}
