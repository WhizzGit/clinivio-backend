import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { WhatsAppSession } from '@mediflow/shared';

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private readonly logger = new Logger(SessionService.name);
  private readonly SESSION_PREFIX = 'session:';
  private readonly sessionTtl: number;

  constructor(private configService: ConfigService) {
    this.sessionTtl = this.configService.get<number>('sessionTtl') || 86400;
  }

  onModuleInit() {
    const host = this.configService.get<string>('redis.host') || 'localhost';
    const port = this.configService.get<number>('redis.port') || 6379;
    this.redis = new Redis({
      host,
      port,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Redis not available (WhatsApp sessions degraded): ${err.message}`);
    });
    this.redis.connect().catch(() => {
      this.logger.warn('Redis unavailable — WhatsApp sessions will not persist across restarts');
    });
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  private key(phone: string): string {
    return `${this.SESSION_PREFIX}${phone}`;
  }

  async getSession(phone: string): Promise<WhatsAppSession> {
    try {
      const raw = await this.redis.get(this.key(phone));
      if (raw) {
        return JSON.parse(raw) as WhatsAppSession;
      }
    } catch (err) {
      this.logger.warn(`Failed to get session for ${phone}: ${err.message}`);
    }

    const session: WhatsAppSession = {
      sessionId: uuidv4(),
      tenantId: '',
      phone,
      patientId: undefined,
      fsmState: 'IDLE',
      fsmContext: {},
      preferredLanguage: 'EN',
      conversationHistory: [],
      lastActivityAt: new Date().toISOString(),
    };

    await this.saveSession(phone, session);
    return session;
  }

  async saveSession(phone: string, session: WhatsAppSession): Promise<void> {
    try {
      session.lastActivityAt = new Date().toISOString();
      await this.redis.setex(
        this.key(phone),
        this.sessionTtl,
        JSON.stringify(session),
      );
    } catch (err) {
      this.logger.warn(`Failed to save session for ${phone}: ${err.message}`);
    }
  }

  async updateFsmState(
    phone: string,
    state: string,
    contextUpdate: Record<string, any> = {},
  ): Promise<WhatsAppSession> {
    const session = await this.getSession(phone);
    session.fsmState = state;
    session.fsmContext = { ...session.fsmContext, ...contextUpdate };
    await this.saveSession(phone, session);
    return session;
  }

  async addToHistory(
    phone: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    const session = await this.getSession(phone);
    session.conversationHistory.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    // Keep only the last 20 messages
    if (session.conversationHistory.length > 20) {
      session.conversationHistory = session.conversationHistory.slice(-20);
    }
    await this.saveSession(phone, session);
  }

  async clearSession(phone: string): Promise<void> {
    try {
      await this.redis.del(this.key(phone));
    } catch (err) {
      this.logger.warn(`Failed to clear session for ${phone}: ${err.message}`);
    }
  }
}
