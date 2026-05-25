import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles, TenantId } from '@mediflow/shared';
import { RoomsService } from './rooms.service';
import { CreateRoomDto, UpdateRoomDto, UpdateBedStatusDto } from './dto/room.dto';

@ApiTags('Rooms')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly svc: RoomsService) {}

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  findAll(@TenantId() tenantId: string) {
    return this.svc.findAll(tenantId);
  }

  @Get('available-beds')
  @Roles('ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  getAvailableBeds(@TenantId() tenantId: string, @Query('roomId') roomId?: string) {
    return this.svc.getAvailableBeds(tenantId, roomId);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.svc.findOne(id, tenantId);
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@TenantId() tenantId: string, @Body() dto: CreateRoomDto) {
    return this.svc.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: UpdateRoomDto) {
    return this.svc.update(id, tenantId, dto);
  }

  @Patch('beds/:bedId/maintenance')
  @Roles('ADMIN', 'SUPER_ADMIN', 'NURSE')
  setBedMaintenance(@Param('bedId') bedId: string, @TenantId() tenantId: string, @Body() dto: UpdateBedStatusDto) {
    return this.svc.setBedMaintenance(bedId, tenantId, dto.notes);
  }

  @Patch('beds/:bedId/available')
  @Roles('ADMIN', 'SUPER_ADMIN', 'NURSE')
  setBedAvailable(@Param('bedId') bedId: string, @TenantId() tenantId: string) {
    return this.svc.setBedAvailable(bedId, tenantId);
  }
}
