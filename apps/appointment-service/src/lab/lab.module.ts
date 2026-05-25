import { Module } from '@nestjs/common';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { PrismaService } from '@mediflow/database';

@Module({
  controllers: [LabController],
  providers: [LabService, PrismaService],
  exports: [LabService],
})
export class LabModule {}
