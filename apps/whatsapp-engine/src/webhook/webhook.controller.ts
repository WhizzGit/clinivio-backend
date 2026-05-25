import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  HttpCode,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { FsmService } from '../fsm/fsm.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KAFKA_TOPICS } from '@mediflow/shared';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(
    private configService: ConfigService,
    private fsmService: FsmService,
    private kafkaProducer: KafkaProducerService,
  ) {
    this.verifyToken = configService.get<string>('whatsapp.verifyToken') || 'mediflow-verify-token';
    this.appSecret = configService.get<string>('whatsapp.appSecret') || '';
  }

  @Get()
  challenge(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('WhatsApp webhook verified');
      return challenge;
    }
    throw new UnauthorizedException('Invalid verify token');
  }

  @Post()
  @HttpCode(200)
  async handleWebhook(@Req() req: Request, @Body() body: any): Promise<string> {
    if (this.appSecret) {
      const signature = (req.headers['x-hub-signature-256'] as string) || '';
      const rawBody: Buffer = (req as any).rawBody;

      if (!rawBody || !this.verifySignature(rawBody, signature)) {
        this.logger.warn('Invalid WhatsApp HMAC signature');
        throw new UnauthorizedException('Invalid signature');
      }
    }

    try {
      const entries = body?.entry || [];
      for (const entry of entries) {
        for (const change of entry?.changes || []) {
          const value = change?.value;
          if (!value) continue;

          // Status updates (delivery, read receipts)
          const statuses = value?.statuses || [];
          for (const status of statuses) {
            await this.kafkaProducer.emit(KAFKA_TOPICS.WHATSAPP_STATUS_UPDATE, {
              event: 'whatsapp.status',
              data: status,
            });
          }

          // Inbound messages
          const messages = value?.messages || [];
          const contacts = value?.contacts || [];

          for (const msg of messages) {
            const phone = msg.from;
            const contactName = contacts.find((c: any) => c.wa_id === phone)?.profile?.name || '';

            let text = '';
            let interactiveReply: { id: string; title: string } | undefined;

            if (msg.type === 'text') {
              text = msg.text?.body || '';
            } else if (msg.type === 'interactive') {
              const interactive = msg.interactive;
              if (interactive?.type === 'button_reply') {
                const reply = interactive.button_reply;
                text = reply?.id || '';
                interactiveReply = { id: reply?.id, title: reply?.title };
              } else if (interactive?.type === 'list_reply') {
                const reply = interactive.list_reply;
                text = reply?.id || '';
                interactiveReply = { id: reply?.id, title: reply?.title };
              }
            }

            const event = {
              event: 'whatsapp.inbound',
              timestamp: new Date().toISOString(),
              data: {
                phone,
                contactName,
                message: { text, interactiveReply },
                messageId: msg.id,
                tenantId: '',
              },
            };

            // Publish to Kafka for audit trail
            await this.kafkaProducer.emit(KAFKA_TOPICS.WHATSAPP_INBOUND_MESSAGE, event);

            // Process through FSM directly
            await this.fsmService.processMessage(event as any);
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Webhook processing error: ${err.message}`, err.stack);
    }

    return 'EVENT_RECEIVED';
  }

  private verifySignature(rawBody: Buffer, signatureHeader: string): boolean {
    if (!signatureHeader.startsWith('sha256=')) return false;
    const expected = signatureHeader.slice('sha256='.length);
    const hmac = createHmac('sha256', this.appSecret);
    hmac.update(rawBody);
    const computed = hmac.digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(computed, 'hex'));
    } catch {
      return false;
    }
  }
}
