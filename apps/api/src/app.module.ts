import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';

import { DatabaseModule } from '@mediflow/database';
import configuration from './config/configuration';

// Core / Cross-cutting
import { HealthModule } from './health/health.module';
import { KafkaModule } from './kafka/kafka.module';

// IAM
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

// Clinical
import { PatientsModule } from './patients/patients.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { SlotsModule } from './slots/slots.module';
import { DepartmentsModule } from './departments/departments.module';
import { ConsultationModule } from './consultation/consultation.module';

// Clinical support
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { RoomsModule } from './rooms/rooms.module';
import { IpdModule } from './ipd/ipd.module';
import { LabModule } from './lab/lab.module';

// Billing
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';

// Notifications & Messaging
import { NotificationsModule } from './notifications/notifications.module';
import { RemindersModule } from './notifications/reminders/reminder.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

// Analytics
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    // ── Configuration (global) ──────────────────────────────────────────────────
    // Search for .env.local / .env both in the app dir AND the monorepo root
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [
        '.env.local',
        '.env',
        '../../.env.local',   // monorepo root (apps/api → root)
        '../../.env',
      ],
    }),

    // ── Database (global — TypeORM connection pool) ─────────────────────────────
    DatabaseModule,

    // ── Rate limiting ───────────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('throttle.ttl') ?? 60000,
            limit: config.get<number>('throttle.limit') ?? 120,
          },
        ],
      }),
    }),

    // ── Task scheduling (cron jobs) ─────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Bull / Redis queue ──────────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('redis.url');
        if (redisUrl) {
          return { url: redisUrl };
        }
        return {
          redis: {
            host: config.get<string>('redis.host') ?? 'localhost',
            port: config.get<number>('redis.port') ?? 6379,
          },
        };
      },
    }),

    // ── Core infra ──────────────────────────────────────────────────────────────
    HealthModule,
    KafkaModule,

    // ── IAM ─────────────────────────────────────────────────────────────────────
    AuthModule,
    TenantsModule,
    UsersModule,

    // ── Clinical ─────────────────────────────────────────────────────────────────
    PatientsModule,
    AppointmentsModule,
    SlotsModule,
    DepartmentsModule,
    ConsultationModule,

    // ── Clinical support ─────────────────────────────────────────────────────────
    PharmacyModule,
    RoomsModule,
    IpdModule,
    LabModule,

    // ── Billing ───────────────────────────────────────────────────────────────────
    InvoicesModule,
    PaymentsModule,

    // ── Notifications & Messaging ─────────────────────────────────────────────────
    NotificationsModule,
    RemindersModule,
    WhatsappModule,

    // ── Analytics ────────────────────────────────────────────────────────────────
    StatsModule,
  ],
})
export class AppModule {}
