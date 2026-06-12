import {
  Injectable, ConflictException, UnauthorizedException,
  NotFoundException, BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  Patient, PatientAccount, Tenant, Appointment, Consultation,
  LabOrder, Invoice, DoctorSlot, DoctorProfile, Department,
  AppointmentStatus, AppointmentType, PaymentStatus, VisitType,
  TenantDataSourceRegistry,
} from '@mediflow/database';
import {
  PatientRegisterDto, PatientLoginDto,
  UpdatePatientProfileDto, BookAppointmentDto,
} from './dto/patient-portal.dto';
import { PatientJwtPayload } from './patient-jwt.strategy';

@Injectable()
export class PatientPortalService {
  constructor(
    @InjectDataSource() private readonly platformDs: DataSource,
    private readonly registry: TenantDataSourceRegistry,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async resolveTenantBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.platformDs
      .getRepository(Tenant)
      .findOne({ where: { slug, isActive: true } });
    if (!tenant) throw new NotFoundException(`Hospital "${slug}" not found`);
    return tenant;
  }

  private async resolveTenantById(tenantId: string): Promise<Tenant> {
    const tenant = await this.platformDs
      .getRepository(Tenant)
      .findOne({ where: { id: tenantId, isActive: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private async getDsBySlug(slug: string): Promise<{ ds: DataSource; tenant: Tenant }> {
    const tenant = await this.resolveTenantBySlug(slug);
    const ds = await this.registry.getOrCreate(tenant.id, tenant.slug);
    return { ds, tenant };
  }

  private async getDsById(tenantId: string): Promise<DataSource> {
    const tenant = await this.resolveTenantById(tenantId);
    return this.registry.getOrCreate(tenant.id, tenant.slug);
  }

  private issueToken(account: PatientAccount): string {
    const payload: PatientJwtPayload = {
      sub: account.id,
      patientId: account.patientId,
      tenantId: account.tenantId,
      type: 'PATIENT',
    };
    return this.jwtService.sign(payload);
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  async register(dto: PatientRegisterDto) {
    const { ds, tenant } = await this.getDsBySlug(dto.slug);
    const accountRepo = ds.getRepository(PatientAccount);
    const patientRepo = ds.getRepository(Patient);

    const existing = await accountRepo.findOne({ where: { phone: dto.phone } });
    if (existing) throw new ConflictException('An account with this phone already exists');

    let patient: Patient;

    if (dto.uhid) {
      const found = await patientRepo.findOne({
        where: { uhid: dto.uhid, isActive: true },
      });
      if (!found) throw new NotFoundException(`Patient with UHID ${dto.uhid} not found`);
      if (found.phone !== dto.phone) {
        throw new BadRequestException('Phone number does not match the patient record');
      }
      patient = found;
    } else {
      const count = await patientRepo.count();
      const uhid = `UHID-${String(count + 1).padStart(6, '0')}`;
      patient = await patientRepo.save(
        patientRepo.create({
          tenantId: tenant.id,
          uhid,
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          phone: dto.phone,
          email: dto.email ?? null,
          dob: dto.dob ?? null,
          gender: dto.gender ?? null,
          isActive: true,
        }),
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const account = await accountRepo.save(
      accountRepo.create({
        tenantId: tenant.id,
        patientId: patient.id,
        phone: dto.phone,
        passwordHash,
        isActive: true,
      }),
    );

    return {
      accessToken: this.issueToken(account),
      patient: {
        id: patient.id,
        uhid: patient.uhid,
        firstName: patient.firstName,
        lastName: patient.lastName,
        phone: patient.phone,
        email: patient.email,
        tenantId: tenant.id,
      },
    };
  }

  async login(dto: PatientLoginDto) {
    const { ds } = await this.getDsBySlug(dto.slug);
    const accountRepo = ds.getRepository(PatientAccount);

    const account = await accountRepo.findOne({
      where: { phone: dto.phone, isActive: true },
      relations: ['patient'],
    });
    if (!account) throw new UnauthorizedException('Invalid phone or password');

    const match = await bcrypt.compare(dto.password, account.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid phone or password');

    await accountRepo.update(account.id, { lastLoginAt: new Date() });

    const { patient } = account;
    return {
      accessToken: this.issueToken(account),
      patient: {
        id: patient.id,
        uhid: patient.uhid,
        firstName: patient.firstName,
        lastName: patient.lastName,
        phone: patient.phone,
        email: patient.email,
        tenantId: account.tenantId,
      },
    };
  }

  // ── Profile ───────────────────────────────────────────────────────────────────

  async getProfile(patientId: string, tenantId: string) {
    const ds = await this.getDsById(tenantId);
    const patient = await ds.getRepository(Patient).findOne({
      where: { id: patientId, isActive: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  async updateProfile(patientId: string, tenantId: string, dto: UpdatePatientProfileDto) {
    const ds = await this.getDsById(tenantId);
    const repo = ds.getRepository(Patient);
    await repo.update({ id: patientId }, {
      ...(dto.firstName && { firstName: dto.firstName }),
      ...(dto.lastName !== undefined && { lastName: dto.lastName }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.dob !== undefined && { dob: dto.dob }),
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.emergencyContactName !== undefined && { emergencyContactName: dto.emergencyContactName }),
      ...(dto.emergencyContactPhone !== undefined && { emergencyContactPhone: dto.emergencyContactPhone }),
    });
    return repo.findOne({ where: { id: patientId } });
  }

  // ── Appointments ──────────────────────────────────────────────────────────────

  async getAppointments(patientId: string, tenantId: string, page = 1, limit = 10) {
    const ds = await this.getDsById(tenantId);
    const [data, total] = await ds.getRepository(Appointment).findAndCount({
      where: { patientId },
      relations: ['doctor', 'doctor.doctorProfile', 'department', 'slot'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async bookAppointment(patientId: string, tenantId: string, dto: BookAppointmentDto) {
    const ds = await this.getDsById(tenantId);
    const apptRepo = ds.getRepository(Appointment);

    if (dto.slotId) {
      const slot = await ds.getRepository(DoctorSlot).findOne({
        where: { id: dto.slotId, isBlocked: false },
      });
      if (!slot) throw new BadRequestException('Selected slot is not available');
      if (slot.bookedCount >= slot.maxPatients) {
        throw new BadRequestException('Slot is fully booked');
      }
      await ds.getRepository(DoctorSlot).increment({ id: dto.slotId }, 'bookedCount', 1);
    }

    const count = await apptRepo.count({ where: { tenantId } });
    return apptRepo.save(
      apptRepo.create({
        tenantId,
        patientId,
        doctorId: dto.doctorId,
        slotId: dto.slotId ?? null,
        departmentId: dto.departmentId ?? null,
        chiefComplaint: dto.chiefComplaint ?? null,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        visitType: VisitType.OPD,
        appointmentType: AppointmentType.IN_PERSON,
        status: AppointmentStatus.REGISTERED,
        paymentStatus: PaymentStatus.PENDING,
        tokenNumber: count + 1,
      }),
    );
  }

  async cancelAppointment(appointmentId: string, patientId: string, tenantId: string) {
    const ds = await this.getDsById(tenantId);
    const repo = ds.getRepository(Appointment);
    const appt = await repo.findOne({ where: { id: appointmentId, patientId } });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (
      appt.status === AppointmentStatus.COMPLETED ||
      appt.status === AppointmentStatus.CANCELLED
    ) {
      throw new BadRequestException(`Cannot cancel appointment with status ${appt.status}`);
    }
    await repo.update(appointmentId, {
      status: AppointmentStatus.CANCELLED,
      cancelledAt: new Date(),
    });
    return { message: 'Appointment cancelled' };
  }

  // ── Consultations ─────────────────────────────────────────────────────────────

  async getConsultations(patientId: string, tenantId: string, page = 1, limit = 10) {
    const ds = await this.getDsById(tenantId);
    const [data, total] = await ds.getRepository(Consultation).findAndCount({
      where: { patientId },
      relations: ['doctor', 'prescriptions', 'prescriptions.items', 'followUps'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Lab Results ───────────────────────────────────────────────────────────────

  async getLabResults(patientId: string, tenantId: string, page = 1, limit = 10) {
    const ds = await this.getDsById(tenantId);
    const [data, total] = await ds.getRepository(LabOrder).findAndCount({
      where: { patientId },
      relations: ['items', 'items.labTest', 'orderedBy'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Invoices ──────────────────────────────────────────────────────────────────

  async getInvoices(patientId: string, tenantId: string, page = 1, limit = 10) {
    const ds = await this.getDsById(tenantId);
    const [data, total] = await ds.getRepository(Invoice).findAndCount({
      where: { patientId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Doctors & Slots (for booking) ─────────────────────────────────────────────

  async getDoctors(tenantId: string) {
    const ds = await this.getDsById(tenantId);
    return ds.getRepository(DoctorProfile).find({
      where: { isAcceptingPatients: true },
      relations: ['user', 'department'],
    });
  }

  async getDepartments(tenantId: string) {
    const ds = await this.getDsById(tenantId);
    return ds.getRepository(Department).find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async getAvailableSlots(tenantId: string, doctorId: string, date: string) {
    const ds = await this.getDsById(tenantId);
    return ds.getRepository(DoctorSlot).find({
      where: { doctorId, slotDate: date, isBlocked: false },
      order: { startTime: 'ASC' },
    });
  }
}
