import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const USER_SELECT = {
  id: true, email: true, firstName: true, lastName: true, phone: true,
  role: true, isActive: true, lastLoginAt: true, createdAt: true, doctorProfile: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId }, select: USER_SELECT, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);
    return { data: users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private readonly TIER_LIMITS: Record<string, number> = {
    BASIC: 50, STANDARD: 100, PREMIUM: 300, ENTERPRISE: Infinity,
  };
  private readonly BILLABLE_ROLES = ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'PHARMACIST', 'LAB_TECHNICIAN'];

  async create(tenantId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findFirst({ where: { tenantId, email: dto.email } });
    if (existing) throw new ConflictException('Email already in use for this tenant');
    if (this.BILLABLE_ROLES.includes(dto.role)) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { subscriptionTier: true } });
      const limit = this.TIER_LIMITS[tenant?.subscriptionTier ?? 'BASIC'] ?? 50;
      if (limit < Infinity) {
        const currentCount = await this.prisma.user.count({ where: { tenantId, role: { in: this.BILLABLE_ROLES as any }, isActive: true } });
        if (currentCount >= limit) throw new ForbiddenException(`User limit reached for your plan (${tenant?.subscriptionTier ?? 'BASIC'}: max ${limit} staff). Upgrade to add more.`);
      }
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { tenantId, email: dto.email, passwordHash, firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone, role: dto.role },
        select: USER_SELECT,
      });
      if (dto.role === Role.DOCTOR) {
        await tx.doctorProfile.create({
          data: {
            userId: user.id, tenantId,
            registrationNo: dto.registrationNo || '',
            specialty: dto.specialty || 'General Medicine',
            qualification: dto.qualification || '',
            consultationFee: dto.consultationFee || 0,
            experienceYears: dto.experienceYears || 0,
          },
        });
      }
      return user;
    });
  }

  async update(id: string, tenantId: string, dto: UpdateUserDto) {
    const existing = await this.findById(id, tenantId);
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined && { firstName: dto.firstName }),
          ...(dto.lastName !== undefined && { lastName: dto.lastName }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(passwordHash !== undefined && { passwordHash }),
        },
        select: USER_SELECT,
      });

      const hasProfileFields = [
        dto.specialty, dto.subSpecialty, dto.qualification, dto.registrationNo,
        dto.experienceYears, dto.consultationFee, dto.isAcceptingPatients, dto.departmentId,
      ].some(v => v !== undefined);

      if (hasProfileFields && (existing.role as string) === 'DOCTOR') {
        await tx.doctorProfile.upsert({
          where: { userId: id },
          create: {
            userId: id, tenantId,
            specialty: dto.specialty ?? '',
            subSpecialty: dto.subSpecialty,
            qualification: dto.qualification ?? '',
            registrationNo: dto.registrationNo ?? '',
            experienceYears: dto.experienceYears ?? 0,
            consultationFee: dto.consultationFee ?? 0,
            isAcceptingPatients: dto.isAcceptingPatients ?? true,
            departmentId: dto.departmentId ?? null,
          },
          update: {
            ...(dto.specialty !== undefined && { specialty: dto.specialty }),
            ...(dto.subSpecialty !== undefined && { subSpecialty: dto.subSpecialty }),
            ...(dto.qualification !== undefined && { qualification: dto.qualification }),
            ...(dto.registrationNo !== undefined && { registrationNo: dto.registrationNo }),
            ...(dto.experienceYears !== undefined && { experienceYears: dto.experienceYears }),
            ...(dto.consultationFee !== undefined && { consultationFee: dto.consultationFee }),
            ...(dto.isAcceptingPatients !== undefined && { isAcceptingPatients: dto.isAcceptingPatients }),
            ...(dto.departmentId !== undefined && { departmentId: dto.departmentId || null }),
          },
        });
      }

      return tx.user.findFirst({ where: { id }, select: USER_SELECT });
    });
  }

  async deactivate(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.prisma.user.update({ where: { id }, data: { isActive: false } });
  }
}
