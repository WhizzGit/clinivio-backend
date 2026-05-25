import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import * as bcrypt from 'bcrypt';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findAllWithStats() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(tenants.map(async (t) => {
      const [userCount, adminUser] = await Promise.all([
        this.prisma.user.count({ where: { tenantId: t.id, isActive: true } }),
        this.prisma.user.findFirst({
          where: { tenantId: t.id, role: 'ADMIN' },
          select: { email: true, firstName: true, lastName: true, lastLoginAt: true },
        }),
      ]);
      return {
        ...t,
        userCount,
        adminEmail: adminUser?.email ?? null,
        adminName: adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : null,
        adminLastLogin: adminUser?.lastLoginAt ?? null,
      };
    }));
  }

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name, address: dto.address, city: dto.city,
          state: dto.state, pincode: dto.pincode, gstin: dto.gstin,
          drugLicenseNo: dto.drugLicenseNo,
          whatsappPhoneNumberId: dto.whatsappPhoneNumberId,
          wabaId: dto.wabaId,
          subscriptionTier: (dto.subscriptionTier as any) ?? 'BASIC',
          phone: dto.phone, email: dto.email, website: dto.website,
          registrationNo: dto.registrationNo, tagline: dto.tagline,
          printHeader: dto.printHeader, pharmacyName: dto.pharmacyName,
          portalUrl: dto.portalUrl,
        },
      });
      const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id, email: dto.adminEmail, passwordHash,
          firstName: dto.adminFirstName, lastName: dto.adminLastName,
          phone: dto.adminPhone, role: 'ADMIN',
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });
      return {
        tenant,
        credentials: {
          email: dto.adminEmail,
          password: dto.adminPassword,
          tenantId: tenant.id,
          adminName: `${dto.adminFirstName} ${dto.adminLastName}`,
        },
        admin,
      };
    });
  }

  async update(id: string, data: Partial<CreateTenantDto>) {
    await this.findById(id);
    return this.prisma.tenant.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.state !== undefined && { state: data.state }),
        ...(data.pincode !== undefined && { pincode: data.pincode }),
        ...(data.gstin !== undefined && { gstin: data.gstin }),
        ...(data.drugLicenseNo !== undefined && { drugLicenseNo: data.drugLicenseNo }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.registrationNo !== undefined && { registrationNo: data.registrationNo }),
        ...(data.tagline !== undefined && { tagline: data.tagline }),
        ...(data.printHeader !== undefined && { printHeader: data.printHeader }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.pharmacyName !== undefined && { pharmacyName: data.pharmacyName }),
        ...(data.portalUrl !== undefined && { portalUrl: data.portalUrl }),
        ...(data.subscriptionTier !== undefined && { subscriptionTier: data.subscriptionTier as any }),
      },
    });
  }

  async updateProfile(tenantId: string, data: Partial<CreateTenantDto>) {
    return this.update(tenantId, data);
  }

  async deactivate(id: string) {
    return this.prisma.tenant.update({ where: { id }, data: { isActive: false } });
  }

  async resetAdminPassword(tenantId: string) {
    const admin = await this.prisma.user.findFirst({
      where: { tenantId, role: 'ADMIN', isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!admin) throw new NotFoundException('Admin user not found for this tenant');
    const newPassword = this.generateSecurePassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: admin.id }, data: { passwordHash } });
    return {
      email: admin.email,
      adminName: `${admin.firstName} ${admin.lastName}`,
      temporaryPassword: newPassword,
      tenantId,
    };
  }

  private generateSecurePassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '@#$!';
    let pwd = upper[Math.floor(Math.random() * upper.length)]
      + lower[Math.floor(Math.random() * lower.length)]
      + digits[Math.floor(Math.random() * digits.length)]
      + special[Math.floor(Math.random() * special.length)];
    const all = upper + lower + digits;
    for (let i = 0; i < 6; i++) pwd += all[Math.floor(Math.random() * all.length)];
    return pwd.split('').sort(() => Math.random() - 0.5).join('');
  }
}
