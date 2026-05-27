import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ReminderService } from './reminder.service';

/**
 * NOTE: ReminderService uses cron jobs that run without a tenant ALS context.
 * It queries across ALL tenants using the platform (public) DataSource injected via
 * @InjectDataSource(). After full schema-per-tenant migration, the cron jobs should
 * be refactored to iterate over TenantDataSourceRegistry.getAll() or use a
 * cross-tenant reminder-queue table in the public schema.
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'notifications' })],
  providers: [ReminderService],
})
export class RemindersModule {}
