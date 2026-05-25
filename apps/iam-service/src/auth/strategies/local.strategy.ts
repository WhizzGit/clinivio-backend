import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email', passReqToCallback: true });
  }

  async validate(req: any, email: string, password: string): Promise<any> {
    const { tenantId } = req.body;
    const user = await this.authService.validateUser(email, password, tenantId);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!tenantId && user.role !== 'SUPER_ADMIN') throw new UnauthorizedException('tenantId is required');
    return user;
  }
}
