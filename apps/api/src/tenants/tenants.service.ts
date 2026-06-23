import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectDataSource } from "@nestjs/typeorm";
import { Repository, DataSource } from "typeorm";
import * as bcrypt from "bcrypt";
import {
  Tenant,
  User,
  Role,
  TenantDataSourceRegistry,
} from "@mediflow/database";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";

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
    return this.tenantRepo.find({ order: { createdAt: "DESC" } });
  }

  async findAllWithStats() {
    const tenants = await this.tenantRepo.find({
      order: { createdAt: "DESC" },
    });
    return Promise.all(
      tenants.map(async (t) => {
        // Skip the platform tenant (slug = null) — it has no tenant schema
        if (!t.slug) {
          return {
            ...t,
            userCount: 0,
            adminEmail: null,
            adminName: null,
            adminLastLogin: null,
          };
        }
        try {
          const tenantDs = await this.registry.getOrCreate(t.id, t.slug);
          const [userCount, adminUser] = await Promise.all([
            tenantDs.getRepository(User).count({ where: { isActive: true } }),
            tenantDs.getRepository(User).findOne({
              where: { role: Role.ADMIN },
              select: ["email", "firstName", "lastName", "lastLoginAt"],
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
    if (!tenant) throw new NotFoundException("Tenant not found");
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
        subscriptionTier: (dto.subscriptionTier as any) ?? "BASIC",
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
    await this.platformDs.query(`CREATE SCHEMA IF NOT EXISTS "tenant_${slug}"`);
    this.logger.log(
      `Created schema tenant_${slug} for tenant "${tenant.name}"`,
    );

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

  /**
   * Update any combination of tenant profile fields and/or admin user credentials.
   * SuperAdmin can change everything that was set during onboarding in a single call.
   */
  async update(id: string, data: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findById(id);

    // ── 1. Tenant profile fields ────────────────────────────────────────────
    const tenantPatch: Partial<Tenant> = {};
    const str = (v: string | undefined) => v !== undefined;
    if (str(data.name)) tenantPatch.name = data.name!;
    if (str(data.address)) tenantPatch.address = data.address!;
    if (str(data.city)) tenantPatch.city = data.city!;
    if (str(data.state)) tenantPatch.state = data.state!;
    if (str(data.stateCode)) tenantPatch.stateCode = data.stateCode!;
    if (str(data.pincode)) tenantPatch.pincode = data.pincode!;
    if (str(data.gstin)) tenantPatch.gstin = data.gstin!;
    if (data.cgstRate !== undefined)
      tenantPatch.cgstRate = String(data.cgstRate);
    if (data.sgstRate !== undefined)
      tenantPatch.sgstRate = String(data.sgstRate);
    if (data.igstRate !== undefined)
      tenantPatch.igstRate = String(data.igstRate);
    if (str(data.drugLicenseNo))
      tenantPatch.drugLicenseNo = data.drugLicenseNo!;
    if (str(data.abhaHipId)) tenantPatch.abhaHipId = data.abhaHipId!;
    if (str(data.whatsappPhoneNumberId))
      tenantPatch.whatsappPhoneNumberId = data.whatsappPhoneNumberId!;
    if (str(data.wabaId)) tenantPatch.wabaId = data.wabaId!;
    if (str(data.phone)) tenantPatch.phone = data.phone!;
    if (str(data.email)) tenantPatch.email = data.email!;
    if (str(data.website)) tenantPatch.website = data.website!;
    if (str(data.registrationNo))
      tenantPatch.registrationNo = data.registrationNo!;
    if (str(data.tagline)) tenantPatch.tagline = data.tagline!;
    if (str(data.printHeader)) tenantPatch.printHeader = data.printHeader!;
    if (str(data.logoUrl)) tenantPatch.logoUrl = data.logoUrl!;
    if (str(data.pharmacyName)) tenantPatch.pharmacyName = data.pharmacyName!;
    if (str(data.portalUrl)) tenantPatch.portalUrl = data.portalUrl!;
    if (data.subscriptionTier !== undefined)
      tenantPatch.subscriptionTier = data.subscriptionTier as any;
    if (data.isActive !== undefined) tenantPatch.isActive = data.isActive;

    if (Object.keys(tenantPatch).length) {
      await this.tenantRepo.update(id, tenantPatch);
    }

    // ── 2. Admin user fields (only if any admin field was supplied) ──────────
    const hasAdminUpdate =
      data.adminEmail !== undefined ||
      data.adminPassword !== undefined ||
      data.adminFirstName !== undefined ||
      data.adminLastName !== undefined ||
      data.adminPhone !== undefined;

    if (hasAdminUpdate) {
      if (!tenant.slug) {
        throw new ConflictException(
          "Cannot update admin user for the platform tenant via this endpoint",
        );
      }
      const tenantDs = await this.registry.getOrCreate(id, tenant.slug);
      const userRepo = tenantDs.getRepository(User);

      const admin = await userRepo.findOne({
        where: { role: Role.ADMIN, isActive: true },
      });
      if (!admin) {
        throw new NotFoundException(
          "No active ADMIN user found for this tenant",
        );
      }

      const userPatch: Partial<User> = {};
      if (str(data.adminEmail)) userPatch.email = data.adminEmail!;
      if (str(data.adminFirstName)) userPatch.firstName = data.adminFirstName!;
      if (str(data.adminLastName)) userPatch.lastName = data.adminLastName!;
      if (str(data.adminPhone)) userPatch.phone = data.adminPhone!;
      if (str(data.adminPassword))
        userPatch.passwordHash = await bcrypt.hash(data.adminPassword!, 12);

      await userRepo.update(admin.id, userPatch);
      this.logger.log(`Updated admin user ${admin.id} for tenant ${id}`);
    }

    return this.findById(id);
  }

  async deactivate(id: string) {
    const tenant = await this.findById(id);
    await this.tenantRepo.update(id, { isActive: false });
    // Evict the cached DataSource so it closes connections
    await this.registry.evict(id);
    return this.findById(id);
  }

  /**
   * Permanently deletes a tenant — drops its schema and removes the public.tenants row.
   * The platform tenant (slug = null) cannot be deleted.
   */
  async delete(id: string): Promise<{ message: string }> {
    const tenant = await this.findById(id);

    if (!tenant.slug) {
      throw new ForbiddenException("The platform tenant cannot be deleted");
    }

    // 1. Close and evict the cached DataSource for this tenant
    await this.registry.evict(id);

    // 2. Drop the entire PostgreSQL schema (CASCADE removes all tables & data)
    await this.platformDs.query(
      `DROP SCHEMA IF EXISTS "tenant_${tenant.slug}" CASCADE`,
    );
    this.logger.log(`Dropped schema tenant_${tenant.slug}`);

    // 3. Remove the tenant record from the public schema
    await this.tenantRepo.delete(id);
    this.logger.log(`Deleted tenant record ${id} (${tenant.name})`);

    return { message: `Tenant '${tenant.name}' has been permanently deleted` };
  }

  async resetAdminPassword(tenantId: string) {
    const tenant = await this.findById(tenantId);
    const tenantDs = await this.registry.getOrCreate(tenant.id, tenant.slug);

    const admin = await tenantDs.getRepository(User).findOne({
      where: { role: Role.ADMIN, isActive: true },
      select: ["id", "email", "firstName", "lastName"],
    });
    if (!admin)
      throw new NotFoundException("Admin user not found for this tenant");

    const newPassword = this.generateSecurePassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await tenantDs.getRepository(User).update(admin.id, { passwordHash });

    return {
      email: admin.email,
      adminName: `${admin.firstName} ${admin.lastName}`,
      temporaryPassword: newPassword,
      tenantId,
      tenantSlug: tenant.slug,
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
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  }

  private generateSecurePassword(): string {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const special = "@#$!";
    let pwd =
      upper[Math.floor(Math.random() * upper.length)] +
      lower[Math.floor(Math.random() * lower.length)] +
      digits[Math.floor(Math.random() * digits.length)] +
      special[Math.floor(Math.random() * special.length)];
    const all = upper + lower + digits;
    for (let i = 0; i < 6; i++)
      pwd += all[Math.floor(Math.random() * all.length)];
    return pwd
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
  }
}
