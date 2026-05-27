import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  IPDAdmission,
  IPDVitalSnapshot,
  IPDTreatment,
  IPDProcedure,
  DischargeAdvice,
  DischargeSummary,
  Bed,
  Room,
} from '@mediflow/database';
import { IpdService } from './ipd.service';
import { IpdController } from './ipd.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IPDAdmission,
      IPDVitalSnapshot,
      IPDTreatment,
      IPDProcedure,
      DischargeAdvice,
      DischargeSummary,
      Bed,
      Room,
    ]),
  ],
  providers: [IpdService],
  controllers: [IpdController],
  exports: [IpdService],
})
export class IpdModule {}
