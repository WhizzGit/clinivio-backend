import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SlotsService } from './slots.service';
import { CreateSlotDto, CreateSlotsBulkDto, BlockSlotDto } from './dto/create-slot.dto';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';
import { ROLES } from '@mediflow/shared';

@ApiTags('Slots')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('slots')
export class SlotsController {
  constructor(private slotsService: SlotsService) {}

  @Post()
  @Roles(ROLES.ADMIN, ROLES.DOCTOR)
  @ApiOperation({ summary: 'Create a single doctor slot' })
  createSlot(@TenantId() tenantId: string, @Body() dto: CreateSlotDto) {
    return this.slotsService.createSlot(tenantId, dto);
  }

  @Post('bulk')
  @Roles(ROLES.ADMIN, ROLES.DOCTOR)
  @ApiOperation({ summary: 'Bulk-create doctor slots over a date range' })
  createSlotsBulk(@TenantId() tenantId: string, @Body() dto: CreateSlotsBulkDto) {
    return this.slotsService.createSlotsBulk(tenantId, dto);
  }

  @Get('available')
  @Roles(ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE, ROLES.RECEPTIONIST, ROLES.PHARMACIST, ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get available slots for a doctor on a given date' })
  @ApiQuery({ name: 'doctorId', required: true, type: String })
  @ApiQuery({ name: 'date', required: true, type: String, description: 'YYYY-MM-DD' })
  findAvailableSlots(
    @TenantId() tenantId: string,
    @Query('doctorId') doctorId: string,
    @Query('date') date: string,
  ) {
    return this.slotsService.findAvailableSlots(tenantId, doctorId, date);
  }

  @Get('doctors')
  @Roles(ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE, ROLES.RECEPTIONIST, ROLES.PHARMACIST, ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get doctors availability (optionally filtered by specialty / date range)' })
  @ApiQuery({ name: 'specialty', required: false, type: String })
  @ApiQuery({ name: 'fromDate', required: false, type: String, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'toDate', required: false, type: String, description: 'YYYY-MM-DD' })
  findDoctorsAvailability(
    @TenantId() tenantId: string,
    @Query('specialty') specialty?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.slotsService.findDoctorsAvailability(tenantId, specialty, fromDate, toDate);
  }

  @Patch(':id/block')
  @Roles(ROLES.ADMIN, ROLES.DOCTOR)
  @ApiOperation({ summary: 'Block a slot' })
  blockSlot(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @Body() dto: BlockSlotDto,
  ) {
    return this.slotsService.blockSlot(id, tenantId, dto.reason);
  }

  @Patch(':id/unblock')
  @Roles(ROLES.ADMIN, ROLES.DOCTOR)
  @ApiOperation({ summary: 'Unblock a slot' })
  unblockSlot(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.slotsService.unblockSlot(id, tenantId);
  }

  @Delete(':id')
  @Roles(ROLES.ADMIN)
  @ApiOperation({ summary: 'Delete a slot (only if no bookings)' })
  deleteSlot(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.slotsService.deleteSlot(id, tenantId);
  }
}
