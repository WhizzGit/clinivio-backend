import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '@mediflow/shared';

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  findAll() { return this.tenantsService.findAllWithStats(); }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  findOne(@Param('id') id: string) { return this.tenantsService.findById(id); }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Onboard a new hospital tenant' })
  create(@Body() dto: CreateTenantDto) { return this.tenantsService.create(dto); }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: Partial<CreateTenantDto>) {
    return this.tenantsService.update(id, dto);
  }

  @Post(':id/reset-admin-password')
  @Roles('SUPER_ADMIN')
  resetAdminPassword(@Param('id') id: string) {
    return this.tenantsService.resetAdminPassword(id);
  }

  @Patch(':id/profile')
  @Roles('SUPER_ADMIN', 'ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update hospital/pharmacy profile for printing' })
  updateProfile(@Param('id') id: string, @Body() dto: Partial<CreateTenantDto>) {
    return this.tenantsService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles('SUPER_ADMIN')
  deactivate(@Param('id') id: string) { return this.tenantsService.deactivate(id); }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Permanently delete a tenant and drop its schema' })
  delete(@Param('id') id: string) { return this.tenantsService.delete(id); }
}
