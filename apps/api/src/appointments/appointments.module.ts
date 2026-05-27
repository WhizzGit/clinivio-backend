import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Appointment, DoctorSlot, PharmacyOrder,
  Consultation, Prescription, PrescriptionItem, FollowUp,
} from '@mediflow/database';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { RazorpayService } from '../payments/razorpay.service';
import { ConsultationService } from '../consultation/consultation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Appointment, DoctorSlot, PharmacyOrder,
      // Consultation sub-entities needed by nested routes
      Consultation, Prescription, PrescriptionItem, FollowUp,
    ]),
  ],
  providers: [AppointmentsService, RazorpayService, ConsultationService],
  controllers: [AppointmentsController],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
