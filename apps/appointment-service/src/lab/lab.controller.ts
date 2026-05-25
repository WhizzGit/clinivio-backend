import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards,
  ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LabService } from './lab.service';
import { RolesGuard, CurrentUser, Roles } from '@mediflow/shared';
import { CreateLabTestDto, UpdateLabTestDto, CreateLabOrderDto, CollectSampleDto, EnterResultsDto } from './dto/lab.dto';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('lab')
export class LabController {
  constructor(private readonly labService: LabService) {}

  // ── Stats & Analytics ─────────────────────────────────────────────────────────
  @Get('stats')
  @Roles('ADMIN', 'LAB_TECHNICIAN', 'DOCTOR', 'NURSE')
  stats(@CurrentUser() user: any) {
    return this.labService.getStats(user.tenantId);
  }

  @Get('analytics')
  @Roles('ADMIN', 'LAB_TECHNICIAN', 'DOCTOR')
  analytics(
    @CurrentUser() user: any,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.labService.getAnalytics(user.tenantId, days);
  }

  // ── Test Catalog ─────────────────────────────────────────────────────────────
  @Get('tests')
  @Roles('ADMIN', 'LAB_TECHNICIAN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  findTests(@CurrentUser() user: any, @Query('all') all?: string) {
    return this.labService.findAllTests(user.tenantId, all !== 'true');
  }

  @Post('tests')
  @Roles('ADMIN', 'LAB_TECHNICIAN')
  createTest(@CurrentUser() user: any, @Body() dto: CreateLabTestDto) {
    return this.labService.createTest(user.tenantId, dto);
  }

  @Patch('tests/:id')
  @Roles('ADMIN', 'LAB_TECHNICIAN')
  updateTest(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateLabTestDto) {
    return this.labService.updateTest(id, user.tenantId, dto);
  }

  // ── Lab Orders ───────────────────────────────────────────────────────────────
  @Get('orders')
  @Roles('ADMIN', 'LAB_TECHNICIAN', 'DOCTOR', 'NURSE')
  findOrders(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.labService.findAllOrders(user.tenantId, status, patientId, page, limit);
  }

  @Get('orders/:id')
  @Roles('ADMIN', 'LAB_TECHNICIAN', 'DOCTOR', 'NURSE')
  findOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.labService.findOrder(id, user.tenantId);
  }

  @Post('orders')
  @Roles('ADMIN', 'DOCTOR', 'NURSE')
  createOrder(@CurrentUser() user: any, @Body() dto: CreateLabOrderDto) {
    return this.labService.createOrder(user.tenantId, user.sub, dto);
  }

  @Patch('orders/:id/collect-sample')
  @Roles('ADMIN', 'LAB_TECHNICIAN')
  collectSample(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: CollectSampleDto) {
    return this.labService.collectSample(id, user.tenantId, user.sub, dto);
  }

  @Patch('orders/:id/start-processing')
  @Roles('ADMIN', 'LAB_TECHNICIAN')
  startProcessing(@Param('id') id: string, @CurrentUser() user: any) {
    return this.labService.startProcessing(id, user.tenantId, user.sub);
  }

  @Patch('orders/:id/results')
  @Roles('ADMIN', 'LAB_TECHNICIAN')
  enterResults(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: EnterResultsDto) {
    return this.labService.enterResults(id, user.tenantId, dto);
  }

  @Patch('orders/:id/cancel')
  @Roles('ADMIN', 'LAB_TECHNICIAN', 'DOCTOR')
  cancelOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.labService.cancelOrder(id, user.tenantId);
  }
}
