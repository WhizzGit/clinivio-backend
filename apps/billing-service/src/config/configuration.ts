function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`[Billing] Required environment variable "${key}" is not set`);
  }
  return value ?? '';
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3006', 10),
  env: process.env.NODE_ENV ?? 'development',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(s => s.trim()),
  jwt: {
    secret: requireEnv('JWT_SECRET') || 'dev-secret-change-me',
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: requireEnv('RAZORPAY_WEBHOOK_SECRET') || '',
  },
  gst: {
    cgstRate: 0.09,
    sgstRate: 0.09,
    igstRate: 0.18,
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
});
