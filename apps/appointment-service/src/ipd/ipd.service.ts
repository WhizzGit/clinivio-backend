import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient, BedStatus, IPDAdmissionStatus } from '@prisma/client';
import {
  AdmitPatientDto, IPDVitalsDto, AddTreatmentDto, UpdateTreatmentDto,
  AddProcedureDto, SaveDischargeAdviceDto, SaveDischargeSummaryDto, DischargePatientDto,
} from './dto/ipd.dto';

const ADMISSION_INCLUDE = {
  patient: { select: { id: true, uhid: true, firstName: true, lastName: true, phone: true, gender: true, dob: true, bloodGroup: true } },
  attendingDoctor: { select: { id: true, firstName: true, lastName: true } },
  room: true,
  bed: true,
  vitalSnapshots: { orderBy: { recordedAt: 'desc' as const }, take: 10, include: { recordedBy: { select: { firstName: true, lastName: true } } } },
  treatments: { orderBy: { startedAt: 'desc' as const }, include: { orderedBy: { select: { firstName: true, lastName: true } } } },
  procedures: { orderBy: { performedAt: 'desc' as const }, include: { performedBy: { select: { firstName: true, lastName: true } } } },
  dischargeAdvice: true,
  dischargeSummary: true,
};

@Injectable()
export class IpdService {
  private prisma = new PrismaClient();

  private generateAdmissionNumber(tenantId: string): string {
    const year = new Date().getFullYear();
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `IPD-${year}-${rand}`;
  }

  async admitPatient(tenantId: string, dto: AdmitPatientDto, userId: string) {
    const bed = await this.prisma.bed.findFirst({ where: { id: dto.bedId, tenantId } });
    if (!bed) throw new NotFoundException('Bed not found');
    if (bed.status !== BedStatus.AVAILABLE) throw new BadRequestException(`Bed is ${bed.status.toLowerCase().replace('_', ' ')}`);

    return this.prisma.$transaction(async tx => {
      const admission = await tx.iPDAdmission.create({
        data: {
          tenantId,
          patientId: dto.patientId,
          attendingDoctorId: dto.attendingDoctorId,
          appointmentId: dto.appointmentId,
          roomId: dto.roomId,
          bedId: dto.bedId,
          admissionNumber: this.generateAdmissionNumber(tenantId),
          admissionReason: dto.admissionReason,
          referredBy: dto.referredBy,
          opinionObtainedBy: dto.opinionObtainedBy,
          estimatedDischargeAt: dto.estimatedDischargeAt ? new Date(dto.estimatedDischargeAt) : undefined,
          notes: dto.notes,
        },
        include: ADMISSION_INCLUDE,
      });
      await tx.bed.update({ where: { id: dto.bedId }, data: { status: BedStatus.OCCUPIED } });
      return admission;
    });
  }

