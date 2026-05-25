import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles, TenantId, CurrentUser } from '@mediflow/shared';
import { IpdService } from './ipd.service';
import {
  AdmitPatientDto, IPDVitalsDto, AddTreatmentDto, UpdateTreatmentDto,
  AddProcedureDto, SaveDischargeAdviceDto, SaveDischargeSummaryDto, DischargePatientDto,
} from './dto/ipd.dto';
import { IPDAdmissionStatus } from '@prisma/client';

@ApiTags('IPD')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('ipd')
export class IpdController {
  constructor(private readonly svc: IpdService) {}

  @Post('admissions')
  @Roles('ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'RECEPTIONIST')
  admit(@TenantId() tenantId: string, @Body() dto: AdmitPatientDto, @CurrentUser() user: any) {
    return this.svc.admitPatient(tenantId, dto, user.sub);
  }

  @Get('admissions')
  @ApiQuery({ name: 'status', enum: IPDAdmissionStatus, required: false })
  @Roles('ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  findAll(@TenantId() tenantId: string, @Query('status') status?: IPDAdmissionStatus) {
    return this.svc.findAll(tenantId, status);
  }

  @Get('admissions/:id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.svc.findOne(id, tenantId);
  }

  // ── Vitals ────────────────────────────────────────────────────────────────

  @Post('admissions/:id/vitals')
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  addVitals(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: IPDVitalsDto, @CurrentUser() user: any) {
    return this.svc.addVitals(id, tenantId, dto, user.sub);
  }

  // ── Treatments ────────────────────────────────────────────────────────────

  @Post('admissions/:id/treatments')
  @Roles('DOCTOR', 'ADMIN')
  addTreatment(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: AddTreatmentDto, @CurrentUser() user: any) {
    return this.svc.addTreatment(id, tenantId, dto, user.sub);
  }

  @Patch('treatments/:treatmentId')
  @Roles('DOCTOR', 'ADMIN', 'NURSE')
  updateTreatment(@Param('treatmentId') treatmentId: string, @TenantId() tenantId: string, @Body() dto: UpdateTreatmentDto) {
    return this.svc.updateTreatment(treatmentId, tenantId, dto);
  }

  // ── Procedures ────────────────────────────────────────────────────────────

  @Post('admissions/:id/procedures')
  @Roles('DOCTOR', 'ADMIN')
  addProcedure(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: AddProcedureDto, @CurrentUser() user: any) {
    // Photo upload is handled separately via /procedures/:id/photos
    return this.svc.addProcedure(id, tenantId, dto, user.sub);
  }

  @Patch('procedures/:procedureId/photos')
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  addPhotos(@Param('procedureId') procedureId: string, @TenantId() tenantId: string, @Body() body: { photoUrls: string[] }) {
    return this.svc.addProcedurePhotos(procedureId, tenantId, body.photoUrls);
  }

  // ── Discharge ─────────────────────────────────────────────────────────────

  @Post('admissions/:id/discharge-advice')
  @Roles('DOCTOR', 'ADMIN')
  saveDischargeAdvice(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: SaveDischargeAdviceDto, @CurrentUser() user: any) {
    return this.svc.saveDischargeAdvice(id, tenantId, dto, user.sub);
  }

  @Post('admissions/:id/discharge-summary')
  @Roles('DOCTOR', 'ADMIN')
  saveDischargeSummary(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: SaveDischargeSummaryDto, @CurrentUser() user: any) {
    return this.svc.saveDischargeSummary(id, tenantId, dto, user.sub);
  }

  @Patch('admissions/:id/ready-for-discharge')
  @Roles('DOCTOR', 'ADMIN')
  readyForDischarge(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.svc.markReadyForDischarge(id, tenantId);
  }

  @Patch('admissions/:id/discharge')
  @Roles('ADMIN', 'SUPER_ADMIN', 'DOCTOR')
  discharge(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: DischargePatientDto) {
    return this.svc.discharge(id, tenantId, dto);
  }
}
