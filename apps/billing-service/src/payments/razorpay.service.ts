import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import Razorpay = require('razorpay');

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private client: Razorpay;
  private readonly webhookSecret: string;

  constructor(private configService: ConfigService) {
    const keyId = this.configService.get<string>('razorpay.keyId') || '';
    const keySecret = this.configService.get<string>('razorpay.keySecret') || '';
    this.webhookSecret = this.configService.get<string>('razorpay.webhookSecret') || '';
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  async createOrder(amount: number, currency = 'INR', receiptId: string): Promise<any> {
    return this.client.orders.create({
      amount: Math.round(amount * 100),
      currency,
      receipt: receiptId,
    });
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    if (!this.webhookSecret) return true;
    const hmac = createHmac('sha256', this.webhookSecret);
    hmac.update(rawBody);
    const computed = hmac.digest('hex');
    return computed === signatureHeader;
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const keySecret = this.configService.get<string>('razorpay.keySecret') || '';
    const body = `${orderId}|${paymentId}`;
    const hmac = createHmac('sha256', keySecret);
    hmac.update(body);
    const computed = hmac.digest('hex');
    return computed === signature;
  }
}
