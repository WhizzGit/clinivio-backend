import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, IsOptional, IsUUID } from 'class-validator';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  /** Tenant UUID — accepted for backwards compatibility */
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  /** Hospital slug (e.g. "citihospital") — preferred over tenantId for UI login */
  @IsOptional()
  @IsString()
  slug?: string;
}

class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { ttl: 900000, limit: 10 } })
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email, password, and optional tenantId' })
  async login(@Body() _dto: LoginDto, @Request() req: any) {
    return this.authService.login(req.user);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: any) {
    return this.authService.logout(req.user.id);
  }
}
