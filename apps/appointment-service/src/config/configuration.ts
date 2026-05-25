export default () => ({
  port: parseInt(process.env.PORT ?? '3003', 10),
  env: process.env.NODE_ENV ?? 'development',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(s => s.trim()),
  jwt: { secret: process.env.JWT_SECRET ?? '' },
  kafka: { brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',') },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
});
