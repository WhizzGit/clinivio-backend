import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PrismaService } from '@mediflow/database';

@Module({
  providers: [QueueService, PrismaService],
  exports: [QueueService],
})
export class QueueModule {}
