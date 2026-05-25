import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { SessionModule } from './session/session.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { KafkaModule } from './kafka/kafka.module';
import { FsmModule } from './fsm/fsm.module';
import { WebhookModule } from './webhook/webhook.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    SessionModule,
    WhatsappModule,
    KafkaModule,
    FsmModule,
    WebhookModule,
    HealthModule,
  ],
})
export class AppModule {}
