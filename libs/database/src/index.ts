export { PrismaService } from './prisma.service';

// Re-export all generated Prisma types and enums for use across services
export {
  Prisma,
  PrismaClient,
  // Enums
  Role,
  Gender,
  Language,
  AppointmentType,
  AppointmentStatus,
  VisitType,
  PaymentStatus,
  InvoiceType,
  NotificationChannel,
  NotificationStatus,
  SubscriptionTier,
  PharmacyOrderStatus,
  // Model types (as plain objects selected from Prisma)
} from '@prisma/client';

export type {
  Tenant,
  User,
  Department,
  DoctorProfile,
  PatientFamily,
  Patient,
  DoctorSlot,
  Appointment,
  Consultation,
  Prescription,
  PrescriptionItem,
  FollowUp,
  PharmacyOrder,
  Invoice,
  NotificationLog,
} from '@prisma/client';
