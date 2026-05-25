import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { SearchPatientDto } from './dto/search-patient.dto';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';

@ApiTags('Patients')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('patients')
export class PatientsController {
  constructor(private patientsService: PatientsService) {}

  @Post()
  @Roles('ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Register a new patient' })
  create(@TenantId() tenantId: string, @Body() dto: CreatePatientDto) {
    return this.patientsService.create(tenantId, dto);
  }

  @Get()
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'List all patients' })
  findAll(
    @TenantId() tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.patientsService.findAll(tenantId, page, limit);
  }

  @Get('search')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'Search patients by name, phone, WhatsApp number or UHID' })
  search(@TenantId() tenantId: string, @Query() dto: SearchPatientDto) {
    return this.patientsService.search(
      tenantId,
      dto.q || '',
      parseInt(dto.page || '1'),
      parseInt(dto.limit || '20'),
    );
  }

  @Get('by-phone/:phone')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR')
  @ApiOperation({ summary: 'Find patient by phone or WhatsApp number' })
  findByPhone(@Param('phone') phone: string, @TenantId() tenantId: string) {
    return this.patientsService.findByPhone(phone, tenantId);
  }

  @Get('family/by-whatsapp/:phone')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'Get all family members under a WhatsApp number' })
  findFamilyByWhatsapp(@Param('phone') phone: string, @TenantId() tenantId: string) {
    return this.patientsService.findFamilyByWhatsapp(phone, tenantId);
  }

  @Get('family/:familyId/members')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'Get all members of a family group' })
  findByFamily(@Param('familyId') familyId: string, @TenantId() tenantId: string) {
    return this.patientsService.findByFamily(familyId, tenantId);
  }

  @Get(':id')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.patientsService.findById(id, tenantId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'RECEPTIONIST')
  update(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: UpdatePatientDto) {
    return this.patientsService.update(id, tenantId, dto);
  }

  @Post(':id/consent')
  @Roles('ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Record patient consent' })
  updateConsent(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.patientsService.updateConsent(id, tenantId);
  }
}
