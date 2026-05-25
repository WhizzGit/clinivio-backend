import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { bootstrapApp } from '@mediflow/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await bootstrapApp(app, {
    serviceName: 'IAMService',
    swaggerTitle: 'MediFlow IAM Service',
    swaggerDescription: 'Authentication, Identity Management & Tenant Onboarding API',
    port: process.env.PORT ?? '3001',
  });
}
bootstrap();
