import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';
import { StatsService } from './stats.service';

@ApiTags('Stats')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('stats')
export class StatsController {
  constructor(private svc: StatsService) {}

  @Get(['dashboard', 'admin/dashboard'])
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get dashboard overview stats' })
  dashboard(@TenantId() tenantId: string) {
    return this.svc.getDashboard(tenantId);
  }

  @Get('revenue')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get revenue statistics' })
  revenue(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getRevenueStats(tenantId, from, to);
  }

  @Get('appointments')
  @Roles('ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Get appointment statistics' })
  appointments(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getAppointmentStats(tenantId, from, to);
  }

  @Get('ipd')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get IPD / bed occupancy statistics' })
  ipd(@TenantId() tenantId: string) {
    return this.svc.getIPDStats(tenantId);
  }

  @Get('lab')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get laboratory statistics' })
  lab(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getLabStats(tenantId, from, to);
  }

  @Get('pharmacy')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get pharmacy statistics' })
  pharmacy(@TenantId() tenantId: string) {
    return this.svc.getPharmacyStats(tenantId);
  }
}
