import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PharmacyService } from './pharmacy.service';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';

@ApiTags('Pharmacy')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('pharmacy')
export class PharmacyController {
  constructor(private pharmacyService: PharmacyService) {}

  // ── Orders ────────────────────────────────────────────────────────────────
  @Get('orders')
  @Roles('ADMIN', 'PHARMACIST', 'NURSE')
  @ApiOperation({ summary: 'List pharmacy orders' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'DISPENSING', 'DISPENSED', 'RETURNED'] })
  findAll(@TenantId() tenantId: string, @Query('status') status?: string) {
    return this.pharmacyService.findAll(tenantId, status);
  }

  @Get('orders/:id')
  @Roles('ADMIN', 'PHARMACIST', 'NURSE')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.pharmacyService.findOne(id, tenantId);
  }

  @Patch('orders/:id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update pharmacy order status' })
  updateStatus(@Param('id') id: string, @TenantId() tenantId: string, @Body('status') status: string) {
    return this.pharmacyService.updateStatus(id, tenantId, status);
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  @Get('settings')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Get pharmacy profile settings for billing/receipts' })
  getSettings(@TenantId() tenantId: string) {
    return this.pharmacyService.getSettings(tenantId);
  }

  @Patch('settings')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update pharmacy profile settings for billing/receipts' })
  updateSettings(@TenantId() tenantId: string, @Body() dto: any) {
    return this.pharmacyService.updateSettings(tenantId, dto);
  }

  // ── Inventory ─────────────────────────────────────────────────────────────
  @Get('inventory')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'List pharmacy inventory' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'lowStock', required: false, type: Boolean })
  listInventory(
    @TenantId() tenantId: string,
    @Query('q') q?: string,
    @Query('lowStock') lowStock?: string,
  ) {
    return this.pharmacyService.listInventory(tenantId, q, lowStock === 'true');
  }

  @Post('inventory')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Add medicine to inventory' })
  addInventory(@TenantId() tenantId: string, @Body() dto: any) {
    return this.pharmacyService.addInventory(tenantId, dto);
  }

  @Patch('inventory/:id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update inventory item' })
  updateInventory(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: any) {
    return this.pharmacyService.updateInventory(id, tenantId, dto);
  }

  @Patch('inventory/:id/stock')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Adjust stock quantity (+/-)' })
  adjustStock(@Param('id') id: string, @TenantId() tenantId: string, @Body('qty') qty: number) {
    return this.pharmacyService.adjustStock(id, tenantId, qty);
  }

  @Delete('inventory/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Deactivate inventory item' })
  removeInventory(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.pharmacyService.removeInventory(id, tenantId);
  }
}
