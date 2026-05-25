import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { KAFKA_TOPICS, WhatsAppInboundMessageEvent } from '@mediflow/shared';
import { FsmService } from '../fsm/fsm.service';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private consumer: Consumer;
  private readonly logger = new Logger(KafkaConsumerService.name);

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => FsmService))
    private conversationFsm: FsmService,
  ) {
    const kafka = new Kafka({
      clientId: 'whatsapp-engine-consumer',
      brokers: this.configService.get<string[]>('kafka.brokers') || ['localhost:9092'],
    });
    this.consumer = kafka.consumer({ groupId: 'whatsapp-engine-group' });
  }

  async onModuleInit() {
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({
        topic: KAFKA_TOPICS.WHATSAPP_INBOUND_MESSAGE,
        fromBeginning: false,
      });
      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });
      this.logger.log('Kafka consumer connected and subscribed to whatsapp inbound messages');
    } catch (err) {
      this.logger.warn(`Kafka consumer not available: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.consumer.disconnect();
    } catch (err) {
      this.logger.warn(`Error disconnecting Kafka consumer: ${err.message}`);
    }
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { message } = payload;
    if (!message.value) return;

    try {
      const raw = message.value.toString();
      const event: WhatsAppInboundMessageEvent = JSON.parse(raw);
      await this.conversationFsm.processMessage(event);
    } catch (err) {
      this.logger.error(`Error processing inbound WhatsApp message: ${err.message}`);
    }
  }
}
