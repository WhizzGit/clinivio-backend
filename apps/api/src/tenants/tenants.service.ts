import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant, User, Role } from '@mediflow/database';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private dataSource: DataSource,
  ) {}

  findAll() {
    return this.tenantRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findAllWithStats() {
    const tenants = await this.tenantRepo.find({ order: { createdAt: 'DESC' } });
    return Promise.all(
      tenants.map(async (t) => {
        const [userCount, adminUser] = await Promise.all([
          this.userRepo.count({ where: { tenantId: t.id, isActive: true } }),
          this.userRepo.findOne({
            where: { tenantId: t.id, role: Role.ADMIN },
            select: ['email', 'firstName', 'lastName', 'lastLoginAt'],
          }),
        ]);
        return {
          ...t,
          userCount,
          adminEmail: adminUser?.email ?? null,
          adminName: adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : null,
          adminLastLogin: adminUser?.lastLoginAt ?? null,
        };
      }),
    );
  }

  async findById(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    return this.dataSource.transaction(async (manager) => {
      const tenantRepo = manager.getRepository(Tenant);
      const userRepo = manager.getRepository(User);

      const tenant = await tenantRepo.save(
        tenantRepo.create({
          name: dto.name,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
          gstin: dto.gstin,
          drugLicenseNo: dto.drugLicenseNo,
          whatsappPhoneNumberId: dto.whatsappPhoneNumberId,
          wabaId: dto.wabaId,
          subscriptionTier: (dto.subscriptionTier as any) ?? 'BASIC',
          phone: dto.phone,
          email: dto.email,
          website: dto.website,
          registrationNo: dto.registrationNo,
          tagline: dto.tagline,
          printHeader: dto.printHeader,
          pharmacyName: dto.pharmacyName,
          portalUrl: dto.portalUrl,
        }),
      );

      const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
      const admin = await userRepo.save(
        userRepo.create({
          tenantId: tenant.id,
          email: dto.adminEmail,
          passwordHash,
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          phone: dto.adminPhone,
          role: Role.ADMIN,
        }),
      );

      return {
        tenant,
        credentials: {
          email: dto.adminEmail,
          password: dto.adminPassword,
          tenantId: tenant.id,
          adminName: `${dto.adminFirstName} ${dto.adminLastName}`,
        },
        admin: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
        },
      };
    });
  }

  async update(id: string, data: Partial<CreateTenantDto>) {
    await this.findById(id);
    await this.tenantRepo.update(id, {
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
    });
    return this.findById(id);
  }

  async deactivate(id: string) {
    await this.tenantRepo.update(id, { isActive: false });
    return this.findById(id);
  }

  async resetAdminPassword(tenantId: string) {
    const admin = await this.userRepo.findOne({
      where: { tenantId, role: Role.ADMIN, isActive: true },
      select: ['id', 'email', 'firstName', 'lastName'],
    });
    if (!admin) throw new NotFoundException('Admin user not found for this tenant');
    const newPassword = this.generateSecurePassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(admin.id, { passwordHash });
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
    let pwd =
      upper[Math.floor(Math.random() * upper.length)] +
      lower[Math.floor(Math.random() * lower.length)] +
      digits[Math.floor(Math.random() * digits.length)] +
      special[Math.floor(Math.random() * special.length)];
    const all = upper + lower + digits;
    for (let i = 0; i < 6; i++) pwd += all[Math.floor(Math.random() * all.length)];
    return pwd.split('').sort(() => Math.random() - 0.5).join('');
  }
}
