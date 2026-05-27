import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    // passReqToCallback: true → validate receives (req, email, password)
    // so we can read tenantId from the request body
    super({ usernameField: 'email', passReqToCallback: true });
  }

  async validate(req: Request, email: string, password: string): Promise<any> {
    const tenantId = (req.body as any)?.tenantId ?? undefined;
    const user = await this.authService.validateUser(email, password, tenantId);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return user;
  }
}
