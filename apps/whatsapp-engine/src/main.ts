import { NestFactory } from '@nestjs/core';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { bootstrapApp } from '@mediflow/shared';

async function bootstrap() {
  // rawBody: true required for WhatsApp HMAC signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Must be registered BEFORE bootstrapApp
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => { req.rawBody = buf; },
    }),
  );

  await bootstrapApp(app, {
    serviceName: 'WhatsAppEngine',
    swaggerTitle: 'MediFlow WhatsApp Engine',
    swaggerDescription: 'WhatsApp Business API Webhooks & Messaging',
    port: process.env.PORT ?? '3004',
    rawBodyEnabled: true,
  });
}
bootstrap();
