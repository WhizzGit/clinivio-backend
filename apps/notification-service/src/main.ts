import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { bootstrapApp } from '@mediflow/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await bootstrapApp(app, {
    serviceName: 'NotificationService',
    swaggerTitle: 'MediFlow Notification Service',
    swaggerDescription: 'SMS, Email & Push Notification delivery API',
    port: process.env.PORT ?? '3005',
  });
}
bootstrap();
