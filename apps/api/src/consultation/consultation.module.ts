import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Consultation,
  Prescription,
  PrescriptionItem,
  FollowUp,
  Appointment,
} from '@mediflow/database';
import { ConsultationService } from './consultation.service';
import { ConsultationController } from './consultation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Consultation,
      Prescription,
      PrescriptionItem,
      FollowUp,
      Appointment,
    ]),
  ],
  providers: [ConsultationService],
  controllers: [ConsultationController],
  exports: [ConsultationService],
})
export class ConsultationModule {}
