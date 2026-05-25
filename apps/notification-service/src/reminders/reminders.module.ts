import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ReminderService } from './reminder.service';
import { PrismaService } from '@mediflow/database';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: [ReminderService, PrismaService],
  exports: [ReminderService],
})
export class RemindersModule {}
