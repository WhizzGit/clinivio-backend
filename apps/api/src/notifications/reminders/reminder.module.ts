import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Appointment, NotificationLog } from '@mediflow/database';
import { ReminderService } from './reminder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, NotificationLog]),
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: [ReminderService],
})
export class RemindersModule {}
