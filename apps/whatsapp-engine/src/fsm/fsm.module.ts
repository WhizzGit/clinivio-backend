import { Module } from '@nestjs/common';
import { FsmService } from './fsm.service';
import { SessionModule } from '../session/session.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RegistrationFlowService } from '../flows/registration.flow';
import { BookingFlowService } from '../flows/booking.flow';

@Module({
  imports: [SessionModule, WhatsappModule],
  providers: [FsmService, RegistrationFlowService, BookingFlowService],
  exports: [FsmService],
})
export class FsmModule {}
