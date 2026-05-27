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
  AppointmentStatus,
  AppointmentType,
  PaymentStatus,
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

    await this.db.repo(Appointment).update(id, {
      paymentStatus: PaymentStatus.PAID,
      paymentAmount: String(amount),
      razorpayPaymentId: razorpayPaymentId ?? null,
      status: AppointmentStatus.CONFIRMED,
      confirmedAt: new Date(),
    });

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

  async findDoctorQueue(doctorId: string, tenantId: string, date?: string) {
    const target = date ? new Date(date) : new Date();
    const startOfDay = new Date(target);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(target);
    endOfDay.setHours(23, 59, 59, 999);

    const activeStatuses = [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS];

    return this.db
      .qb(Appointment, 'appt')
      .leftJoinAndSelect('appt.patient', 'patient')
      .leftJoinAndSelect('appt.slot', 'slot')
      .where('appt.tenantId = :tenantId', { tenantId })
      .andWhere('appt.doctorId = :doctorId', { doctorId })
      .andWhere(
        `(
          (appt.status IN (:...activeStatuses))
          OR
          (appt.status = :completed AND appt.completedAt BETWEEN :startOfDay AND :endOfDay)
        )`,
        { activeStatuses, completed: AppointmentStatus.COMPLETED, startOfDay, endOfDay },
      )
      .orderBy('appt.tokenNumber', 'ASC')
      .addOrderBy('appt.createdAt', 'ASC')
      .getMany();
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

  async getQueueStatus(doctorId: string, tenantId: string) {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const [inProgress, waiting, completedToday] = await Promise.all([
      this.db.repo(Appointment).findOne({
        where: { tenantId, doctorId, status: AppointmentStatus.IN_PROGRESS },
        relations: ['patient'],
      }),
      this.db.repo(Appointment).count({
        where: {
          tenantId, doctorId,
          status: In([AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN]),
        },
      }),
      this.db.qb(Appointment, 'appt')
        .where('appt.tenantId = :tenantId', { tenantId })
        .andWhere('appt.doctorId = :doctorId', { doctorId })
        .andWhere('appt.status = :status', { status: AppointmentStatus.COMPLETED })
        .andWhere('appt.completedAt BETWEEN :startOfDay AND :endOfDay', { startOfDay, endOfDay })
        .getCount(),
    ]);

    return { inProgress, waiting, completedToday };
  }
}
