import {
  Controller, Post, Body, Req, Headers, HttpCode, Logger, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { RazorpayService } from './razorpay.service';
import { InvoicesService } from '../invoices/invoices.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KAFKA_TOPICS } from '@mediflow/shared';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private razorpayService: RazorpayService,
    private invoicesService: InvoicesService,
    private kafka: KafkaProducerService,
  ) {}

  @Post('razorpay/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Razorpay payment webhook' })
  async handleWebhook(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
    @Body() body: any,
  ): Promise<{ status: string }> {
    const rawBody: Buffer = (req as any).rawBody;

    if (!this.razorpayService.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = body?.event;
    const payment = body?.payload?.payment?.entity;

    if (!payment) return { status: 'ignored' };

    this.logger.log(`Razorpay webhook event: ${event}, paymentId: ${payment.id}`);

    try {
      if (event === 'payment.captured') {
        const invoiceId = payment.notes?.invoiceId;
        const tenantId = payment.notes?.tenantId;

        if (invoiceId && tenantId) {
          await this.invoicesService.markPaid(invoiceId, tenantId, payment.id);
        }

        await this.kafka.emit(KAFKA_TOPICS.PAYMENT_CAPTURED, {
          event: 'payment.captured',
          timestamp: new Date().toISOString(),
          data: {
            paymentId: payment.id,
            orderId: payment.order_id,
            amount: payment.amount / 100,
            invoiceId: payment.notes?.invoiceId,
            tenantId: payment.notes?.tenantId,
            patientId: payment.notes?.patientId,
          },
        });
      } else if (event === 'payment.failed') {
        await this.kafka.emit(KAFKA_TOPICS.PAYMENT_FAILED, {
          event: 'payment.failed',
          timestamp: new Date().toISOString(),
          data: {
            paymentId: payment.id,
            orderId: payment.order_id,
            errorCode: payment.error_code,
            invoiceId: payment.notes?.invoiceId,
            tenantId: payment.notes?.tenantId,
          },
        });
      }
    } catch (err: any) {
      this.logger.error(`Webhook handling error: ${err.message}`, err.stack);
    }

    return { status: 'ok' };
  }
}
