import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Appointment,
  Invoice,
  IPDAdmission,
  LabOrder,
  Bed,
  PharmacyOrder,
  PharmacyInventory,
  Department,
} from '@mediflow/database';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Appointment,
      Invoice,
      IPDAdmission,
      LabOrder,
      Bed,
      PharmacyOrder,
      PharmacyInventory,
      Department,
    ]),
  ],
  providers: [StatsService],
  controllers: [StatsController],
  exports: [StatsService],
})
export class StatsModule {}
