import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  Consultation,
  Prescription,
  PrescriptionItem,
  FollowUp,
  Appointment,
  AppointmentStatus,
} from '@mediflow/database';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KAFKA_TOPICS } from '@mediflow/shared';

export class VitalsDto {
  bpSystolic?: number;
  bpDiastolic?: number;
  pulseRate?: number;
  temperature?: number;
  weightKg?: number;
  heightCm?: number;
  spo2?: number;
  rbsMgDl?: number;
  respiratoryRate?: number;
}

export class SaveConsultationDto {
  vitals?: VitalsDto;
  observations?: string;
  diagnosis?: string;
  icdCodes?: string[];
  doctorNotes?: string;
}

export class CreatePrescriptionDto {
  notes?: string;
  items: {
    medicineName: string;
    genericName?: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions?: string;
    quantity?: number;
    isSubstitutable?: boolean;
  }[];
}

export class CreateFollowUpDto {
  followUpDate: string;
  notes?: string;
}

@Injectable()
export class ConsultationService {
  constructor(
    @InjectRepository(Consultation)
    private consultationRepo: Repository<Consultation>,
    @InjectRepository(Prescription)
    private prescriptionRepo: Repository<Prescription>,
    @InjectRepository(PrescriptionItem)
    private prescriptionItemRepo: Repository<PrescriptionItem>,
    @InjectRepository(FollowUp)
    private followUpRepo: Repository<FollowUp>,
    @InjectRepository(Appointment)
    private appointmentRepo: Repository<Appointment>,
    private kafka: KafkaProducerService,
  ) {}

  private async loadConsultation(id: string) {
    return this.consultationRepo.findOne({
      where: { id },
      relations: ['prescriptions', 'prescriptions.items', 'followUps', 'patient', 'doctor'],
    });
  }

  async getOrCreate(appointmentId: string, tenantId: string) {
    const appointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId, tenantId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    let consultation = await this.consultationRepo.findOne({
      where: { appointmentId },
    });

    if (!consultation) {
      consultation = await this.consultationRepo.save(
        this.consultationRepo.create({
          tenantId,
          appointmentId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          startedAt: new Date(),
        }),
      );
    }

    return this.loadConsultation(consultation.id);
  }

