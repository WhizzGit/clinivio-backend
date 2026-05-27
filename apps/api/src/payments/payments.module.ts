import { Module } from '@nestjs/common';
import { RazorpayService } from './razorpay.service';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [InvoicesModule],
  providers: [RazorpayService],
  exports: [RazorpayService],
})
export class PaymentsModule {}
