import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from './auth.service';

/**
 * Passport local strategy — validates email + password.
 *
 * Tenant context is already established by TenantContextMiddleware before
 * this strategy runs (subdomain or X-Tenant-Slug header). AuthService reads
 * the ALS store to decide whether to query the tenant schema or the platform schema.
 *
 * No tenantId body parameter is needed; the subdomain carries the tenant identity.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<any> {
    const user = await this.authService.validateUser(email, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return user;
  }
}