  async saveConsultation(appointmentId: string, tenantId: string, dto: SaveConsultationDto) {
    const appointment = await this.appointmentRepo.findOne({
      where: { id: appointmentId, tenantId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    let consultation = await this.consultationRepo.findOne({
      where: { appointmentId },
    });

    if (!consultation) {
      consultation = await this.consultationRepo.save(
        this.consultationRepo.create({
          tenantId,
          appointmentId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          startedAt: new Date(),
        }),
      );
    }

    // Compute BMI if height and weight provided
    let bmi: number | undefined;
    if (dto.vitals?.weightKg && dto.vitals?.heightCm) {
      const hM = dto.vitals.heightCm / 100;
      bmi = dto.vitals.weightKg / (hM * hM);
    }

    await this.consultationRepo.update(consultation.id, {
      bpSystolic: dto.vitals?.bpSystolic ?? undefined,
      bpDiastolic: dto.vitals?.bpDiastolic ?? undefined,
      pulseRate: dto.vitals?.pulseRate ?? undefined,
      temperature: dto.vitals?.temperature !== undefined ? String(dto.vitals.temperature) : undefined,
      weightKg: dto.vitals?.weightKg !== undefined ? String(dto.vitals.weightKg) : undefined,
      heightCm: dto.vitals?.heightCm !== undefined ? String(dto.vitals.heightCm) : undefined,
      bmi: bmi !== undefined ? String(bmi.toFixed(1)) : undefined,
      spo2: dto.vitals?.spo2 ?? undefined,
      rbsMgDl: dto.vitals?.rbsMgDl !== undefined ? String(dto.vitals.rbsMgDl) : undefined,
      respiratoryRate: dto.vitals?.respiratoryRate ?? undefined,
      observations: dto.observations ?? undefined,
      diagnosis: dto.diagnosis ?? undefined,
      icdCodes: dto.icdCodes ?? undefined,
      doctorNotes: dto.doctorNotes ?? undefined,
    });

    await this.kafka.emit(KAFKA_TOPICS.CONSULTATION_SAVED, {
      eventId: uuidv4(),
      eventType: 'consultation.saved',
      tenantId,
      timestamp: new Date().toISOString(),
      data: {
        consultationId: consultation.id,
        appointmentId,
        tenantId,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
      },
    });

    return this.loadConsultation(consultation.id);
  }

  async createPrescription(appointmentId: string, tenantId: string, dto: CreatePrescriptionDto) {
    const consultation = await this.consultationRepo.findOne({
      where: { appointmentId },
    });
    if (!consultation) throw new NotFoundException('Consultation not found. Start consultation first.');

    const prescription = await this.prescriptionRepo.save(
      this.prescriptionRepo.create({
        tenantId,
        consultationId: consultation.id,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        notes: dto.notes ?? null,
      }),
    );

    if (dto.items?.length) {
      const items = dto.items.map((item) =>
        this.prescriptionItemRepo.create({
          prescriptionId: prescription.id,
          medicineName: item.medicineName,
          genericName: item.genericName ?? null,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
          instructions: item.instructions ?? null,
          quantity: item.quantity ?? 1,
          isSubstitutable: item.isSubstitutable ?? true,
        }),
      );
      await this.prescriptionItemRepo.save(items);
    }

    await this.kafka.emit(KAFKA_TOPICS.PRESCRIPTION_CREATED, {
      eventId: uuidv4(),
      eventType: 'prescription.created',
      tenantId,
      timestamp: new Date().toISOString(),
      data: {
        prescriptionId: prescription.id,
        appointmentId,
        tenantId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
      },
    });

    return this.prescriptionRepo.findOne({
      where: { id: prescription.id },
      relations: ['items'],
    });
  }

  async updatePrescription(prescriptionId: string, tenantId: string, dto: CreatePrescriptionDto) {
    const prescription = await this.prescriptionRepo.findOne({
      where: { id: prescriptionId, tenantId },
    });
    if (!prescription) throw new NotFoundException('Prescription not found');

    await this.prescriptionRepo.update(prescriptionId, {
      notes: dto.notes ?? undefined,
    });

    // Replace items
    await this.prescriptionItemRepo.delete({ prescriptionId });

    if (dto.items?.length) {
      const items = dto.items.map((item) =>
        this.prescriptionItemRepo.create({
          prescriptionId,
          medicineName: item.medicineName,
          genericName: item.genericName ?? null,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
          instructions: item.instructions ?? null,
          quantity: item.quantity ?? 1,
          isSubstitutable: item.isSubstitutable ?? true,
        }),
      );
      await this.prescriptionItemRepo.save(items);
    }

    return this.prescriptionRepo.findOne({
      where: { id: prescriptionId },
      relations: ['items'],
    });
  }

  async createFollowUp(appointmentId: string, tenantId: string, dto: CreateFollowUpDto) {
    const consultation = await this.consultationRepo.findOne({
      where: { appointmentId },
    });
    if (!consultation) throw new NotFoundException('Consultation not found');

    const followUp = await this.followUpRepo.save(
      this.followUpRepo.create({
        tenantId,
        consultationId: consultation.id,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        followUpDate: dto.followUpDate,
        notes: dto.notes ?? null,
        isCompleted: false,
      }),
    );

    return followUp;
  }

  async completeFollowUp(followUpId: string, tenantId: string) {
    const followUp = await this.followUpRepo.findOne({
      where: { id: followUpId, tenantId },
    });
    if (!followUp) throw new NotFoundException('Follow-up not found');
    await this.followUpRepo.update(followUpId, { isCompleted: true });
    return this.followUpRepo.findOne({ where: { id: followUpId } });
  }

  async getConsultationByAppointment(appointmentId: string, tenantId: string) {
    const consultation = await this.consultationRepo.findOne({
      where: { appointmentId },
      relations: ['prescriptions', 'prescriptions.items', 'followUps', 'patient', 'doctor'],
    });
    if (!consultation) throw new NotFoundException('Consultation not found');
    if (consultation.tenantId !== tenantId) throw new NotFoundException('Consultation not found');
    return consultation;
  }

  async getPatientConsultations(patientId: string, tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.consultationRepo.findAndCount({
      where: { patientId, tenantId },
      relations: ['prescriptions', 'prescriptions.items', 'followUps'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
