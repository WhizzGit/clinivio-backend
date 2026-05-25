import { Injectable } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { AppointmentStatus } from '@mediflow/database';

@Injectable()
export class QueueService {
  constructor(private prisma: PrismaService) {}

  async getQueueStatus(doctorId: string, tenantId: string, date: string) {
    const slotDate = new Date(date);

    const [allAppointments, currentPatient] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          tenantId,
          doctorId,
          slot: { slotDate },
          status: {
            in: [
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.IN_PROGRESS,
              AppointmentStatus.COMPLETED,
            ],
          },
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              uhid: true,
            },
          },
          slot: true,
        },
        orderBy: { tokenNumber: 'asc' },
      }),
      this.prisma.appointment.findFirst({
        where: {
          tenantId,
          doctorId,
          status: AppointmentStatus.IN_PROGRESS,
          slot: { slotDate },
        },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              uhid: true,
            },
          },
        },
      }),
    ]);

    const waiting = allAppointments.filter(
      (a) =>
        a.status === AppointmentStatus.CONFIRMED ||
        a.status === AppointmentStatus.CHECKED_IN,
    );
    const completed = allAppointments.filter(
      (a) => a.status === AppointmentStatus.COMPLETED,
    );
    const checkedIn = allAppointments.filter(
      (a) => a.status === AppointmentStatus.CHECKED_IN,
    );

    return {
      date,
      doctorId,
      currentPatient,
      waitingCount: waiting.length,
      checkedInCount: checkedIn.length,
      completedCount: completed.length,
      totalBooked: allAppointments.length,
      queue: allAppointments,
    };
  }
}
