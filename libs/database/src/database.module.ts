import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ALL_ENTITIES } from './entities';

/**
 * Global DatabaseModule — import once in AppModule.
 * Provides a TypeORM DataSource connected to Neon PostgreSQL.
 * Use TypeOrmModule.forFeature([...]) in feature modules to inject repositories.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbUrl = config.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
        if (!dbUrl) throw new Error('DATABASE_URL is not set');
        return {
          type: 'postgres',
          url: dbUrl,
          entities: ALL_ENTITIES,
          // Auto-sync in dev (creates/alters tables). NEVER in production.
          synchronize: process.env.NODE_ENV !== 'production',
          // Set DB_RESET=true for a one-time drop & recreate (dev only)
          dropSchema: process.env.NODE_ENV !== 'production' && process.env.DB_RESET === 'true',
          ssl: process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }
            : false,
          logging: process.env.LOG_QUERIES === 'true' ? ['query', 'error'] : ['error'],
          // Retry on transient Neon wakeup failures (ENOTFOUND / ECONNREFUSED / ETIMEDOUT)
          retryAttempts: 20,
          retryDelay: 3000,
          extra: {
            // Neon serverless — keep pool small to avoid idle-connection billing
            max: 5,
            min: 0,          // allow full idle so Neon compute can suspend
            idleTimeoutMillis: 5000,         // proactively drop idle before Neon closes them
            connectionTimeoutMillis: 60000, // 60s — Neon cold-start can take 30-40s
            keepAlive: true,                 // prevent NAT/firewall dropping idle TCP connections
            keepAliveInitialDelayMillis: 10000,
          },
        };
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
