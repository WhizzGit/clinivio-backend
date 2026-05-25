import { NestFactory } from '@nestjs/core';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { bootstrapApp } from '@mediflow/shared';

async function bootstrap() {
  // rawBody: true required for Razorpay HMAC webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Must be registered BEFORE bootstrapApp so the raw buffer is available in webhook handlers
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => { req.rawBody = buf; },
    }),
  );

  await bootstrapApp(app, {
    serviceName: 'BillingService',
    swaggerTitle: 'MediFlow Billing Service',
    swaggerDescription: 'Billing, Invoicing & Razorpay Payments API',
    port: process.env.PORT ?? '3006',
    rawBodyEnabled: true,
  });
}
bootstrap();
