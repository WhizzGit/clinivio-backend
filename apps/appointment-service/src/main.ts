import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { bootstrapApp } from '@mediflow/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await bootstrapApp(app, {
    serviceName: 'AppointmentService',
    swaggerTitle: 'MediFlow Appointment Service',
    swaggerDescription: 'Appointments, Slots, Consultations & Pharmacy API',
    port: process.env.PORT ?? '3003',
  });
}
bootstrap();
