import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  Appointment,
  DoctorSlot,
  PharmacyOrder,
  Invoice,
  AppointmentStatus,
  AppointmentType,
  PaymentStatus,
  InvoiceType,
  PharmacyOrderStatus,
  TenantEntityManager,
  In,
} from '@mediflow/database';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KAFKA_TOPICS } from '@mediflow/shared';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly db: TenantEntityManager,
    private kafka: KafkaProducerService,
  ) {}

  async create(tenantId: string, dto: CreateAppointmentDto) {
    return this.db.transaction(async (em) => {
      const apptRepo = em.getRepository(Appointment);
      const slotRepo = em.getRepository(DoctorSlot);

      let tokenNumber: number | null = null;
      let scheduledAt: Date | null = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

      if (dto.slotId) {
        const slot = await slotRepo.findOne({ where: { id: dto.slotId, tenantId } });
        if (!slot) throw new NotFoundException('Slot not found');
        if (slot.isBlocked) throw new BadRequestException('Slot is blocked');
        if (slot.bookedCount >= slot.maxPatients) {
          throw new ConflictException('Slot is fully booked');
        }
        await slotRepo.increment({ id: slot.id }, 'bookedCount', 1);
        tokenNumber = slot.bookedCount + 1;
        scheduledAt = new Date(`${slot.slotDate}T${slot.startTime}`);
      }

      const todayCount = await apptRepo.count({
        where: { tenantId, doctorId: dto.doctorId },
      });

      const appointment = await apptRepo.save(
        apptRepo.create({
          tenantId,
          patientId: dto.patientId,
          doctorId: dto.doctorId,
          slotId: dto.slotId ?? null,
          departmentId: dto.departmentId ?? null,
          visitType: dto.visitType,
          appointmentType: dto.appointmentType ?? AppointmentType.IN_PERSON,
          chiefComplaint: dto.chiefComplaint ?? null,
          referredBy: dto.referredBy ?? null,
          opinionObtainedBy: dto.opinionObtainedBy ?? null,
          scheduledAt,
          tokenNumber: tokenNumber ?? todayCount + 1,
          status: AppointmentStatus.REGISTERED,
          paymentStatus: PaymentStatus.PENDING,
        }),
      );

      await this.kafka.emit(KAFKA_TOPICS.APPOINTMENT_BOOKED, {
        eventId: uuidv4(),
        eventType: 'appointment.booked',
        tenantId,
        timestamp: new Date().toISOString(),
        data: {
          appointmentId: appointment.id,
          tenantId,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          slotId: appointment.slotId,
          appointmentType: appointment.appointmentType,
          scheduledAt: appointment.scheduledAt?.toISOString() ?? null,
          tokenNumber: appointment.tokenNumber,
          paymentStatus: appointment.paymentStatus,
        },
      });

      return apptRepo.findOne({
        where: { id: appointment.id },
        relations: ['patient', 'doctor', 'slot', 'department'],
      });
    });
  }

  async confirmPayment(
    id: string,
    tenantId: string,
    paymentMethod: string,
    amount: number,
    razorpayPaymentId?: string,
  ) {
    const appointment = await this.db.repo(Appointment).findOne({ where: { id, tenantId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException('Cannot confirm payment for cancelled appointment');
    }

    const now = new Date();
    await this.db.repo(Appointment).update(id, {
      paymentStatus: PaymentStatus.PAID,
      paymentAmount: String(amount),
      razorpayPaymentId: razorpayPaymentId ?? null,
      status: AppointmentStatus.CONFIRMED,
      confirmedAt: now,
    });

    // Create or update the consultation invoice so revenue stats are accurate
    const existingInvoice = await this.db.repo(Invoice).findOne({
      where: { appointmentId: id, tenantId, invoiceType: InvoiceType.CONSULTATION },
    });
    if (existingInvoice) {
      await this.db.repo(Invoice).update(existingInvoice.id, {
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: paymentMethod ?? null,
        paidAt: now,
        totalAmount: String(amount),
      });
    } else {
      const invoiceCount = await this.db.repo(Invoice).count({ where: { tenantId } });
      const invoiceNumber = `INV-OPD-${String(invoiceCount + 1).padStart(6, '0')}`;
      await this.db.repo(Invoice).save(
        this.db.repo(Invoice).create({
          tenantId,
          patientId: appointment.patientId,
          appointmentId: id,
          invoiceNumber,
          invoiceType: InvoiceType.CONSULTATION,
          lineItems: [{ description: 'Consultation Fee', amount }],
          subtotal: String(amount),
          discountAmount: '0',
          taxableAmount: String(amount),
          cgstAmount: '0',
          sgstAmount: '0',
          igstAmount: '0',
          totalAmount: String(amount),
          paymentStatus: PaymentStatus.PAID,
          paymentMethod: paymentMethod ?? null,
          paidAt: now,
        }),
      );
    }

    return this.db.repo(Appointment).findOne({
      where: { id },
      relations: ['patient', 'doctor', 'slot', 'department'],
    });
  }

  async getActivePatients(tenantId: string, filters: { doctorId?: string; departmentId?: string; date?: string }) {
    const today = filters.date ? new Date(filters.date) : new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const qb = this.db
      .qb(Appointment, 'appt')
      .leftJoinAndSelect('appt.patient', 'patient')
      .leftJoinAndSelect('appt.doctor', 'doctor')
      .leftJoinAndSelect('appt.slot', 'slot')
      .leftJoinAndSelect('appt.department', 'department')
      .where('appt.tenantId = :tenantId', { tenantId });

    if (filters.doctorId) qb.andWhere('appt.doctorId = :doctorId', { doctorId: filters.doctorId });
    if (filters.departmentId) qb.andWhere('appt.departmentId = :departmentId', { departmentId: filters.departmentId });

    const prePay = [AppointmentStatus.REGISTERED];
    const active = [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.CHECKED_IN,
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.COMPLETED,
      AppointmentStatus.SENT_TO_PHARMACY,
    ];

    qb.andWhere(
      `(
        (appt.status IN (:...prePay) AND appt.createdAt BETWEEN :startOfDay AND :endOfDay)
        OR
        (appt.status IN (:...active))
      )`,
      { prePay, active, startOfDay, endOfDay },
    );

    return qb.orderBy('appt.tokenNumber', 'ASC').addOrderBy('appt.createdAt', 'ASC').getMany();
  }

  async findAll(
    tenantId: string,
    filters: { doctorId?: string; departmentId?: string; patientId?: string; status?: AppointmentStatus; from?: string; to?: string },
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;

    const qb = this.db
      .qb(Appointment, 'appt')
      .leftJoinAndSelect('appt.patient', 'patient')
      .leftJoinAndSelect('appt.doctor', 'doctor')
      .leftJoinAndSelect('appt.slot', 'slot')
      .leftJoinAndSelect('appt.department', 'department')
      .where('appt.tenantId = :tenantId', { tenantId });

    if (filters.doctorId) qb.andWhere('appt.doctorId = :doctorId', { doctorId: filters.doctorId });
    if (filters.departmentId) qb.andWhere('appt.departmentId = :departmentId', { departmentId: filters.departmentId });
    if (filters.patientId) qb.andWhere('appt.patientId = :patientId', { patientId: filters.patientId });
    if (filters.status) qb.andWhere('appt.status = :status', { status: filters.status });
    if (filters.from) qb.andWhere('appt.createdAt >= :from', { from: new Date(filters.from) });
    if (filters.to) qb.andWhere('appt.createdAt <= :to', { to: new Date(filters.to) });

    qb.orderBy('appt.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string, tenantId: string) {
    const appointment = await this.db.repo(Appointment).findOne({
      where: { id, tenantId },
      relations: [
        'patient', 'doctor', 'slot', 'department',
        'consultation', 'consultation.prescriptions', 'consultation.prescriptions.items',
        'consultation.followUps', 'pharmacyOrder',
      ],
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }

  /**
   * Returns today's queue for a specific doctor, or the full-day queue for all
   * doctors when doctorId is null (used by nurses who assist any patient).
   */
  async findDoctorQueue(doctorId: string | null, tenantId: string, date?: string, statuses?: AppointmentStatus[]) {
    const target = date ? new Date(date) : new Date();
    const startOfDay = new Date(target); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(target); endOfDay.setHours(23, 59, 59, 999);

    const qb = this.db
      .qb(Appointment, 'appt')
      .leftJoinAndSelect('appt.patient', 'patient')
      .leftJoinAndSelect('appt.slot', 'slot')
      .leftJoinAndSelect('appt.doctor', 'doctor')
      .where('appt.tenantId = :tenantId', { tenantId })
      .orderBy('appt.tokenNumber', 'ASC')
      .addOrderBy('appt.createdAt', 'ASC');

    if (statuses) {
      // Nurse mode: all active statuses today (use createdAt — walk-ins have no scheduledAt)
      qb.andWhere('appt.status IN (:...statuses)', { statuses })
        .andWhere('appt.createdAt BETWEEN :startOfDay AND :endOfDay', { startOfDay, endOfDay });
    } else {
      // Doctor mode: ALL of today's appointments except cancelled/no-show
      const excludedStatuses = [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW];
      qb.andWhere('appt.status NOT IN (:...excludedStatuses)', { excludedStatuses })
        .andWhere('appt.createdAt BETWEEN :startOfDay AND :endOfDay', { startOfDay, endOfDay });
    }

    if (doctorId) {
      qb.andWhere('appt.doctorId = :doctorId', { doctorId });
    }

    return qb.getMany();
  }

  async checkIn(id: string, tenantId: string) {
    const appointment = await this.db.repo(Appointment).findOne({ where: { id, tenantId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException('Appointment must be CONFIRMED to check in');
    }
    await this.db.repo(Appointment).update(id, { status: AppointmentStatus.CHECKED_IN, checkedInAt: new Date() });
    return this.db.repo(Appointment).findOne({ where: { id }, relations: ['patient', 'doctor', 'slot', 'department'] });
  }

  /** Reverse an accidental check-in — CHECKED_IN → CONFIRMED */
  async undoCheckIn(id: string, tenantId: string) {
    const appointment = await this.db.repo(Appointment).findOne({ where: { id, tenantId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.status !== AppointmentStatus.CHECKED_IN) {
      throw new BadRequestException('Only CHECKED_IN appointments can be reversed');
    }
    await this.db.repo(Appointment).update(id, {
      status: AppointmentStatus.CONFIRMED,
      checkedInAt: null as any,
    });
    return this.db.repo(Appointment).findOne({ where: { id }, relations: ['patient', 'doctor', 'slot', 'department'] });
  }

  async startConsultation(id: string, tenantId: string) {
    const appointment = await this.db.repo(Appointment).findOne({ where: { id, tenantId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.status !== AppointmentStatus.CHECKED_IN) {
      throw new BadRequestException('Appointment must be CHECKED_IN to start consultation');
    }
    await this.db.repo(Appointment).update(id, { status: AppointmentStatus.IN_PROGRESS });
    return this.db.repo(Appointment).findOne({ where: { id }, relations: ['patient', 'doctor', 'slot', 'department'] });
  }

  async complete(id: string, tenantId: string) {
    const appointment = await this.db.repo(Appointment).findOne({ where: { id, tenantId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.status !== AppointmentStatus.IN_PROGRESS) {
      throw new BadRequestException('Appointment must be IN_PROGRESS to complete');
    }
    await this.db.repo(Appointment).update(id, { status: AppointmentStatus.COMPLETED, completedAt: new Date() });

    await this.kafka.emit(KAFKA_TOPICS.APPOINTMENT_COMPLETED, {
      eventId: uuidv4(),
      eventType: 'appointment.completed',
      tenantId,
      timestamp: new Date().toISOString(),
      data: {
        appointmentId: id, tenantId,
        patientId: appointment.patientId, doctorId: appointment.doctorId,
        completedAt: new Date().toISOString(),
      },
    });

    return this.db.repo(Appointment).findOne({ where: { id }, relations: ['patient', 'doctor', 'slot', 'department'] });
  }

  async sendToPharmacy(id: string, tenantId: string) {
    return this.db.transaction(async (em) => {
      const apptRepo = em.getRepository(Appointment);
      const pharmacyRepo = em.getRepository(PharmacyOrder);

      const appointment = await apptRepo.findOne({ where: { id, tenantId } });
      if (!appointment) throw new NotFoundException('Appointment not found');
      if (appointment.status !== AppointmentStatus.COMPLETED) {
        throw new BadRequestException('Appointment must be COMPLETED before sending to pharmacy');
      }

      const existing = await pharmacyRepo.findOne({ where: { appointmentId: id } });
      if (existing) throw new ConflictException('Already sent to pharmacy');

      await pharmacyRepo.save(
        pharmacyRepo.create({
          tenantId,
          appointmentId: id,
          patientId: appointment.patientId,
          status: PharmacyOrderStatus.PENDING,
        }),
      );

      await apptRepo.update(id, { status: AppointmentStatus.SENT_TO_PHARMACY, pharmacySentAt: new Date() });

      return apptRepo.findOne({
        where: { id },
        relations: ['patient', 'doctor', 'slot', 'department', 'pharmacyOrder'],
      });
    });
  }

  async cancel(id: string, tenantId: string, reason: string) {
    const appointment = await this.db.repo(Appointment).findOne({ where: { id, tenantId } });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException('Appointment is already cancelled');
    }

    await this.db.repo(Appointment).update(id, {
      status: AppointmentStatus.CANCELLED,
      cancellationReason: reason,
      cancelledAt: new Date(),
    });

    if (appointment.slotId) {
      await this.db.repo(DoctorSlot).decrement({ id: appointment.slotId }, 'bookedCount', 1);
    }

    await this.kafka.emit(KAFKA_TOPICS.APPOINTMENT_CANCELLED, {
      eventId: uuidv4(),
      eventType: 'appointment.cancelled',
      tenantId,
      timestamp: new Date().toISOString(),
      data: {
        appointmentId: id, tenantId,
        patientId: appointment.patientId, doctorId: appointment.doctorId,
        cancelledAt: new Date().toISOString(), reason,
      },
    });

    return this.db.repo(Appointment).findOne({ where: { id }, relations: ['patient', 'doctor', 'slot', 'department'] });
  }

  /**
   * Queue summary counts — doctorId=null means "all doctors" (used for nurses).
   */
  async getQueueStatus(doctorId: string | null, tenantId: string) {
    const today = new Date();
    const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(today); endOfDay.setHours(23, 59, 59, 999);

    // Helper: base query scoped to tenant + optional doctor
    const base = () => {
      const qb = this.db.qb(Appointment, 'appt')
        .where('appt.tenantId = :tenantId', { tenantId });
      if (doctorId) qb.andWhere('appt.doctorId = :doctorId', { doctorId });
      return qb;
    };

    const [inProgress, waiting, completedToday] = await Promise.all([
      base()
        .leftJoinAndSelect('appt.patient', 'patient')
        .andWhere('appt.status = :s', { s: AppointmentStatus.IN_PROGRESS })
        .getOne(),
      base()
        .andWhere('appt.status IN (:...s)', {
          s: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN],
        })
        .getCount(),
      base()
        .andWhere('appt.status = :s', { s: AppointmentStatus.COMPLETED })
        .andWhere('appt.completedAt BETWEEN :startOfDay AND :endOfDay', { startOfDay, endOfDay })
        .getCount(),
    ]);

    return {
      currentPatient: inProgress,
      waitingCount:   waiting,
      completedCount: completedToday,
      doctorId:       doctorId ?? 'all',
    };
  }
}
