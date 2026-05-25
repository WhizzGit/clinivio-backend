// @ts-check
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

// ─── Platform IDs (stable, never change) ─────────────────────────────────────
const PLATFORM_TENANT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PLATFORM_ADMIN_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';

// ─── Sample tenant ────────────────────────────────────────────────────────────
const SAMPLE_TENANT_ID   = '7297d065-93f1-4487-b497-0551965cf607';

async function hash(password) {
  return bcrypt.hash(password, 12);
}

async function main() {
  console.log('🌱  Seeding database...\n');

  // ── Whizzon.ai Platform (SUPER_ADMIN) ────────────────────────────────────────
  const platformTenant = await prisma.tenant.upsert({
    where:  { id: PLATFORM_TENANT_ID },
    update: {},
    create: {
      id:               PLATFORM_TENANT_ID,
      name:             'Whizzon.ai',
      subscriptionTier: 'ENTERPRISE',
    },
  });

  await prisma.user.upsert({
    where:  { id: PLATFORM_ADMIN_ID },
    update: { email: 'superadmin@whizzon.ai', firstName: 'Whizzon', lastName: 'Admin' },
    create: {
      id:           PLATFORM_ADMIN_ID,
      tenantId:     platformTenant.id,
      email:        'superadmin@whizzon.ai',
      passwordHash: await hash('SuperAdmin@123'),
      firstName:    'Whizzon',
      lastName:     'Admin',
      role:         'SUPER_ADMIN',
    },
  });
  console.log('  ✓ SUPER_ADMIN   superadmin@whizzon.ai          (SuperAdmin@123)');
  console.log('');

  // ── HANSVL Sample Tenant ─────────────────────────────────────────────────────
  // Only the tenant admin is created here.
  // All other staff (doctors, nurses, pharmacists, etc.) are created
  // by the tenant admin through the dashboard — no hardcoding needed.
  await prisma.tenant.upsert({
    where:  { id: SAMPLE_TENANT_ID },
    update: {},
    create: {
      id:               SAMPLE_TENANT_ID,
      name:             'HANSVL Healthcare',
      address:          '1, Tech Park Road',
      city:             'Chennai',
      state:            'Tamil Nadu',
      phone:            '+91-44-12345678',
      email:            'admin@hansvl.com',
      subscriptionTier: 'PREMIUM',
    },
  });

  const tenantAdmin = await prisma.user.upsert({
    where:  { tenant_user_email_unique: { tenantId: SAMPLE_TENANT_ID, email: 'admin@hansvl.com' } },
    update: {},
    create: {
      tenantId:     SAMPLE_TENANT_ID,
      email:        'admin@hansvl.com',
      passwordHash: await hash('Admin@123'),
      firstName:    'HANSVL',
      lastName:     'Admin',
      role:         'ADMIN',
    },
  });
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
  console.log('  Tenant login (use tenantId: ' + SAMPLE_TENANT_ID + '):');
  console.log('    Email:    admin@hansvl.com');
  console.log('    Password: Admin@123');
}

main()
  .catch((e) => { console.error('\n❌  Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
