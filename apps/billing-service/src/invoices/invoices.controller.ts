import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Post()
  @Roles('ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Create invoice' })
  create(@TenantId() tenantId: string, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(tenantId, dto);
  }

  @Get()
  @Roles('ADMIN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'List all invoices' })
  findAll(
    @TenantId() tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.invoicesService.findAll(tenantId, page, limit);
  }

  @Get('revenue-summary')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Revenue summary for date range' })
  revenueSummary(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.invoicesService.getRevenueSummary(
      tenantId,
      from ? new Date(from) : new Date(new Date().setDate(1)),
      to ? new Date(to) : new Date(),
    );
  }

  @Get('patient/:patientId')
  @Roles('ADMIN', 'RECEPTIONIST', 'DOCTOR')
  @ApiOperation({ summary: 'Get all invoices for a patient' })
  findByPatient(@Param('patientId') patientId: string, @TenantId() tenantId: string) {
    return this.invoicesService.findByPatient(patientId, tenantId);
  }

  @Get(':id')
  @Roles('ADMIN', 'RECEPTIONIST')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.invoicesService.findOne(id, tenantId);
  }
}
