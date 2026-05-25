import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient, BedStatus } from '@prisma/client';
import { CreateRoomDto, UpdateRoomDto } from './dto/room.dto';

@Injectable()
export class RoomsService {
  private prisma = new PrismaClient();

  async findAll(tenantId: string) {
    const rooms = await this.prisma.room.findMany({
      where: { tenantId, isActive: true },
      include: {
        beds: { orderBy: { bedNumber: 'asc' } },
        _count: { select: { admissions: { where: { status: { in: ['ADMITTED', 'UNDER_TREATMENT', 'READY_FOR_DISCHARGE'] } } } } },
      },
      orderBy: [{ roomType: 'asc' }, { name: 'asc' }],
    });
    return rooms.map(r => ({
      ...r,
      availableBeds: r.beds.filter(b => b.status === BedStatus.AVAILABLE).length,
      occupiedBeds: r.beds.filter(b => b.status === BedStatus.OCCUPIED).length,
    }));
  }

  async findOne(id: string, tenantId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id, tenantId },
      include: {
        beds: {
          include: {
            admissions: {
              where: { status: { in: ['ADMITTED', 'UNDER_TREATMENT', 'READY_FOR_DISCHARGE'] } },
              include: { patient: { select: { firstName: true, lastName: true, uhid: true } } },
              take: 1,
            },
          },
          orderBy: { bedNumber: 'asc' },
        },
      },
    });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  async create(tenantId: string, dto: CreateRoomDto) {
    return this.prisma.$transaction(async tx => {
      const room = await tx.room.create({
        data: { tenantId, ...dto, pricePerDay: dto.pricePerDay },
      });
      // Auto-create beds based on totalBeds count
      const beds = Array.from({ length: dto.totalBeds }, (_, i) => ({
        tenantId,
        roomId: room.id,
        bedNumber: `B${String(i + 1).padStart(2, '0')}`,
      }));
      await tx.bed.createMany({ data: beds });
      return tx.room.findUnique({ where: { id: room.id }, include: { beds: true } });
    });
  }

  async update(id: string, tenantId: string, dto: UpdateRoomDto) {
    await this.findOne(id, tenantId);
    return this.prisma.room.update({ where: { id }, data: dto });
  }

  async setBedMaintenance(bedId: string, tenantId: string, notes?: string) {
    const bed = await this.prisma.bed.findFirst({ where: { id: bedId, tenantId } });
    if (!bed) throw new NotFoundException('Bed not found');
    if (bed.status === BedStatus.OCCUPIED)
      throw new BadRequestException('Cannot mark an occupied bed as under maintenance');
    return this.prisma.bed.update({ where: { id: bedId }, data: { status: BedStatus.UNDER_MAINTENANCE, notes } });
  }

  async setBedAvailable(bedId: string, tenantId: string) {
    const bed = await this.prisma.bed.findFirst({ where: { id: bedId, tenantId } });
    if (!bed) throw new NotFoundException('Bed not found');
    return this.prisma.bed.update({ where: { id: bedId }, data: { status: BedStatus.AVAILABLE } });
  }

  async getAvailableBeds(tenantId: string, roomId?: string) {
    return this.prisma.bed.findMany({
      where: { tenantId, status: BedStatus.AVAILABLE, ...(roomId ? { roomId } : {}) },
      include: { room: { select: { id: true, name: true, roomType: true, pricePerDay: true } } },
      orderBy: [{ room: { name: 'asc' } }, { bedNumber: 'asc' }],
    });
  }
}
