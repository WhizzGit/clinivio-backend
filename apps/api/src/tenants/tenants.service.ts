import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant, User, Role, TenantDataSourceRegistry } from '@mediflow/database';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectDataSource() private readonly platformDs: DataSource,
    private readonly registry: TenantDataSourceRegistry,
  ) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  findAll() {
    return this.tenantRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findAllWithStats() {
    const tenants = await this.tenantRepo.find({ order: { createdAt: 'DESC' } });
    return Promise.all(
      tenants.map(async (t) => {
        try {
          const tenantDs = await this.registry.getOrCreate(t.id, t.slug);
          const [userCount, adminUser] = await Promise.all([
            tenantDs.getRepository(User).count({ where: { isActive: true } }),
            tenantDs.getRepository(User).findOne({
              where: { role: Role.ADMIN },
              select: ['email', 'firstName', 'lastName', 'lastLoginAt'],
            }),
          ]);
          return {
            ...t,
            userCount,
            adminEmail: adminUser?.email ?? null,
            adminName: adminUser
              ? `${adminUser.firstName} ${adminUser.lastName}`
              : null,
            adminLastLogin: adminUser?.lastLoginAt ?? null,
          };
        } catch {
          // Schema may not exist yet for legacy / failed tenants
          return {
            ...t,
            userCount: 0,
            adminEmail: null,
            adminName: null,
            adminLastLogin: null,
          };
        }
      }),
    );
  }

  async findById(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  async create(dto: CreateTenantDto) {
    // 1. Derive slug
    const slug = dto.slug
      ? dto.slug.toLowerCase()
      : this.generateSlug(dto.name);

    // 2. Ensure uniqueness
    const existing = await this.tenantRepo.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Tenant slug '${slug}' is already taken`);
    }

    // 3. Persist tenant record in platform (public) schema
    const tenant = await this.tenantRepo.save(
      this.tenantRepo.create({
        name: dto.name,
        slug,
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
        portalUrl: dto.portalUrl ?? `https://${slug}.clinivio.ai`,
      }),
    );

    // 4. Create PostgreSQL schema for the tenant
    await this.platformDs.query(
      `CREATE SCHEMA IF NOT EXISTS "tenant_${slug}"`,
    );
    this.logger.log(`Created schema tenant_${slug} for tenant "${tenant.name}"`);

    // 5. Initialise per-tenant DataSource (synchronize = true in dev → creates tables)
    const tenantDs = await this.registry.getOrCreate(tenant.id, slug);
    this.logger.log(`DataSource initialised for tenant_${slug}`);

    // 6. Seed the admin user in the tenant schema
    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
    const admin = await tenantDs.getRepository(User).save(
      tenantDs.getRepository(User).create({
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
        tenantSlug: slug,
        portalUrl: tenant.portalUrl,
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
      ...(data.subscriptionTier !== undefined && {
        subscriptionTier: data.subscriptionTier as any,
      }),
    });
    return this.findById(id);
  }

  async deactivate(id: string) {
    const tenant = await this.findById(id);
    await this.tenantRepo.update(id, { isActive: false });
    // Evict the cached DataSource so it closes connections
    await this.registry.evict(id);
    return this.findById(id);
  }

  async resetAdminPassword(tenantId: string) {
    const tenant = await this.findById(tenantId);
    const tenantDs = await this.registry.getOrCreate(tenant.id, tenant.slug);

    const admin = await tenantDs.getRepository(User).findOne({
      where: { role: Role.ADMIN, isActive: true },
      select: ['id', 'email', 'firstName', 'lastName'],
    });
    if (!admin) throw new NotFoundException('Admin user not found for this tenant');

    const newPassword = this.generateSecurePassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await tenantDs.getRepository(User).update(admin.id, { passwordHash });

    return {
      email: admin.email,
      adminName: `${admin.firstName} ${admin.lastName}`,
      temporaryPassword: newPassword,
      tenantId,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Converts a name to a URL-safe slug.
   * "Apollo Hospital" → "apollo-hospital"
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
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
    return pwd
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  }
}
