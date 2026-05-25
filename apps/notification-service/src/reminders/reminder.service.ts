import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '@mediflow/database';
import { AppointmentStatus } from '@mediflow/database';
import { addDays, addMinutes, startOfDay, endOfDay, format } from 'date-fns';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  /**
   * Runs at 07:00 every day.
   * Finds appointments scheduled for tomorrow that haven't had a 24h reminder sent.
   */
  @Cron('0 7 * * *')
  async sendDailyReminders() {
    this.logger.log('Running daily 24h appointment reminder job...');

    const tomorrow = addDays(new Date(), 1);
    const tomorrowStart = startOfDay(tomorrow);
    const tomorrowEnd = endOfDay(tomorrow);

    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          status: {
            in: [AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING_PAYMENT],
          },
          confirmation24hSentAt: null,
          slot: {
            slotDate: {
              gte: tomorrowStart,
              lte: tomorrowEnd,
            },
          },
        },
        include: {
          patient: true,
          doctor: true,
          slot: true,
        },
      });

      this.logger.log(
        `Found ${appointments.length} appointments for 24h reminder.`,
      );

      for (const appointment of appointments) {
        try {
          const doctorName = `${appointment.doctor.firstName} ${appointment.doctor.lastName}`;
          const appointmentDate = format(
            appointment.slot.slotDate,
            'dd/MM/yyyy',
          );
          const appointmentTime = appointment.slot.startTime;

          await this.notificationsQueue.add(
            'send-whatsapp',
            {
              notificationLogId: `reminder-24h-${appointment.id}`,
              tenantId: appointment.tenantId,
              patientId: appointment.patientId,
              phone: appointment.patient.phone,
              notificationType: 'APPOINTMENT_REMINDER_24H',
              payload: {
                patientName: `${appointment.patient.firstName} ${appointment.patient.lastName ?? ''}`.trim(),
                doctorName,
                appointmentDate,
                appointmentTime,
                tokenNumber: appointment.tokenNumber,
                tenantId: appointment.tenantId,
                to: appointment.patient.phone,
                type: 'APPOINTMENT_REMINDER_24H',
                data: {
                  patientName: `${appointment.patient.firstName} ${appointment.patient.lastName ?? ''}`.trim(),
                  doctorName,
                  appointmentDate,
                  appointmentTime,
                  tokenNumber: String(appointment.tokenNumber),
                },
              },
            },
            {
              jobId: `24h-reminder-${appointment.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
            },
          );

          await this.prisma.appointment.update({
            where: { id: appointment.id },
            data: { confirmation24hSentAt: new Date() },
          });

          this.logger.log(
            `Queued 24h reminder for appointment ${appointment.id}`,
          );
        } catch (err: any) {
          this.logger.error(
            `Failed to queue 24h reminder for appointment ${appointment.id}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`sendDailyReminders failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Runs every 15 minutes.
   * Finds appointments scheduled between now+45min and now+75min that haven't had a 1h reminder.
   */
  @Cron('*/15 * * * *')
  async sendHourlyReminders() {
    this.logger.log('Running 1h appointment reminder check...');

    const now = new Date();
    const windowStart = addMinutes(now, 45);
    const windowEnd = addMinutes(now, 75);

    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          status: AppointmentStatus.CONFIRMED,
          reminder1hSentAt: null,
          slot: {
            slotDate: {
              gte: startOfDay(windowStart),
              lte: endOfDay(windowEnd),
            },
          },
        },
        include: {
          patient: true,
          doctor: true,
          slot: true,
        },
      });

      const eligible = appointments.filter((appt) => {
        const slotDateTime = this.buildSlotDateTime(
          appt.slot.slotDate,
          appt.slot.startTime,
        );
        return slotDateTime >= windowStart && slotDateTime <= windowEnd;
      });

      this.logger.log(`Found ${eligible.length} appointments for 1h reminder.`);

      for (const appointment of eligible) {
        try {
          const doctorName = `${appointment.doctor.firstName} ${appointment.doctor.lastName}`;
          const appointmentDate = format(
            appointment.slot.slotDate,
            'dd/MM/yyyy',
          );
          const appointmentTime = appointment.slot.startTime;

          await this.notificationsQueue.add(
            'send-whatsapp',
            {
              notificationLogId: `reminder-1h-${appointment.id}`,
              tenantId: appointment.tenantId,
              patientId: appointment.patientId,
              phone: appointment.patient.phone,
              notificationType: 'APPOINTMENT_REMINDER_1H',
              payload: {
                patientName: `${appointment.patient.firstName} ${appointment.patient.lastName ?? ''}`.trim(),
                doctorName,
                appointmentDate,
                appointmentTime,
                tokenNumber: String(appointment.tokenNumber),
                tenantId: appointment.tenantId,
                to: appointment.patient.phone,
                type: 'APPOINTMENT_REMINDER_1H',
                data: {
                  patientName: `${appointment.patient.firstName} ${appointment.patient.lastName ?? ''}`.trim(),
                  doctorName,
                  appointmentDate,
                  appointmentTime,
                  tokenNumber: String(appointment.tokenNumber),
                },
              },
            },
            {
              jobId: `1h-reminder-${appointment.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
            },
          );

          await this.prisma.appointment.update({
            where: { id: appointment.id },
            data: { reminder1hSentAt: new Date() },
          });

          this.logger.log(`Queued 1h reminder for appointment ${appointment.id}`);
        } catch (err: any) {
          this.logger.error(
            `Failed to queue 1h reminder for appointment ${appointment.id}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(
        `sendHourlyReminders failed: ${err.message}`,
        err.stack,
      );
    }
  }

  /**
   * Runs every 5 minutes.
   * Checks IN_PROGRESS appointments per doctor, finds patient 3 positions ahead in queue,
   * sends "your turn soon" alert if not already sent.
   */
  @Cron('*/5 * * * *')
  async sendQueueAlerts() {
    this.logger.log('Running queue position alert check...');

    try {
      const today = new Date();
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);

      const inProgressAppointments = await this.prisma.appointment.findMany({
        where: {
          status: AppointmentStatus.IN_PROGRESS,
          slot: {
            slotDate: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
        },
        include: {
          slot: true,
        },
      });

      const doctorIds = [
        ...new Set(inProgressAppointments.map((a) => a.doctorId)),
      ];

      for (const doctorId of doctorIds) {
        try {
          const inProgressAppt = inProgressAppointments.find(
            (a) => a.doctorId === doctorId,
          );
          if (!inProgressAppt) continue;

          const currentToken = inProgressAppt.tokenNumber;

          const upcomingAppointments = await this.prisma.appointment.findMany({
            where: {
              doctorId,
              tenantId: inProgressAppt.tenantId,
              status: AppointmentStatus.CHECKED_IN,
              tokenNumber: {
                gt: currentToken,
              },
              slot: {
                slotDate: {
                  gte: todayStart,
                  lte: todayEnd,
                },
              },
            },
            include: {
              patient: true,
              slot: true,
            },
            orderBy: { tokenNumber: 'asc' },
          });

          if (upcomingAppointments.length >= 3) {
            const targetAppointment = upcomingAppointments[2];

            const alreadyAlerted = await this.prisma.notificationLog.findFirst({
              where: {
                tenantId: targetAppointment.tenantId,
                patientId: targetAppointment.patientId,
                notificationType: 'QUEUE_ALERT',
                createdAt: {
                  gte: todayStart,
                },
                payload: {
                  path: ['appointmentId'],
                  equals: targetAppointment.id,
                },
              },
            });

            if (!alreadyAlerted) {
              await this.notificationsQueue.add(
                'send-whatsapp',
                {
                  notificationLogId: `queue-alert-${targetAppointment.id}`,
                  tenantId: targetAppointment.tenantId,
                  patientId: targetAppointment.patientId,
                  phone: targetAppointment.patient.phone,
                  notificationType: 'QUEUE_ALERT',
                  payload: {
                    patientName: `${targetAppointment.patient.firstName} ${targetAppointment.patient.lastName ?? ''}`.trim(),
                    tokenNumber: String(targetAppointment.tokenNumber),
                    currentToken: String(currentToken),
                    appointmentId: targetAppointment.id,
                    tenantId: targetAppointment.tenantId,
                    to: targetAppointment.patient.phone,
                    type: 'QUEUE_ALERT',
                    data: {
                      patientName: `${targetAppointment.patient.firstName} ${targetAppointment.patient.lastName ?? ''}`.trim(),
                      tokenNumber: String(targetAppointment.tokenNumber),
                      currentToken: String(currentToken),
                    },
                  },
                },
                {
                  jobId: `queue-alert-${targetAppointment.id}-${Date.now()}`,
                  attempts: 2,
                },
              );

              this.logger.log(
                `Queued QUEUE_ALERT for appointment ${targetAppointment.id} (token ${targetAppointment.tokenNumber}, current token ${currentToken})`,
              );
            }
          }
        } catch (err: any) {
          this.logger.error(
            `Queue alert failed for doctorId ${doctorId}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`sendQueueAlerts failed: ${err.message}`, err.stack);
    }
  }

  private buildSlotDateTime(slotDate: Date, startTime: string): Date {
    const [hours, minutes] = startTime.split(':').map(Number);
    const dt = new Date(slotDate);
    dt.setHours(hours, minutes, 0, 0);
    return dt;
  }
}
