import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { FsmModule } from '../fsm/fsm.module';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [FsmModule, KafkaModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