  async findAll(tenantId: string, status?: IPDAdmissionStatus) {
    return this.prisma.iPDAdmission.findMany({
      where: { tenantId, ...(status ? { status } : { status: { not: IPDAdmissionStatus.DISCHARGED } }) },
      include: {
        patient: { select: { id: true, uhid: true, firstName: true, lastName: true, phone: true, gender: true } },
        attendingDoctor: { select: { id: true, firstName: true, lastName: true } },
        room: { select: { id: true, name: true, roomType: true } },
        bed: { select: { id: true, bedNumber: true } },
        _count: { select: { vitalSnapshots: true, treatments: true, procedures: true } },
      },
      orderBy: { admittedAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const admission = await this.prisma.iPDAdmission.findFirst({
      where: { id, tenantId },
      include: ADMISSION_INCLUDE,
    });
    if (!admission) throw new NotFoundException('IPD admission not found');
    return admission;
  }

  async addVitals(admissionId: string, tenantId: string, dto: IPDVitalsDto, recordedById: string) {
    await this.findOne(admissionId, tenantId);
    let bmi: number | undefined;
    if (dto.weightKg && dto.heightCm) {
      const hM = dto.heightCm / 100;
      bmi = Math.round((dto.weightKg / (hM * hM)) * 10) / 10;
    }
    return this.prisma.iPDVitalSnapshot.create({
      data: { tenantId, admissionId, recordedById, ...dto, bmi },
      include: { recordedBy: { select: { firstName: true, lastName: true } } },
    });
  }

  async addTreatment(admissionId: string, tenantId: string, dto: AddTreatmentDto, orderedById: string) {
    const admission = await this.findOne(admissionId, tenantId);
    if (admission.status === IPDAdmissionStatus.DISCHARGED)
      throw new BadRequestException('Cannot add treatment to a discharged patient');
    await this.prisma.iPDAdmission.update({ where: { id: admissionId }, data: { status: IPDAdmissionStatus.UNDER_TREATMENT } });
    return this.prisma.iPDTreatment.create({
      data: { tenantId, admissionId, orderedById, ...dto },
      include: { orderedBy: { select: { firstName: true, lastName: true } } },
    });
  }

  async updateTreatment(treatmentId: string, tenantId: string, dto: UpdateTreatmentDto) {
    const t = await this.prisma.iPDTreatment.findFirst({ where: { id: treatmentId, tenantId } });
    if (!t) throw new NotFoundException('Treatment not found');
    return this.prisma.iPDTreatment.update({
      where: { id: treatmentId },
      data: { ...dto, endedAt: dto.isActive === false ? new Date() : undefined },
    });
  }

  async addProcedure(admissionId: string, tenantId: string, dto: AddProcedureDto, performedById: string, photoUrls: string[] = []) {
    await this.findOne(admissionId, tenantId);
    return this.prisma.iPDProcedure.create({
      data: {
        tenantId, admissionId, performedById,
        procedureName: dto.procedureName,
        notes: dto.notes,
        outcomes: dto.outcomes,
        complications: dto.complications,
        photoUrls,
        performedAt: dto.performedAt ? new Date(dto.performedAt) : new Date(),
      },
      include: { performedBy: { select: { firstName: true, lastName: true } } },
    });
  }

  async addProcedurePhotos(procedureId: string, tenantId: string, photoUrls: string[]) {
    const proc = await this.prisma.iPDProcedure.findFirst({ where: { id: procedureId, tenantId } });
    if (!proc) throw new NotFoundException('Procedure not found');
    return this.prisma.iPDProcedure.update({
      where: { id: procedureId },
      data: { photoUrls: { push: photoUrls } },
    });
  }

  async saveDischargeAdvice(admissionId: string, tenantId: string, dto: SaveDischargeAdviceDto, createdById: string) {
    await this.findOne(admissionId, tenantId);
    return this.prisma.dischargeAdvice.upsert({
      where: { admissionId },
      create: { tenantId, admissionId, createdById, ...dto, followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined },
      update: { ...dto, followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined },
    });
  }

  async saveDischargeSummary(admissionId: string, tenantId: string, dto: SaveDischargeSummaryDto, generatedById: string) {
    await this.findOne(admissionId, tenantId);
    return this.prisma.dischargeSummary.upsert({
      where: { admissionId },
      create: { tenantId, admissionId, generatedById, ...dto },
      update: { ...dto },
      include: { generatedBy: { select: { firstName: true, lastName: true } } },
    });
  }

  async discharge(admissionId: string, tenantId: string, dto: DischargePatientDto) {
    const admission = await this.findOne(admissionId, tenantId);
    if (admission.status === IPDAdmissionStatus.DISCHARGED)
      throw new BadRequestException('Patient already discharged');
    return this.prisma.$transaction(async tx => {
      const updated = await tx.iPDAdmission.update({
        where: { id: admissionId },
        data: { status: IPDAdmissionStatus.DISCHARGED, dischargedAt: new Date(), notes: dto.notes },
      });
      await tx.bed.update({ where: { id: admission.bedId }, data: { status: BedStatus.AVAILABLE } });
      return updated;
    });
  }

  async markReadyForDischarge(admissionId: string, tenantId: string) {
    await this.findOne(admissionId, tenantId);
    return this.prisma.iPDAdmission.update({
      where: { id: admissionId },
      data: { status: IPDAdmissionStatus.READY_FOR_DISCHARGE },
    });
  }
}
