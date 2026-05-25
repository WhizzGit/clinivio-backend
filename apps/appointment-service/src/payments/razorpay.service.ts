import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay = require('razorpay');

@Injectable()
export class RazorpayService {
  private readonly client: Razorpay;
  private readonly webhookSecret: string;
  private readonly logger = new Logger(RazorpayService.name);

  constructor(private configService: ConfigService) {
    this.client = new Razorpay({
      key_id: this.configService.get<string>('razorpay.keyId'),
      key_secret: this.configService.get<string>('razorpay.keySecret'),
    });
    this.webhookSecret = this.configService.get<string>('razorpay.webhookSecret') || '';
  }

  async createOrder(amountPaisa: number, receipt: string): Promise<any> {
    try {
      const order = await this.client.orders.create({
        amount: amountPaisa,
        currency: 'INR',
        receipt,
      });
      return order;
    } catch (err) {
      this.logger.error(`Failed to create Razorpay order: ${err.message}`);
      throw err;
    }
  }

  verifyWebhookSignature(body: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');
    return expectedSignature === signature;
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const payload = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.configService.get<string>('razorpay.keySecret') || '')
      .update(payload)
      .digest('hex');
    return expectedSignature === signature;
  }
}
