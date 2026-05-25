import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConsultationService } from './consultation.service';
import { SaveConsultationDto, SavePrescriptionDto, CreateFollowUpDto } from './dto/consultation.dto';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';

@ApiTags('Consultation')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('appointments/:appointmentId/consultation')
export class ConsultationController {
  constructor(private consultationService: ConsultationService) {}

  @Get()
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Get consultation details (vitals + prescription + follow-ups)' })
  get(@Param('appointmentId') appointmentId: string, @TenantId() tenantId: string) {
    return this.consultationService.getConsultation(appointmentId, tenantId);
  }

  @Post()
  @Roles('DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'Save/update vitals and clinical notes' })
  save(
    @Param('appointmentId') appointmentId: string,
    @TenantId() tenantId: string,
    @Body() dto: SaveConsultationDto,
  ) {
    return this.consultationService.saveConsultation(appointmentId, tenantId, dto);
  }

  @Post('prescription')
  @Roles('DOCTOR')
  @ApiOperation({ summary: 'Save/replace prescription (medicines + dosage)' })
  savePrescription(
    @Param('appointmentId') appointmentId: string,
    @TenantId() tenantId: string,
    @Body() dto: SavePrescriptionDto,
  ) {
    return this.consultationService.savePrescription(appointmentId, tenantId, dto);
  }

  @Post('follow-up')
  @Roles('DOCTOR')
  @ApiOperation({ summary: 'Add a follow-up date with optional notes' })
  createFollowUp(
    @Param('appointmentId') appointmentId: string,
    @TenantId() tenantId: string,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.consultationService.createFollowUp(appointmentId, tenantId, dto);
  }
}

@ApiTags('Consultation')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('patients/:patientId/history')
export class PatientHistoryController {
  constructor(private consultationService: ConsultationService) {}

  @Get()
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: "Full consultation history for a patient" })
  getHistory(@Param('patientId') patientId: string, @TenantId() tenantId: string) {
    return this.consultationService.getPatientHistory(patientId, tenantId);
  }
}
