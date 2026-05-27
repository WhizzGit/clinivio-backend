import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { RazorpayService } from '../payments/razorpay.service';
import { ConsultationModule } from '../consultation/consultation.module';

@Module({
  imports: [ConsultationModule],
  providers: [AppointmentsService, RazorpayService],
  controllers: [AppointmentsController],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
