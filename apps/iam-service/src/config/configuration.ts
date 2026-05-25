function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`[IAM] Required environment variable "${key}" is not set`);
  }
  return value ?? '';
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  env: process.env.NODE_ENV ?? 'development',
  database: { url: requireEnv('DATABASE_URL') },
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(s => s.trim()),
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  jwt: {
    secret: requireEnv('JWT_SECRET') || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    refreshSecret: requireEnv('JWT_REFRESH_SECRET') || 'dev-refresh-change-me',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  kafka: { brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',') },
  msg91: { authKey: process.env.MSG91_AUTH_KEY ?? '', senderId: process.env.MSG91_SENDER_ID ?? 'MEDFLW' },
  throttle: {
    // defaults — override per environment
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),   // 1 minute window
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10), // 120 req/min globally
    authTtl: parseInt(process.env.AUTH_THROTTLE_TTL ?? '900000', 10),  // 15 min window for login
    authLimit: parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '10', 10),  // 10 login attempts per 15 min
  },
});
