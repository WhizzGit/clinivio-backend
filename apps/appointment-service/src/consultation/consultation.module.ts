import { Module } from '@nestjs/common';
import { ConsultationService } from './consultation.service';
import { ConsultationController, PatientHistoryController } from './consultation.controller';
import { PrismaService } from '@mediflow/database';

@Module({
  controllers: [ConsultationController, PatientHistoryController],
  providers: [ConsultationService, PrismaService],
  exports: [ConsultationService],
})
export class ConsultationModule {}
