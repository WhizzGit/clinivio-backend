// @ts-check
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const TENANT_ID = '7297d065-93f1-4487-b497-0551965cf607';

async function hash(password) {
  return bcrypt.hash(password, 12);
}

async function main() {
  console.log('🌱  Seeding database...\n');

  // ── Super Admin tenant (platform-level, no hospital) ─────────────────────────
  const superTenant = await prisma.tenant.upsert({
    where: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    update: {},
    create: {
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      name: 'MediFlow Platform',
      subscriptionTier: 'ENTERPRISE',
    },
  });

  await prisma.user.upsert({
    where: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001' },
    update: {},
    create: {
      id:           'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
      tenantId:     superTenant.id,
      email:        'superadmin@mediflow.io',
      passwordHash: await hash('SuperAdmin@123'),
      firstName:    'MediFlow',
      lastName:     'Admin',
      role:         'SUPER_ADMIN',
    },
  });
  console.log('  ✓ SUPER_ADMIN  superadmin@mediflow.io  (SuperAdmin@123)');

  // ── Green Valley Hospital ────────────────────────────────────────────────────
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id:               TENANT_ID,
      name:             'Green Valley Hospital',
      address:          '12, MG Road',
      city:             'Bangalore',
      state:            'Karnataka',
      phone:            '+91-80-12345678',
      email:            'info@greenvalley.com',
      subscriptionTier: 'PREMIUM',
    },
  });
  console.log('  ✓ Tenant: Green Valley Hospital (' + TENANT_ID + ')\n');

  // ── Staff ────────────────────────────────────────────────────────────────────
  const staff = [
    { email: 'admin@greenvalley.com',      password: 'Admin@123',      firstName: 'Vijay',   lastName: 'Kumar',   role: 'ADMIN'          },
    { email: 'dr.patel@greenvalley.com',   password: 'Doctor@1234',    firstName: 'Rajesh',  lastName: 'Patel',   role: 'DOCTOR'         },
    { email: 'reception@greenvalley.com',  password: 'Reception@1234', firstName: 'Meena',   lastName: 'Sharma',  role: 'RECEPTIONIST'   },
    { email: 'nurse@greenvalley.com',      password: 'Nurse@1234',     firstName: 'Kavitha', lastName: 'Reddy',   role: 'NURSE'          },
    { email: 'pharmacist@greenvalley.com', password: 'Pharma@1234',    firstName: 'Ravi',    lastName: 'Shankar', role: 'PHARMACIST'     },
    { email: 'lab@greenvalley.com',        password: 'Lab@1234',       firstName: 'Arjun',   lastName: 'Mehta',   role: 'LAB_TECHNICIAN' },
  ];

  for (const s of staff) {
    const user = await prisma.user.upsert({
      where: { tenant_user_email_unique: { tenantId: TENANT_ID, email: s.email } },
      update: {},
      create: {
        tenantId:     TENANT_ID,
        email:        s.email,
        passwordHash: await hash(s.password),
        firstName:    s.firstName,
        lastName:     s.lastName,
        role:         s.role,
      },
    });

    if (s.role === 'DOCTOR') {
      await prisma.doctorProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId:         user.id,
          tenantId:       TENANT_ID,
          specialty:      'General Medicine',
          qualification:  'MBBS, MD',
          registrationNo: 'KMC-12345',
          consultationFee: 500,
          experienceYears: 10,
        },
      });
    }

    console.log(`  ✓ ${s.role.padEnd(15)} ${s.email.padEnd(35)} (${s.password})`);
  }

  console.log('\n✅  Seed complete!');
}

main()
  .catch((e) => { console.error('\n❌  Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
