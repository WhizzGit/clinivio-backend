import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const OTP_TTL = 300; // 5 minutes

@Injectable()
export class OtpService {
  private redis: Redis | null = null;
  private readonly memStore = new Map<string, { otp: string; expiresAt: number }>();
  private readonly logger = new Logger(OtpService.name);

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('redis.host');
    const port = this.configService.get<number>('redis.port');

    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      const client = new Redis({ host, port, lazyConnect: true });
      client.on('error', (err) => {
        this.logger.warn(`Redis error: ${err.message}`);
      });
      client.connect()
        .then(() => { this.redis = client; this.logger.log('Redis connected'); })
        .catch(() => this.logger.warn('Redis unavailable — OTPs stored in memory (dev only)'));
    } else {
      this.logger.warn('Redis not configured — OTPs stored in memory (dev only)');
    }
  }

  private generate(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async generateOtp(phone: string, type: 'REGISTRATION' | 'LOGIN'): Promise<{ otpId: string; otp: string }> {
    const otp = this.generate();
    const key = `otp:${type}:${phone}`;

    if (this.redis) {
      await this.redis.setex(key, OTP_TTL, otp);
    } else {
      this.memStore.set(key, { otp, expiresAt: Date.now() + OTP_TTL * 1000 });
    }

    // Always log OTP in non-production so dev can see it without SMS
    if (this.configService.get('NODE_ENV') !== 'production') {
      this.logger.log(`[DEV] OTP for ${phone} [${type}]: ${otp}`);
    }

    return { otpId: `${type}:${phone}`, otp };
  }

  async verifyOtp(phone: string, type: string, otp: string): Promise<boolean> {
    const key = `otp:${type}:${phone}`;

    if (this.redis) {
      const stored = await this.redis.get(key);
      if (!stored || stored !== otp) return false;
      await this.redis.del(key);
      return true;
    }

    const entry = this.memStore.get(key);
    if (!entry || entry.otp !== otp || Date.now() > entry.expiresAt) return false;
    this.memStore.delete(key);
    return true;
  }
}
