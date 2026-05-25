import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KAFKA_TOPICS } from '@mediflow/shared';
import { v4 as uuidv4 } from 'uuid';

const PATIENT_SELECT = {
  id: true, tenantId: true, familyId: true, uhid: true,
  firstName: true, lastName: true, phone: true, whatsappPhone: true,
  hasWhatsapp: true, email: true, dob: true, gender: true, bloodGroup: true,
  abhaId: true, preferredLanguage: true, address: true,
  emergencyContactName: true, emergencyContactPhone: true,
  consentGivenAt: true, isActive: true, createdAt: true,
};

@Injectable()
export class PatientsService {
  constructor(private prisma: PrismaService, private kafka: KafkaProducerService) {}

  private async generateUHID(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.patient.count({ where: { tenantId } });
    return `MF-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  async create(tenantId: string, dto: CreatePatientDto) {
    // Resolve family: if whatsappPhone provided, find-or-create the family group
    let familyId = dto.familyId;
    const whatsappPhone = dto.whatsappPhone || dto.phone;

    if (!familyId && whatsappPhone) {
      const family = await this.prisma.patientFamily.upsert({
        where: { tenant_family_whatsapp_unique: { tenantId, whatsappPhone } },
        update: {},
        create: { tenantId, whatsappPhone },
      });
      familyId = family.id;
    }

    const uhid = await this.generateUHID(tenantId);

    const patient = await this.prisma.patient.create({
      data: {
        tenantId,
        familyId,
        uhid,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        whatsappPhone: whatsappPhone,
        hasWhatsapp: dto.hasWhatsapp ?? true,
        email: dto.email,
        dob: dto.dob ? new Date(dto.dob) : null,
        gender: dto.gender,
        bloodGroup: dto.bloodGroup,
        abhaId: dto.abhaId,
        preferredLanguage: dto.preferredLanguage || 'EN',
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        consentGivenAt: dto.consentGiven ? new Date() : null,
        consentVersion: dto.consentGiven ? '1.0' : null,
      },
      select: PATIENT_SELECT,
    });

    // Set as primary patient on family if it's the first member
    await this.prisma.patientFamily.updateMany({
      where: { id: familyId, primaryPatientId: null },
      data: { primaryPatientId: patient.id },
    });

    await this.kafka.emit(KAFKA_TOPICS.PATIENT_REGISTERED, {
      eventId: uuidv4(),
      eventType: 'patient.registered',
      tenantId,
      timestamp: new Date().toISOString(),
      data: {
        patientId: patient.id,
        tenantId,
        phone: patient.phone,
        whatsappPhone: patient.whatsappPhone,
        hasWhatsapp: patient.hasWhatsapp,
        familyId: patient.familyId,
        name: `${patient.firstName} ${patient.lastName ?? ''}`.trim(),
        uhid: patient.uhid,
        preferredLanguage: patient.preferredLanguage,
      },
    });

    return patient;
  }

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [patients, total] = await Promise.all([
      this.prisma.patient.findMany({
        where: { tenantId, isActive: true },
        select: PATIENT_SELECT,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.patient.count({ where: { tenantId, isActive: true } }),
    ]);
    return { data: patients, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string, tenantId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id, tenantId },
      select: {
        ...PATIENT_SELECT,
        family: {
          select: { id: true, whatsappPhone: true, primaryPatientId: true },
        },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  async findByPhone(phone: string, tenantId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { tenantId, OR: [{ phone }, { whatsappPhone: phone }] },
      select: PATIENT_SELECT,
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  async findByFamily(familyId: string, tenantId: string) {
    const members = await this.prisma.patient.findMany({
      where: { familyId, tenantId, isActive: true },
      select: PATIENT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    if (members.length === 0) throw new NotFoundException('Family group not found');
    return members;
  }

  async findFamilyByWhatsapp(whatsappPhone: string, tenantId: string) {
    const family = await this.prisma.patientFamily.findFirst({
      where: { whatsappPhone, tenantId },
      include: {
        patients: { where: { isActive: true }, select: PATIENT_SELECT },
      },
    });
    if (!family) throw new NotFoundException('No family found for this WhatsApp number');
    return family;
  }

  async search(tenantId: string, q: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = {
      tenantId,
      isActive: true,
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { whatsappPhone: { contains: q } },
        { uhid: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    };
    const [patients, total] = await Promise.all([
      this.prisma.patient.findMany({ where, select: PATIENT_SELECT, skip, take: limit }),
      this.prisma.patient.count({ where }),
    ]);
    return { data: patients, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async update(id: string, tenantId: string, dto: UpdatePatientDto) {
    await this.findById(id, tenantId);
    return this.prisma.patient.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        dob: dto.dob ? new Date(dto.dob) : undefined,
        gender: dto.gender,
        bloodGroup: dto.bloodGroup,
        preferredLanguage: dto.preferredLanguage,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        address: dto.address,
        hasWhatsapp: dto.hasWhatsapp,
        whatsappPhone: dto.whatsappPhone,
      },
      select: PATIENT_SELECT,
    });
  }

  async updateConsent(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.prisma.patient.update({
      where: { id },
      data: { consentGivenAt: new Date(), consentVersion: '1.0' },
      select: PATIENT_SELECT,
    });
  }
}
