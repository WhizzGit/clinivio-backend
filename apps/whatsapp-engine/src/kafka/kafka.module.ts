import { Module, forwardRef } from '@nestjs/common';
import { KafkaProducerService } from './kafka-producer.service';
import { KafkaConsumerService } from './kafka-consumer.service';
import { FsmModule } from '../fsm/fsm.module';

@Module({
  imports: [forwardRef(() => FsmModule)],
  providers: [KafkaProducerService, KafkaConsumerService],
  exports: [KafkaProducerService, KafkaConsumerService],
})
export class KafkaModule {}
