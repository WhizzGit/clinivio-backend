import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private producer: Producer;
  private readonly logger = new Logger(KafkaProducerService.name);

  constructor(private configService: ConfigService) {
    const kafka = new Kafka({
      clientId: 'billing-service',
      brokers: this.configService.get<string[]>('kafka.brokers') || ['localhost:9092'],
    });
    this.producer = kafka.producer();
  }

  async onModuleInit() {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected');
    } catch (err) {
      this.logger.warn('Kafka not available, events will be dropped');
    }
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  async emit(topic: string, event: any): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ key: event.data?.invoiceId || 'unknown', value: JSON.stringify(event) }],
      });
    } catch (err) {
      this.logger.error(`Failed to emit event to ${topic}: ${err.message}`);
    }
  }
}
