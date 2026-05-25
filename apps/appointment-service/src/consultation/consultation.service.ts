import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { SaveConsultationDto, SavePrescriptionDto, CreateFollowUpDto } from './dto/consultation.dto';

@Injectable()
export class ConsultationService {
  constructor(private prisma: PrismaService) {}

  async getOrCreate(appointmentId: string, tenantId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    return this.prisma.consultation.upsert({
      where: { appointmentId },
      update: {},
      create: {
        tenantId,
        appointmentId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        startedAt: new Date(),
      },
      include: {
        prescriptions: { include: { items: true } },
        followUps: { orderBy: { followUpDate: 'asc' } },
      },
    });
  }

  async saveConsultation(appointmentId: string, tenantId: string, dto: SaveConsultationDto) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    const vitals = dto.vitals || {};
    let bmi: number | undefined;
    if (vitals.weightKg && vitals.heightCm) {
      const heightM = vitals.heightCm / 100;
      bmi = Math.round((vitals.weightKg / (heightM * heightM)) * 10) / 10;
    }

    return this.prisma.consultation.upsert({
      where: { appointmentId },
      update: {
        ...(vitals.bpSystolic !== undefined && { bpSystolic: vitals.bpSystolic }),
        ...(vitals.bpDiastolic !== undefined && { bpDiastolic: vitals.bpDiastolic }),
        ...(vitals.pulseRate !== undefined && { pulseRate: vitals.pulseRate }),
        ...(vitals.temperature !== undefined && { temperature: vitals.temperature }),
        ...(vitals.weightKg !== undefined && { weightKg: vitals.weightKg }),
        ...(vitals.heightCm !== undefined && { heightCm: vitals.heightCm }),
        ...(bmi !== undefined && { bmi }),
        ...(vitals.spo2 !== undefined && { spo2: vitals.spo2 }),
        ...(vitals.rbsMgDl !== undefined && { rbsMgDl: vitals.rbsMgDl }),
        ...(vitals.respiratoryRate !== undefined && { respiratoryRate: vitals.respiratoryRate }),
        ...(dto.observations !== undefined && { observations: dto.observations }),
        ...(dto.diagnosis !== undefined && { diagnosis: dto.diagnosis }),
        ...(dto.icdCodes !== undefined && { icdCodes: dto.icdCodes }),
        ...(dto.doctorNotes !== undefined && { doctorNotes: dto.doctorNotes }),
      },
      create: {
        tenantId,
        appointmentId,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        startedAt: new Date(),
        bpSystolic: vitals.bpSystolic,
        bpDiastolic: vitals.bpDiastolic,
        pulseRate: vitals.pulseRate,
        temperature: vitals.temperature,
        weightKg: vitals.weightKg,
        heightCm: vitals.heightCm,
        bmi,
        spo2: vitals.spo2,
        rbsMgDl: vitals.rbsMgDl,
        respiratoryRate: vitals.respiratoryRate,
        observations: dto.observations,
        diagnosis: dto.diagnosis,
        icdCodes: dto.icdCodes || [],
        doctorNotes: dto.doctorNotes,
      },
      include: {
        prescriptions: { include: { items: true } },
        followUps: { orderBy: { followUpDate: 'asc' } },
      },
    });
  }

  async savePrescription(appointmentId: string, tenantId: string, dto: SavePrescriptionDto) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { appointmentId, tenantId },
    });
    if (!consultation) throw new NotFoundException('Start consultation before adding prescription');

    // Replace prescription: delete existing items, create new
    const existing = await this.prisma.prescription.findFirst({
      where: { consultationId: consultation.id },
    });

    if (existing) {
      await this.prisma.prescriptionItem.deleteMany({ where: { prescriptionId: existing.id } });
      return this.prisma.prescription.update({
        where: { id: existing.id },
        data: {
          notes: dto.notes,
          items: {
            create: dto.items.map((item) => ({
              medicineName: item.medicineName,
              genericName: item.genericName,
              dosage: item.dosage,
              frequency: item.frequency,
              duration: item.duration,
              instructions: item.instructions,
              quantity: item.quantity ?? 1,
              isSubstitutable: item.isSubstitutable ?? true,
            })),
          },
        },
        include: { items: true },
      });
    }

    return this.prisma.prescription.create({
      data: {
        tenantId,
        consultationId: consultation.id,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        notes: dto.notes,
        items: {
          create: dto.items.map((item) => ({
            medicineName: item.medicineName,
            genericName: item.genericName,
            dosage: item.dosage,
            frequency: item.frequency,
            duration: item.duration,
            instructions: item.instructions,
            quantity: item.quantity ?? 1,
            isSubstitutable: item.isSubstitutable ?? true,
          })),
        },
      },
      include: { items: true },
    });
  }

  async createFollowUp(appointmentId: string, tenantId: string, dto: CreateFollowUpDto) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { appointmentId, tenantId },
    });
    if (!consultation) throw new NotFoundException('Consultation not found');

    const followUpDate = new Date(dto.followUpDate);
    if (followUpDate <= new Date()) throw new BadRequestException('Follow-up date must be in the future');

    return this.prisma.followUp.create({
      data: {
        tenantId,
        consultationId: consultation.id,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        followUpDate,
        notes: dto.notes,
      },
    });
  }

  async getConsultation(appointmentId: string, tenantId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { appointmentId, tenantId },
      include: {
        prescriptions: { include: { items: true } },
        followUps: { orderBy: { followUpDate: 'asc' } },
        doctor: { select: { firstName: true, lastName: true } },
        patient: {
          select: {
            firstName: true, lastName: true, uhid: true, dob: true,
            gender: true, bloodGroup: true, abhaId: true,
          },
        },
      },
    });
    if (!consultation) throw new NotFoundException('No consultation found for this appointment');
    return consultation;
  }

  async getPatientHistory(patientId: string, tenantId: string) {
    return this.prisma.consultation.findMany({
      where: { patientId, tenantId },
      include: {
        appointment: {
          select: { visitType: true, chiefComplaint: true, registeredAt: true },
        },
        prescriptions: { include: { items: true } },
        followUps: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
