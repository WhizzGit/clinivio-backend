import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { SlotsModule } from './slots/slots.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { DepartmentsModule } from './departments/departments.module';
import { ConsultationModule } from './consultation/consultation.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { RoomsModule } from './rooms/rooms.module';
import { IpdModule } from './ipd/ipd.module';
import { LabModule } from './lab/lab.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        throttlers: [{ ttl: cfg.get('throttle.ttl', 60000), limit: cfg.get('throttle.limit', 120) }],
      }),
    }),
    ScheduleModule.forRoot(),
    SlotsModule,
    AppointmentsModule,
    DepartmentsModule,
    ConsultationModule,
    PharmacyModule,
    QueueModule,
    HealthModule,
    RoomsModule,
    IpdModule,
    LabModule,
    StatsModule,
  ],
})
export class AppModule {}
