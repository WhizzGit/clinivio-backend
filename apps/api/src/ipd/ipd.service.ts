import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  IPDAdmission,
  IPDVitalSnapshot,
  IPDTreatment,
  IPDProcedure,
  DischargeAdvice,
  DischargeSummary,
  Bed,
  Room,
  BedStatus,
  IPDAdmissionStatus,
} from '@mediflow/database';

export class AdmitPatientDto {
  patientId: string;
  attendingDoctorId: string;
  bedId: string;
  admissionReason: string;
  appointmentId?: string;
  referredBy?: string;
  opinionObtainedBy?: string;
  estimatedDischargeAt?: string;
  notes?: string;
}

export class AddVitalSnapshotDto {
  recordedById: string;
  bpSystolic?: number;
  bpDiastolic?: number;
  pulseRate?: number;
  temperature?: number;
  weightKg?: number;
  heightCm?: number;
  spo2?: number;
  rbsMgDl?: number;
  respiratoryRate?: number;
  notes?: string;
}

export class AddTreatmentDto {
  orderedById: string;
  treatmentName: string;
  instructions?: string;
  notes?: string;
}

export class AddProcedureDto {
  performedById: string;
  procedureName: string;
  notes?: string;
  outcomes?: string;
  complications?: string;
  photoUrls?: string[];
}

export class SaveDischargeAdviceDto {
  createdById: string;
  medications?: string;
  dietAdvice?: string;
  activityAdvice?: string;
  woundCare?: string;
  otherAdvice?: string;
  followUpDate?: string;
  followUpNotes?: string;
}

export class SaveDischargeSummaryDto {
  generatedById: string;
  finalDiagnosis: string;
  presentingComplaints: string;
  treatmentSummary: string;
  proceduresDone?: string;
  investigationFindings?: string;
  conditionAtDischarge: string;
  pdfS3Key?: string;
}

@Injectable()
export class IpdService {
  constructor(
    @InjectRepository(IPDAdmission)
    private admissionRepo: Repository<IPDAdmission>,
    @InjectRepository(IPDVitalSnapshot)
    private vitalRepo: Repository<IPDVitalSnapshot>,
    @InjectRepository(IPDTreatment)
    private treatmentRepo: Repository<IPDTreatment>,
    @InjectRepository(IPDProcedure)
    private procedureRepo: Repository<IPDProcedure>,
    @InjectRepository(DischargeAdvice)
    private dischargeAdviceRepo: Repository<DischargeAdvice>,
    @InjectRepository(DischargeSummary)
    private dischargeSummaryRepo: Repository<DischargeSummary>,
    @InjectRepository(Bed)
    private bedRepo: Repository<Bed>,
    @InjectRepository(Room)
    private roomRepo: Repository<Room>,
    private dataSource: DataSource,
  ) {}

