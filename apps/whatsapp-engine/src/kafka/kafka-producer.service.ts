import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private producer: Producer;
  private readonly logger = new Logger(KafkaProducerService.name);

  constructor(private configService: ConfigService) {
    const kafka = new Kafka({
      clientId: 'whatsapp-engine',
      brokers: this.configService.get<string[]>('kafka.brokers') || ['localhost:9092'],
    });
    this.producer = kafka.producer();
  }

  async onModuleInit() {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected');
    } catch (err) {
      this.logger.warn(`Kafka producer not available, events will be dropped: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.producer.disconnect();
    } catch (err) {
      this.logger.warn(`Error disconnecting Kafka producer: ${err.message}`);
    }
  }

  async emit(topic: string, event: any): Promise<void> {
    try {
      const key =
        event.data?.phone ||
        event.data?.patientId ||
        event.data?.messageId ||
        'unknown';
      await this.producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(event) }],
      });
    } catch (err) {
      this.logger.error(`Failed to emit event to ${topic}: ${err.message}`);
    }
  }
}
