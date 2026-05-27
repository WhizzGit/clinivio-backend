import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LabTest, LabOrder, LabOrderItem, Invoice } from '@mediflow/database';
import { LabService } from './lab.service';
import { LabController } from './lab.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LabTest, LabOrder, LabOrderItem, Invoice])],
  providers: [LabService],
  controllers: [LabController],
  exports: [LabService],
})
export class LabModule {}