  private async generateAdmissionNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.admissionRepo.count({ where: { tenantId } });
    return `IPD-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private async loadAdmission(id: string) {
    return this.admissionRepo.findOne({
      where: { id },
      relations: [
        'patient',
        'attendingDoctor',
        'room',
        'bed',
        'vitalSnapshots',
        'treatments',
        'procedures',
        'dischargeAdvice',
        'dischargeSummary',
      ],
    });
  }

  async admitPatient(tenantId: string, dto: AdmitPatientDto) {
    return this.dataSource.transaction(async (manager) => {
      const admissionRepo = manager.getRepository(IPDAdmission);
      const bedRepo = manager.getRepository(Bed);

      const bed = await bedRepo.findOne({ where: { id: dto.bedId, tenantId } });
      if (!bed) throw new NotFoundException('Bed not found');
      if (bed.status !== BedStatus.AVAILABLE) {
        throw new ConflictException('Bed is not available');
      }

      const admissionNumber = await this.generateAdmissionNumber(tenantId);

      const admission = await admissionRepo.save(
        admissionRepo.create({
          tenantId,
          patientId: dto.patientId,
          attendingDoctorId: dto.attendingDoctorId,
          bedId: dto.bedId,
          roomId: bed.roomId,
          appointmentId: dto.appointmentId ?? null,
          admissionNumber,
          admissionReason: dto.admissionReason,
          referredBy: dto.referredBy ?? null,
          opinionObtainedBy: dto.opinionObtainedBy ?? null,
          estimatedDischargeAt: dto.estimatedDischargeAt ? new Date(dto.estimatedDischargeAt) : null,
          notes: dto.notes ?? null,
          status: IPDAdmissionStatus.ADMITTED,
          admittedAt: new Date(),
        }),
      );

      await bedRepo.update(dto.bedId, { status: BedStatus.OCCUPIED });

      return this.loadAdmission(admission.id);
    });
  }

  async findAll(tenantId: string, filters: { status?: IPDAdmissionStatus; patientId?: string }, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const qb = this.admissionRepo
      .createQueryBuilder('adm')
      .leftJoinAndSelect('adm.patient', 'patient')
      .leftJoinAndSelect('adm.attendingDoctor', 'doctor')
      .leftJoinAndSelect('adm.room', 'room')
      .leftJoinAndSelect('adm.bed', 'bed')
      .where('adm.tenantId = :tenantId', { tenantId });

    if (filters.status) qb.andWhere('adm.status = :status', { status: filters.status });
    if (filters.patientId) qb.andWhere('adm.patientId = :patientId', { patientId: filters.patientId });

    qb.orderBy('adm.admittedAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string, tenantId: string) {
    const admission = await this.loadAdmission(id);
    if (!admission || admission.tenantId !== tenantId) {
      throw new NotFoundException('Admission not found');
    }
    return admission;
  }

  async dischargePatient(id: string, tenantId: string) {
    return this.dataSource.transaction(async (manager) => {
      const admissionRepo = manager.getRepository(IPDAdmission);
      const bedRepo = manager.getRepository(Bed);

      const admission = await admissionRepo.findOne({ where: { id, tenantId } });
      if (!admission) throw new NotFoundException('Admission not found');
      if (admission.status === IPDAdmissionStatus.DISCHARGED) {
        throw new BadRequestException('Patient already discharged');
      }

      await admissionRepo.update(id, {
        status: IPDAdmissionStatus.DISCHARGED,
        dischargedAt: new Date(),
      });

      await bedRepo.update(admission.bedId, { status: BedStatus.AVAILABLE });

      return this.loadAdmission(id);
    });
  }

  // ─── Vitals ───────────────────────────────────────────────────────────────────

  async addVitalSnapshot(admissionId: string, tenantId: string, dto: AddVitalSnapshotDto) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');

    let bmi: string | undefined;
    if (dto.weightKg && dto.heightCm) {
      const hM = dto.heightCm / 100;
      bmi = (dto.weightKg / (hM * hM)).toFixed(1);
    }

    const vital = await this.vitalRepo.save(
      this.vitalRepo.create({
        tenantId,
        admissionId,
        recordedById: dto.recordedById,
        bpSystolic: dto.bpSystolic ?? null,
        bpDiastolic: dto.bpDiastolic ?? null,
        pulseRate: dto.pulseRate ?? null,
        temperature: dto.temperature !== undefined ? String(dto.temperature) : null,
        weightKg: dto.weightKg !== undefined ? String(dto.weightKg) : null,
        heightCm: dto.heightCm !== undefined ? String(dto.heightCm) : null,
        bmi: bmi ?? null,
        spo2: dto.spo2 ?? null,
        rbsMgDl: dto.rbsMgDl !== undefined ? String(dto.rbsMgDl) : null,
        respiratoryRate: dto.respiratoryRate ?? null,
        notes: dto.notes ?? null,
        recordedAt: new Date(),
      }),
    );

    return vital;
  }

  async getVitals(admissionId: string, tenantId: string) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');

    return this.vitalRepo.find({
      where: { admissionId },
      relations: ['recordedBy'],
      order: { recordedAt: 'DESC' },
    });
  }

  // ─── Treatments ───────────────────────────────────────────────────────────────

  async addTreatment(admissionId: string, tenantId: string, dto: AddTreatmentDto) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');

    return this.treatmentRepo.save(
      this.treatmentRepo.create({
        tenantId,
        admissionId,
        orderedById: dto.orderedById,
        treatmentName: dto.treatmentName,
        instructions: dto.instructions ?? null,
        notes: dto.notes ?? null,
        startedAt: new Date(),
        isActive: true,
      }),
    );
  }

  async endTreatment(treatmentId: string, tenantId: string) {
    const treatment = await this.treatmentRepo.findOne({ where: { id: treatmentId, tenantId } });
    if (!treatment) throw new NotFoundException('Treatment not found');
    await this.treatmentRepo.update(treatmentId, { isActive: false, endedAt: new Date() });
    return this.treatmentRepo.findOne({ where: { id: treatmentId } });
  }

  async getTreatments(admissionId: string, tenantId: string) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');
    return this.treatmentRepo.find({
      where: { admissionId },
      relations: ['orderedBy'],
      order: { startedAt: 'DESC' },
    });
  }

  // ─── Procedures ───────────────────────────────────────────────────────────────

  async addProcedure(admissionId: string, tenantId: string, dto: AddProcedureDto) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');

    return this.procedureRepo.save(
      this.procedureRepo.create({
        tenantId,
        admissionId,
        performedById: dto.performedById,
        procedureName: dto.procedureName,
        notes: dto.notes ?? null,
        outcomes: dto.outcomes ?? null,
        complications: dto.complications ?? null,
        photoUrls: dto.photoUrls ?? [],
        performedAt: new Date(),
      }),
    );
  }

  async addProcedurePhotos(procedureId: string, tenantId: string, photoUrls: string[]) {
    const procedure = await this.procedureRepo.findOne({ where: { id: procedureId, tenantId } });
    if (!procedure) throw new NotFoundException('Procedure not found');

    const updatedUrls = [...(procedure.photoUrls ?? []), ...photoUrls];
    await this.procedureRepo.update(procedureId, { photoUrls: updatedUrls });
    return this.procedureRepo.findOne({ where: { id: procedureId } });
  }

  async getProcedures(admissionId: string, tenantId: string) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');
    return this.procedureRepo.find({
      where: { admissionId },
      relations: ['performedBy'],
      order: { performedAt: 'DESC' },
    });
  }

  // ─── Discharge Advice ─────────────────────────────────────────────────────────

  async saveDischargeAdvice(admissionId: string, tenantId: string, dto: SaveDischargeAdviceDto) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');

    let advice = await this.dischargeAdviceRepo.findOne({ where: { admissionId } });

    if (advice) {
      await this.dischargeAdviceRepo.update(advice.id, {
        createdById: dto.createdById,
        medications: dto.medications ?? null,
        dietAdvice: dto.dietAdvice ?? null,
        activityAdvice: dto.activityAdvice ?? null,
        woundCare: dto.woundCare ?? null,
        otherAdvice: dto.otherAdvice ?? null,
        followUpDate: dto.followUpDate ?? null,
        followUpNotes: dto.followUpNotes ?? null,
      });
      return this.dischargeAdviceRepo.findOne({ where: { id: advice.id } });
    } else {
      return this.dischargeAdviceRepo.save(
        this.dischargeAdviceRepo.create({
          tenantId,
          admissionId,
          createdById: dto.createdById,
          medications: dto.medications ?? null,
          dietAdvice: dto.dietAdvice ?? null,
          activityAdvice: dto.activityAdvice ?? null,
          woundCare: dto.woundCare ?? null,
          otherAdvice: dto.otherAdvice ?? null,
          followUpDate: dto.followUpDate ?? null,
          followUpNotes: dto.followUpNotes ?? null,
        }),
      );
    }
  }

  // ─── Discharge Summary ────────────────────────────────────────────────────────

  async saveDischargeSummary(admissionId: string, tenantId: string, dto: SaveDischargeSummaryDto) {
    const admission = await this.admissionRepo.findOne({ where: { id: admissionId, tenantId } });
    if (!admission) throw new NotFoundException('Admission not found');

    let summary = await this.dischargeSummaryRepo.findOne({ where: { admissionId } });

    if (summary) {
      await this.dischargeSummaryRepo.update(summary.id, {
        generatedById: dto.generatedById,
        finalDiagnosis: dto.finalDiagnosis,
        presentingComplaints: dto.presentingComplaints,
        treatmentSummary: dto.treatmentSummary,
        proceduresDone: dto.proceduresDone ?? null,
        investigationFindings: dto.investigationFindings ?? null,
        conditionAtDischarge: dto.conditionAtDischarge,
        pdfS3Key: dto.pdfS3Key ?? null,
      });
      return this.dischargeSummaryRepo.findOne({ where: { id: summary.id } });
    } else {
      return this.dischargeSummaryRepo.save(
        this.dischargeSummaryRepo.create({
          tenantId,
          admissionId,
          generatedById: dto.generatedById,
          finalDiagnosis: dto.finalDiagnosis,
          presentingComplaints: dto.presentingComplaints,
          treatmentSummary: dto.treatmentSummary,
          proceduresDone: dto.proceduresDone ?? null,
          investigationFindings: dto.investigationFindings ?? null,
          conditionAtDischarge: dto.conditionAtDischarge,
          pdfS3Key: dto.pdfS3Key ?? null,
          generatedAt: new Date(),
        }),
      );
    }
  }
}
