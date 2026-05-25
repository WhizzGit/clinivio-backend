import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { RazorpayService } from './razorpay.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

@Module({
  imports: [InvoicesModule],
  controllers: [PaymentsController],
  providers: [RazorpayService, KafkaProducerService],
  exports: [RazorpayService],
})
export class PaymentsModule {}
