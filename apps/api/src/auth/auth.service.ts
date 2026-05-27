import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, Role, TenantDataSourceRegistry } from '@mediflow/database';
import { JwtPayload } from '@mediflow/shared';

@Injectable()
export class AuthService {
  constructor(
    /** Platform (public schema) DataSource — used only for SUPER_ADMIN login */
    @InjectDataSource() private readonly platformDs: DataSource,
    /** Per-tenant ALS context — set by TenantContextMiddleware for subdomain requests */
    private readonly registry: TenantDataSourceRegistry,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Validates credentials for both tenant users and super admins.
   *
   * Tenant users:  ALS context is set by TenantContextMiddleware (subdomain routing).
   *                We query the tenant schema DataSource directly.
   *
   * Super admins:  No ALS context (no subdomain / platform subdomain).
   *                We query the platform (public) schema for role = SUPER_ADMIN.
   */
  async validateUser(email: string, password: string): Promise<any> {
    const tenantDs = this.registry.currentOrNull;

    let user: User | null = null;

    if (tenantDs) {
      // ── Tenant user path ─────────────────────────────────────────────────
      user = await tenantDs.getRepository(User).findOne({
        where: { email, isActive: true },
        relations: ['doctorProfile'],
      });
      if (user) {
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return null;
        await tenantDs.getRepository(User).update(user.id, { lastLoginAt: new Date() });
      }
    } else {
      // ── SUPER_ADMIN path (no tenant context) ─────────────────────────────
      user = await this.platformDs.getRepository(User).findOne({
        where: { email, role: Role.SUPER_ADMIN, isActive: true },
        relations: ['doctorProfile'],
      });
      if (user) {
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return null;
        await this.platformDs.getRepository(User).update(user.id, { lastLoginAt: new Date() });
      }
    }

    if (!user) return null;

    const { passwordHash, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn'),
    });
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        doctorProfile: user.doctorProfile || null,
      },
    };
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
      const newPayload: JwtPayload = {
        sub: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role,
        email: payload.email,
      };
      return { accessToken: this.jwtService.sign(newPayload) };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(_userId: string) {
    return { message: 'Logged out successfully' };
  }
}
