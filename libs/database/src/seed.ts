/**
 * TypeORM database seed script.
 *
 * Run:
 *   pnpm db:seed
 *
 * Creates / updates:
 *   - Clinivio Platform tenant + SUPER_ADMIN in public schema
 *   - HANSVL Healthcare sample tenant (slug: hansvl)
 *     → provisions tenant_hansvl schema
 *     → inserts ADMIN user in the tenant schema
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Tenant, User, SubscriptionTier, Role } from './entities';
import { ALL_ENTITIES } from './entities';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// ─── Stable IDs ───────────────────────────────────────────────────────────────
const PLATFORM_TENANT_ID   = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PLATFORM_ADMIN_ID    = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
const SAMPLE_TENANT_ID     = '7297d065-93f1-4487-b497-0551965cf607';
const SAMPLE_TENANT_SLUG   = 'hansvl';

async function hash(password: string) {
  return bcrypt.hash(password, 12);
}

async function upsertTenant(tenantRepo: any, id: string, data: Partial<Tenant>): Promise<void> {
  const existing = await tenantRepo.findOne({ where: { id } });
  if (existing) {
    // Patch any null fields that may have been added since first seed (e.g. slug)
    const patches: Partial<Tenant> = {};
    for (const [key, value] of Object.entries(data)) {
      if ((existing as any)[key] == null && value != null) {
        (patches as any)[key] = value;
      }
    }
    if (Object.keys(patches).length) await tenantRepo.update(id, patches);
  } else {
    await tenantRepo.save(tenantRepo.create({ id, ...data }));
  }
}

async function upsertUser(userRepo: any, lookup: Partial<User>, data: Partial<User>): Promise<void> {
  const existing = await userRepo.findOne({ where: lookup });
  if (!existing) {
    await userRepo.save(userRepo.create({ ...lookup, ...data }));
  }
}

function makeSslOption(isProd: boolean) {
  return isProd ? { rejectUnauthorized: false } : false;
}

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const dbUrl  = process.env.DATABASE_URL!;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  // ─── Platform DataSource (public schema) ──────────────────────────────────
  const platformDs = new DataSource({
    type: 'postgres',
    url: dbUrl,
    entities: ALL_ENTITIES,
    synchronize: !isProd,    // adds slug column if missing
    ssl: makeSslOption(isProd),
  });
  await platformDs.initialize();
  console.log('🌱  Seeding database...\n');

  const tenantRepo = platformDs.getRepository(Tenant);
  const platformUserRepo = platformDs.getRepository(User);

  // ── 1. Clinivio Platform tenant + SUPER_ADMIN (in public schema) ───────────
  await upsertTenant(tenantRepo, PLATFORM_TENANT_ID, {
    name: 'Clinivio Platform',
    subscriptionTier: SubscriptionTier.ENTERPRISE,
  });

  await upsertUser(
    platformUserRepo,
    { id: PLATFORM_ADMIN_ID },
    {
      tenantId:     PLATFORM_TENANT_ID,
      email:        'superadmin@whizzon.ai',
      passwordHash: await hash('SuperAdmin@123'),
      firstName:    'Whizzon',
      lastName:     'Admin',
      role:         Role.SUPER_ADMIN,
      isActive:     true,
    },
  );
  console.log('  ✓ SUPER_ADMIN   superadmin@whizzon.ai  (SuperAdmin@123)  [public schema]');

  // ── 2. HANSVL Healthcare tenant record (in public schema) ─────────────────
  await upsertTenant(tenantRepo, SAMPLE_TENANT_ID, {
    name:             'HANSVL Healthcare',
    slug:             SAMPLE_TENANT_SLUG,
    address:          '1, Tech Park Road',
    city:             'Chennai',
    state:            'Tamil Nadu',
    phone:            '+91-44-12345678',
    email:            'admin@hansvl.com',
    portalUrl:        'https://hansvl.clinivio.ai',
    subscriptionTier: SubscriptionTier.PREMIUM,
    isActive:         true,
  });
  console.log(`  ✓ Tenant record  HANSVL Healthcare  slug=${SAMPLE_TENANT_SLUG}  [public.tenants]`);

  // ── 3. Provision tenant_hansvl schema + insert admin user ─────────────────
  // Ensure the schema exists first
  await platformDs.query(`CREATE SCHEMA IF NOT EXISTS "tenant_${SAMPLE_TENANT_SLUG}"`);
  console.log(`  ✓ Schema         tenant_${SAMPLE_TENANT_SLUG} created/verified`);

  const tenantDs = new DataSource({
    type: 'postgres',
    url: dbUrl,
    schema: `tenant_${SAMPLE_TENANT_SLUG}`,
    entities: ALL_ENTITIES,
    synchronize: !isProd,   // creates all tables in tenant schema
    ssl: makeSslOption(isProd),
  });
  await tenantDs.initialize();
  console.log(`  ✓ Tenant schema  tenant_${SAMPLE_TENANT_SLUG} tables synced`);

  const tenantUserRepo = tenantDs.getRepository(User);
  await upsertUser(
    tenantUserRepo,
    { tenantId: SAMPLE_TENANT_ID, email: 'admin@hansvl.com' },
    {
      tenantId:     SAMPLE_TENANT_ID,
      email:        'admin@hansvl.com',
      passwordHash: await hash('Admin@123'),
      firstName:    'HANSVL',
      lastName:     'Admin',
      role:         Role.ADMIN,
      isActive:     true,
    },
  );
  console.log(`  ✓ ADMIN          admin@hansvl.com  (Admin@123)  [tenant_${SAMPLE_TENANT_SLUG} schema]`);

  console.log('');
  console.log('✅  Seed complete!\n');
  console.log('  Platform login (no tenant context):');
  console.log('    POST /auth/login  { "email": "superadmin@whizzon.ai", "password": "SuperAdmin@123" }');
  console.log('');
  console.log(`  Tenant login (header  X-Tenant-Slug: ${SAMPLE_TENANT_SLUG}):`);;
  console.log('    POST /auth/login  { "email": "admin@hansvl.com", "password": "Admin@123" }');

  await tenantDs.destroy();
  await platformDs.destroy();
}

main().catch((e) => {
  console.error('\n❌  Seed failed:', e.message, e.stack);
  process.exit(1);
});
