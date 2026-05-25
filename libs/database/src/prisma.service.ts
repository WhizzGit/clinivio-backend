import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000; // 4 min — Neon suspends after 5 min idle

function buildPrismaLogLevels(nodeEnv: string): Prisma.LogDefinition[] {
  if (nodeEnv === 'production') {
    return [
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
    ];
  }
  return [
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
    // Query logging disabled by default — enable with LOG_PRISMA_QUERIES=true
    ...(process.env.LOG_PRISMA_QUERIES === 'true' ? [{ emit: 'stdout' as const, level: 'query' as const }] : []),
  ];
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private keepAliveTimer?: NodeJS.Timeout;

  constructor() {
    // Neon serverless computes auto-suspend — keep pool small so idle connections
    // don't prevent sleep, and set keepAlive so the OS doesn't drop them silently.
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.searchParams.set('connect_timeout', url.searchParams.get('connect_timeout') ?? '30');
    url.searchParams.set('pool_timeout', url.searchParams.get('pool_timeout') ?? '30');

    super({
      log: buildPrismaLogLevels(process.env['NODE_ENV'] ?? 'development'),
      datasources: { db: { url: url.toString() } },
    });
  }

  async onModuleInit(): Promise<void> {
    const maxRetries = 10;
    const retryDelayMs = 10000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(`Connecting to database (attempt ${attempt}/${maxRetries})…`);
        await this.$connect();
        this.logger.log('Database connection established.');
        this.startKeepAlive();
        return;
      } catch (err) {
        if (attempt < maxRetries) {
          this.logger.warn(`DB connect attempt ${attempt} failed — retrying in ${retryDelayMs / 1000}s (Neon waking up)…`);
          await new Promise((r) => setTimeout(r, retryDelayMs));
        } else {
          this.logger.error('Failed to connect to database after all retries', err);
          // Fail fast in production — let orchestrator restart the container
          if (process.env.NODE_ENV === 'production') process.exit(1);
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopKeepAlive();
    await this.$disconnect();
    this.logger.log('Database connection closed.');
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  private startKeepAlive(): void {
    if (process.env.NODE_ENV === 'production') return;
    this.keepAliveTimer = setInterval(async () => {
      try {
        await this.$queryRaw`SELECT 1`;
      } catch {
        this.logger.warn('Keep-alive ping failed — Neon may have suspended');
      }
    }, KEEPALIVE_INTERVAL_MS);
    this.keepAliveTimer.unref?.();
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }
}
