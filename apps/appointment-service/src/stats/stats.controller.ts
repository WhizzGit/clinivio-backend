import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, CurrentUser, Roles } from '@mediflow/shared';
import { StatsService } from './stats.service';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('admin/dashboard')
  @Roles('ADMIN', 'SUPER_ADMIN')
  adminDashboard(@CurrentUser() user: any) {
    return this.statsService.getAdminDashboard(user.tenantId);
  }

  @Get('pharmacy/analytics')
  @Roles('ADMIN', 'PHARMACIST')
  pharmacyAnalytics(@CurrentUser() user: any) {
    return this.statsService.getPharmacyAnalytics(user.tenantId);
  }
}
