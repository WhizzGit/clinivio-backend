import {
  Injectable, ConflictException, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { AppointmentStatus, AppointmentType, VisitType } from '@mediflow/database';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { RazorpayService } from '../payments/razorpay.service';
import { KAFKA_TOPICS } from '@mediflow/shared';
import { v4 as uuidv4 } from 'uuid';

// Appointments are queried by their *scheduled* date, not when they were registered.
// For records created before scheduledAt was added, fall back to registeredAt.
function scheduledOnDate(from: Date, to: Date) {
  return {
    OR: [
      { scheduledAt: { gte: from, lt: to } },
      { scheduledAt: null, registeredAt: { gte: from, lt: to } },
    ] as any[],
  };
}

const APPOINTMENT_INCLUDE = {
  patient: {
    select: { id: true, firstName: true, lastName: true, phone: true, whatsappPhone: true, uhid: true, dob: true, gender: true },
  },
  doctor: {
    select: { id: true, firstName: true, lastName: true },
  },
  slot: true,
  department: { select: { id: true, name: true, code: true, color: true, icon: true } },
};

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private kafka: KafkaProducerService,
    private razorpay: RazorpayService,
  ) {}

  // Receptionist creates appointment: starts in REGISTERED status
  async create(tenantId: string, dto: CreateAppointmentDto) {
    let tokenNumber: number | undefined;
    let razorpayOrderId: string | undefined;

    // If slot provided, validate and reserve
    if (dto.slotId) {
      const slot = await this.prisma.doctorSlot.findFirst({
        where: { id: dto.slotId, tenantId },
      });
      if (!slot) throw new NotFoundException('Slot not found');
      if (slot.isBlocked) throw new ConflictException('Slot is blocked');
      if (slot.bookedCount >= slot.maxPatients) throw new ConflictException('Slot is fully booked');
    }

    // Token number = today's sequential count for this doctor
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.appointment.count({
      where: {
        tenantId,
        doctorId: dto.doctorId,
        registeredAt: { gte: todayStart },
        status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
      },
    });
    tokenNumber = todayCount + 1;

    const appointment = await this.prisma.$transaction(async (tx) => {
      if (dto.slotId) {
        const updated = await tx.doctorSlot.updateMany({
          where: { id: dto.slotId, tenantId, isBlocked: false, bookedCount: { lt: 999 } },
          data: { bookedCount: { increment: 1 } },
        });
        if (updated.count === 0) throw new ConflictException('Slot update failed');
      }

      return tx.appointment.create({
        data: {
          tenantId,
          patientId: dto.patientId,
          doctorId: dto.doctorId,
          slotId: dto.slotId,
          departmentId: dto.departmentId,
          visitType: dto.visitType || VisitType.OPD,
          appointmentType: dto.appointmentType || AppointmentType.IN_PERSON,
          status: AppointmentStatus.REGISTERED,
          chiefComplaint: dto.chiefComplaint,
          referredBy: dto.referredBy,
          opinionObtainedBy: dto.opinionObtainedBy,
          tokenNumber,
          paymentStatus: 'PENDING',
          registeredAt: new Date(),
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(),
        },
        include: APPOINTMENT_INCLUDE,
      });
    });

    await this.kafka.emit(KAFKA_TOPICS.APPOINTMENT_BOOKED, {
      eventId: uuidv4(),
      eventType: 'appointment.registered',
      tenantId,
      timestamp: new Date().toISOString(),
      data: {
        appointmentId: appointment.id,
        tenantId,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        visitType: appointment.visitType,
        tokenNumber: appointment.tokenNumber,
      },
    });

    return appointment;
  }

  // Billing counter: mark consultation fee paid, move to CONFIRMED and assign proper token
  async confirmPayment(id: string, tenantId: string, paymentMethod: string, amount: number) {
    const appointment = await this.findById(id, tenantId);
    if (![AppointmentStatus.REGISTERED, AppointmentStatus.PENDING_PAYMENT].includes(appointment.status as any)) {
      throw new BadRequestException('Appointment is not awaiting payment');
    }
    return this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CONFIRMED,
        paymentStatus: 'PAID',
        paymentAmount: amount,
        confirmedAt: new Date(),
        notes: appointment.notes
          ? `${appointment.notes}\nPayment: ${paymentMethod}`
          : `Payment: ${paymentMethod}`,
      },
      include: APPOINTMENT_INCLUDE,
    });
  }

  // Active patient list with filters for dashboard
  async getActivePatients(
    tenantId: string,
    filters: {
      doctorId?: string;
      departmentId?: string;
      visitType?: VisitType;
      status?: AppointmentStatus[];
      date?: string;
    },
  ) {
    const targetDate = filters.date ? new Date(filters.date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const requestedStatuses = filters.status || [
      AppointmentStatus.REGISTERED,
      AppointmentStatus.PENDING_PAYMENT,
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.CHECKED_IN,
      AppointmentStatus.IN_PROGRESS,
    ];

    // Pre-payment statuses: filter by scheduled date so the billing counter only shows today's patients.
    const prePaymentStatuses = [AppointmentStatus.REGISTERED, AppointmentStatus.PENDING_PAYMENT]
      .filter(s => requestedStatuses.includes(s));

    // Active statuses: show regardless of date — a CONFIRMED patient who hasn't been seen yet
    // must remain visible until their consultation is completed.
    const activeStatuses = [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS]
      .filter(s => requestedStatuses.includes(s));

    const orClauses: any[] = [];
    if (prePaymentStatuses.length > 0) {
      orClauses.push({ status: { in: prePaymentStatuses }, ...scheduledOnDate(targetDate, nextDay) });
    }
    if (activeStatuses.length > 0) {
      orClauses.push({ status: { in: activeStatuses } });
    }

    const where: any = {
      tenantId,
      OR: orClauses.length > 0 ? orClauses : [{ status: { in: requestedStatuses } }],
    };

    if (filters.doctorId) where.doctorId = filters.doctorId;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.visitType) where.visitType = filters.visitType;

    return this.prisma.appointment.findMany({
      where,
      include: {
        ...APPOINTMENT_INCLUDE,
        consultation: {
          select: { id: true, bpSystolic: true, bpDiastolic: true, pulseRate: true, completedAt: true },
        },
      },
      orderBy: [{ status: 'asc' }, { tokenNumber: 'asc' }],
    });
  }

  async findAll(
    tenantId: string,
    filters: { doctorId?: string; patientId?: string; date?: string; status?: AppointmentStatus },
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { tenantId };
    if (filters.doctorId) where.doctorId = filters.doctorId;
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.status) where.status = filters.status;
    if (filters.date) {
      const date = new Date(filters.date);
      const next = new Date(date);
      next.setDate(next.getDate() + 1);
      where.OR = [
        { scheduledAt: { gte: date, lt: next } },
        { scheduledAt: null, registeredAt: { gte: date, lt: next } },
      ];
    }

    const [appointments, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include: APPOINTMENT_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { data: appointments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string, tenantId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, tenantId },
      include: {
        ...APPOINTMENT_INCLUDE,
        consultation: {
          include: { prescriptions: { include: { items: true } }, followUps: true },
        },
        pharmacyOrder: true,
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  async findDoctorQueue(doctorId: string, tenantId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    return this.prisma.appointment.findMany({
      where: {
        tenantId,
        doctorId,
        OR: [
          // Active appointments: always visible regardless of scheduled date — they must be
          // seen before they can leave the queue.
          { status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS] } },
          // Completed today: show for reference, but only the target date's records.
          { status: AppointmentStatus.COMPLETED, ...scheduledOnDate(targetDate, nextDay) },
        ],
      },
      orderBy: { tokenNumber: 'asc' },
      include: {
        patient: {
          select: { id: true, firstName: true, lastName: true, phone: true, uhid: true, dob: true, gender: true, bloodGroup: true },
        },
        department: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async checkIn(id: string, tenantId: string) {
    const appt = await this.findById(id, tenantId);
    if (appt.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException('Patient must be confirmed (payment done) before check-in');
    }
    return this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CHECKED_IN, checkedInAt: new Date() },
      include: APPOINTMENT_INCLUDE,
    });
  }

  async startConsultation(id: string, tenantId: string) {
    const appt = await this.findById(id, tenantId);
    if (appt.status !== AppointmentStatus.CHECKED_IN) {
      throw new BadRequestException('Patient must be checked in before starting consultation');
    }
    return this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.IN_PROGRESS },
      include: APPOINTMENT_INCLUDE,
    });
  }

  async complete(id: string, tenantId: string) {
    const appointment = await this.findById(id, tenantId);
    if (appointment.status !== AppointmentStatus.IN_PROGRESS) {
      throw new BadRequestException('Only IN_PROGRESS appointments can be completed');
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() },
      include: APPOINTMENT_INCLUDE,
    });

    await this.kafka.emit(KAFKA_TOPICS.APPOINTMENT_COMPLETED, {
      eventId: uuidv4(),
      eventType: 'appointment.completed',
      tenantId,
      timestamp: new Date().toISOString(),
      data: { appointmentId: id, tenantId, patientId: appointment.patientId, doctorId: appointment.doctorId },
    });

    return updated;
  }

  // After COMPLETED — send to pharmacy queue (creates PharmacyOrder)
  async sendToPharmacy(id: string, tenantId: string) {
    const appointment = await this.findById(id, tenantId);
    if (appointment.status !== AppointmentStatus.COMPLETED) {
      throw new BadRequestException('Only COMPLETED appointments can be sent to pharmacy');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.SENT_TO_PHARMACY, pharmacySentAt: new Date() },
        include: APPOINTMENT_INCLUDE,
      }),
      this.prisma.pharmacyOrder.create({
        data: {
          tenantId,
          appointmentId: id,
          patientId: appointment.patientId,
          prescriptionId: (appointment as any).consultation?.prescriptions?.[0]?.id || undefined,
          status: 'PENDING',
        },
      }),
    ]);

    return updated;
  }

  async cancel(id: string, tenantId: string, reason: string) {
    const appointment = await this.findById(id, tenantId);
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: reason },
      include: APPOINTMENT_INCLUDE,
    });

    if (appointment.slotId) {
      await this.prisma.doctorSlot.updateMany({
        where: { id: appointment.slotId, tenantId, bookedCount: { gt: 0 } },
        data: { bookedCount: { decrement: 1 } },
      });
    }

    await this.kafka.emit(KAFKA_TOPICS.APPOINTMENT_CANCELLED, {
      eventId: uuidv4(),
      eventType: 'appointment.cancelled',
      tenantId,
      timestamp: new Date().toISOString(),
      data: { appointmentId: id, tenantId, patientId: appointment.patientId, reason },
    });

    return updated;
  }

  async getQueueStatus(doctorId: string, tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [currentPatient, waitingCount, completedCount] = await Promise.all([
      // Currently consulting — no date filter, there can only be one IN_PROGRESS at a time
      this.prisma.appointment.findFirst({
        where: { tenantId, doctorId, status: AppointmentStatus.IN_PROGRESS },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true, uhid: true, dob: true, gender: true } },
        },
        orderBy: { tokenNumber: 'asc' },
      }),
      // Waiting: CONFIRMED/CHECKED_IN — sticky, no date filter
      this.prisma.appointment.count({
        where: {
          tenantId, doctorId,
          status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN] },
        },
      }),
      // Completed today: use completedAt so the count reflects actual work done today
      this.prisma.appointment.count({
        where: {
          tenantId, doctorId,
          status: { in: [AppointmentStatus.COMPLETED, AppointmentStatus.SENT_TO_PHARMACY] },
          completedAt: { gte: today, lt: tomorrow },
        },
      }),
    ]);

    return { currentPatient, waitingCount, completedCount, doctorId };
  }
}
