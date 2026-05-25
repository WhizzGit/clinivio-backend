import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RolesGuard, Roles, TenantId, CurrentUser, JwtPayload } from '@mediflow/shared';
import { AppointmentStatus, VisitType } from '@mediflow/database';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private appointmentsService: AppointmentsService) {}

  @Post()
  @Roles('ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Register a patient visit (REGISTERED status)' })
  create(@TenantId() tenantId: string, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.create(tenantId, dto);
  }

  @Get('active')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'PHARMACIST')
  @ApiOperation({ summary: "Today's active patient list — dashboard feed" })
  @ApiQuery({ name: 'doctorId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'visitType', required: false, enum: VisitType })
  @ApiQuery({ name: 'status', required: false, isArray: true })
  @ApiQuery({ name: 'date', required: false })
  getActive(
    @TenantId() tenantId: string,
    @Query('doctorId') doctorId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('visitType') visitType?: VisitType,
    @Query('status') status?: string | string[],
    @Query('date') date?: string,
  ) {
    const statuses = status
      ? (Array.isArray(status) ? status : [status]) as AppointmentStatus[]
      : undefined;
    return this.appointmentsService.getActivePatients(tenantId, { doctorId, departmentId, visitType, status: statuses, date });
  }

  @Get('queue/status')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: "Doctor queue summary (current + waiting + completed counts)" })
  getQueueStatus(
    @TenantId() tenantId: string,
    @Query('doctorId') doctorId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const id = user.role === 'DOCTOR' ? user.sub : doctorId;
    return this.appointmentsService.getQueueStatus(id, tenantId);
  }

  @Get('doctor-queue')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: "Full ordered queue for a doctor" })
  getDoctorQueue(
    @TenantId() tenantId: string,
    @Query('doctorId') doctorId: string,
    @Query('date') date: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const id = user.role === 'DOCTOR' ? user.sub : doctorId;
    return this.appointmentsService.findDoctorQueue(id, tenantId, date);
  }

  @Get()
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query('doctorId') doctorId?: string,
    @Query('patientId') patientId?: string,
    @Query('date') date?: string,
    @Query('status') status?: AppointmentStatus,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const effectiveDoctorId = user.role === 'DOCTOR' ? user.sub : doctorId;
    return this.appointmentsService.findAll(tenantId, { doctorId: effectiveDoctorId, patientId, date, status }, page, limit);
  }

  @Get(':id')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.appointmentsService.findById(id, tenantId);
  }

  @Post(':id/confirm-payment')
  @Roles('ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Billing counter: collect consultation fee → CONFIRMED' })
  confirmPayment(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @Body() body: { paymentMethod: string; amount: number },
  ) {
    return this.appointmentsService.confirmPayment(id, tenantId, body.paymentMethod, body.amount);
  }

  @Post(':id/check-in')
  @Roles('ADMIN', 'RECEPTIONIST', 'NURSE', 'DOCTOR')
  @ApiOperation({ summary: 'Nurse marks patient as arrived at doctor room → CHECKED_IN' })
  checkIn(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.appointmentsService.checkIn(id, tenantId);
  }

  @Post(':id/start')
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  @ApiOperation({ summary: 'Doctor starts consultation → IN_PROGRESS' })
  startConsultation(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.appointmentsService.startConsultation(id, tenantId);
  }

  @Post(':id/complete')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({ summary: 'Mark consultation COMPLETED' })
  complete(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.appointmentsService.complete(id, tenantId);
  }

  @Post(':id/send-to-pharmacy')
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  @ApiOperation({ summary: 'Send to pharmacy → SENT_TO_PHARMACY + creates PharmacyOrder' })
  sendToPharmacy(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.appointmentsService.sendToPharmacy(id, tenantId);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR')
  cancel(@Param('id') id: string, @TenantId() tenantId: string, @Body() body: { reason: string }) {
    return this.appointmentsService.cancel(id, tenantId, body.reason);
  }
}
