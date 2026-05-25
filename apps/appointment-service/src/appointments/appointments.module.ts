import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { PrismaService } from '@mediflow/database';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { RazorpayService } from '../payments/razorpay.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../auth/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    PrismaService,
    KafkaProducerService,
    RazorpayService,
    JwtStrategy,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
