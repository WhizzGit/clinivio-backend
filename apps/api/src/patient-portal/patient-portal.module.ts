import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PatientPortalService } from './patient-portal.service';
import { PatientPortalController } from './patient-portal.controller';
import { PatientJwtStrategy } from './patient-jwt.strategy';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PassportModule,
    // Re-use the same JwtModule (secret, signOptions) registered in AuthModule
    AuthModule,
  ],
  providers: [PatientPortalService, PatientJwtStrategy],
  controllers: [PatientPortalController],
})
export class PatientPortalModule {}
