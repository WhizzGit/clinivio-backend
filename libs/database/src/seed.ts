/**
 * TypeORM database seed script.
 *
 * Run:
 *   pnpm db:seed
 *
 * Creates:
 *   - Clinivio Platform tenant + SUPER_ADMIN user
 *   - HANSVL Healthcare sample tenant + ADMIN user
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Tenant, User, DoctorProfile, Department, SubscriptionTier, Role } from './entities';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// ─── Stable IDs ───────────────────────────────────────────────────────────────
const PLATFORM_TENANT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PLATFORM_ADMIN_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
const SAMPLE_TENANT_ID   = '7297d065-93f1-4487-b497-0551965cf607';

async function hash(password: string) {
  return bcrypt.hash(password, 12);
}

async function upsertTenant(
  tenantRepo: any,
  id: string,
  data: Partial<Tenant>,
): Promise<Tenant> {
  const existing = await tenantRepo.findOne({ where: { id } });
  if (existing) return existing;
  return tenantRepo.save(tenantRepo.create({ id, ...data }));
}

async function upsertUser(
  userRepo: any,
  lookup: Partial<User>,
  data: Partial<User>,
): Promise<User> {
  const existing = await userRepo.findOne({ where: lookup });
  if (existing) return existing;
  return userRepo.save(userRepo.create({ ...lookup, ...data }));
}

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [Tenant, User, DoctorProfile, Department],
    synchronize: false,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  });

  await ds.initialize();
  console.log('🌱  Seeding database...\n');

  const tenantRepo = ds.getRepository(Tenant);
  const userRepo   = ds.getRepository(User);

  // ── Clinivio Platform tenant + SUPER_ADMIN ────────────────────────────────────
  await upsertTenant(tenantRepo, PLATFORM_TENANT_ID, {
    name: 'Clinivio Platform',
    subscriptionTier: SubscriptionTier.ENTERPRISE,
  });

  await upsertUser(
    userRepo,
    { id: PLATFORM_ADMIN_ID },
    {
      tenantId:     PLATFORM_TENANT_ID,
      email:        'superadmin@whizzon.ai',
      passwordHash: await hash('SuperAdmin@123'),
      firstName:    'Whizzon',
      lastName:     'Admin',
      role:         Role.SUPER_ADMIN,
    },
  );
  console.log('  ✓ SUPER_ADMIN   superadmin@whizzon.ai          (SuperAdmin@123)');
  console.log('');

  // ── HANSVL Healthcare sample tenant + ADMIN ────────────────────────────────────
  await upsertTenant(tenantRepo, SAMPLE_TENANT_ID, {
    name:             'HANSVL Healthcare',
    address:          '1, Tech Park Road',
    city:             'Chennai',
    state:            'Tamil Nadu',
    phone:            '+91-44-12345678',
    email:            'admin@hansvl.com',
    subscriptionTier: SubscriptionTier.PREMIUM,
  });

  await upsertUser(
    userRepo,
    { tenantId: SAMPLE_TENANT_ID, email: 'admin@hansvl.com' },
    {
      passwordHash: await hash('Admin@123'),
      firstName:    'HANSVL',
      lastName:     'Admin',
      role:         Role.ADMIN,
    },
  );
  console.log('  ✓ Tenant:       HANSVL Healthcare (' + SAMPLE_TENANT_ID + ')');
  console.log('  ✓ ADMIN         admin@hansvl.com               (Admin@123)');
  console.log('');
  console.log('  ℹ  Log in as admin@hansvl.com to create doctors, nurses,');
  console.log('     pharmacists and other staff from the dashboard.');
  console.log('');

  console.log('✅  Seed complete!');
  console.log('');
  console.log('  Platform login:');
  console.log('    Email:    superadmin@whizzon.ai');
  console.log('    Password: SuperAdmin@123');
  console.log('');
  console.log('  Tenant login (tenantId: ' + SAMPLE_TENANT_ID + '):');
  console.log('    Email:    admin@hansvl.com');
  console.log('    Password: Admin@123');

  await ds.destroy();
}

main().catch((e) => {
  console.error('\n❌  Seed failed:', e.message);
  process.exit(1);
});
