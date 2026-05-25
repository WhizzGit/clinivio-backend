import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { bootstrapApp } from '@mediflow/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await bootstrapApp(app, {
    serviceName: 'PatientService',
    swaggerTitle: 'MediFlow Patient Service',
    swaggerDescription: 'Patient Registration, Records & Search API',
    port: process.env.PORT ?? '3002',
  });
}
bootstrap();
