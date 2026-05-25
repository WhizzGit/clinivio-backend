import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/create-department.dto';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';

@ApiTags('Departments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private departmentsService: DepartmentsService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Create a new department/specialty' })
  create(@TenantId() tenantId: string, @Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(tenantId, dto);
  }

  @Post('seed-defaults')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Seed default departments (General, Emergency, Cardiology, etc.)' })
  seedDefaults(@TenantId() tenantId: string) {
    return this.departmentsService.seedDefaults(tenantId);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'PHARMACIST')
  @ApiOperation({ summary: 'List all departments' })
  findAll(@TenantId() tenantId: string, @Query('activeOnly') activeOnly?: string) {
    return this.departmentsService.findAll(tenantId, activeOnly !== 'false');
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST', 'DOCTOR')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.departmentsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentsService.update(id, tenantId, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Deactivate a department' })
  remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.departmentsService.remove(id, tenantId);
  }
}
