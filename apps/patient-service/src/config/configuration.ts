export default () => ({
  port: parseInt(process.env.PORT ?? '3002', 10),
  env: process.env.NODE_ENV ?? 'development',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(s => s.trim()),
  database: { url: process.env.DATABASE_URL },
  jwt: { secret: process.env.JWT_SECRET ?? '' },
  kafka: { brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',') },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
});
