import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { RolesGuard } from '@mediflow/shared';
import { Roles } from '@mediflow/shared';
import { ROLES } from '@mediflow/shared';

@Controller('notifications')
@UseGuards(RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @Roles(ROLES.ADMIN, ROLES.RECEPTIONIST)
  create(@Request() req: any, @Body() dto: CreateNotificationDto) {
    const tenantId: string = req.user?.tenantId;
    return this.notificationsService.create(tenantId, dto);
  }

  @Get('patient/:patientId')
  @Roles(ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DOCTOR)
  findByPatient(@Request() req: any, @Param('patientId') patientId: string) {
    const tenantId: string = req.user?.tenantId;
    return this.notificationsService.findByPatient(patientId, tenantId);
  }

  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.RECEPTIONIST)
  findOne(@Request() req: any, @Param('id') id: string) {
    const tenantId: string = req.user?.tenantId;
    return this.notificationsService.findById(id, tenantId);
  }
}
