import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { CreateSlotDto, CreateSlotsBulkDto } from './dto/create-slot.dto';

// Day of week mapping: JS getDay() returns 0=Sunday ... 6=Saturday
const DAY_NAME_MAP: Record<number, string> = {
  0: 'SUN',
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
};

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

@Injectable()
export class SlotsService {
  constructor(private prisma: PrismaService) {}

  async createSlot(tenantId: string, dto: CreateSlotDto) {
    const slotDate = new Date(dto.slotDate);

    // Check for overlap: any existing slot for same doctor/date that has overlapping time
    const existing = await this.prisma.doctorSlot.findFirst({
      where: {
        tenantId,
        doctorId: dto.doctorId,
        slotDate,
        // Overlap: existing.startTime < dto.endTime AND existing.endTime > dto.startTime
        AND: [
          { startTime: { lt: dto.endTime } },
          { endTime: { gt: dto.startTime } },
        ],
      },
    });

    if (existing) {
      throw new ConflictException(
        `Slot overlaps with existing slot (${existing.startTime} - ${existing.endTime})`,
      );
    }

    return this.prisma.doctorSlot.create({
      data: {
        tenantId,
        doctorId: dto.doctorId,
        slotDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        durationMinutes: dto.durationMinutes,
        maxPatients: dto.maxPatients,
      },
    });
  }

  async createSlotsBulk(tenantId: string, dto: CreateSlotsBulkDto): Promise<{ count: number }> {
    const from = new Date(dto.fromDate);
    const to = new Date(dto.toDate);
    const daysSet = new Set(dto.daysOfWeek.map((d) => d.toUpperCase()));

    const startMinutes = timeToMinutes(dto.startTime);
    const endMinutes = timeToMinutes(dto.endTime);

    const slotsToCreate: Array<{
      tenantId: string;
      doctorId: string;
      slotDate: Date;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      maxPatients: number;
    }> = [];

    const current = new Date(from);
    while (current <= to) {
      const dayName = DAY_NAME_MAP[current.getDay()];
      if (daysSet.has(dayName)) {
        // Generate slots from startTime to endTime with durationMinutes interval
        let slotStart = startMinutes;
        while (slotStart + dto.durationMinutes <= endMinutes) {
          const slotEnd = slotStart + dto.durationMinutes;
          slotsToCreate.push({
            tenantId,
            doctorId: dto.doctorId,
            slotDate: new Date(current),
            startTime: minutesToTime(slotStart),
            endTime: minutesToTime(slotEnd),
            durationMinutes: dto.durationMinutes,
            maxPatients: dto.maxPatients,
          });
          slotStart = slotEnd;
        }
      }
      current.setDate(current.getDate() + 1);
    }

    // Use createMany with skipDuplicates to handle the unique constraint gracefully
    const result = await this.prisma.doctorSlot.createMany({
      data: slotsToCreate,
      skipDuplicates: true,
    });

    return { count: result.count };
  }

  async findAvailableSlots(tenantId: string, doctorId: string, date: string) {
    const slotDate = new Date(date);
    // Fetch non-blocked slots and filter in-process for available capacity
    const slots = await this.prisma.doctorSlot.findMany({
      where: {
        tenantId,
        doctorId,
        slotDate,
        isBlocked: false,
      },
      orderBy: { startTime: 'asc' },
    });
    return slots.filter((s) => s.bookedCount < s.maxPatients);
  }

  async findDoctorsAvailability(
    tenantId: string,
    specialty?: string,
    fromDate?: string,
    toDate?: string,
  ) {
    const dateFrom = fromDate ? new Date(fromDate) : new Date();
    const dateTo = toDate ? new Date(toDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const doctorProfiles = await this.prisma.doctorProfile.findMany({
      where: {
        tenantId,
        ...(specialty ? { specialty: { contains: specialty, mode: 'insensitive' } } : {}),
        isAcceptingPatients: true,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        slots: {
          where: {
            tenantId,
            slotDate: { gte: dateFrom, lte: dateTo },
            isBlocked: false,
          },
        },
      },
    });

    return doctorProfiles.map((dp) => {
      const availableSlots = dp.slots.filter((s) => s.bookedCount < s.maxPatients);
      return {
        doctorProfileId: dp.id,
        userId: dp.userId,
        name: `${dp.user.firstName} ${dp.user.lastName}`,
        email: dp.user.email,
        specialty: dp.specialty,
        subSpecialty: dp.subSpecialty,
        consultationFee: dp.consultationFee,
        availableSlotCount: availableSlots.length,
        slots: availableSlots,
      };
    });
  }

  async blockSlot(id: string, tenantId: string, reason: string) {
    const slot = await this.prisma.doctorSlot.findFirst({ where: { id, tenantId } });
    if (!slot) throw new NotFoundException('Slot not found');

    return this.prisma.doctorSlot.update({
      where: { id },
      data: { isBlocked: true, blockReason: reason },
    });
  }

  async unblockSlot(id: string, tenantId: string) {
    const slot = await this.prisma.doctorSlot.findFirst({ where: { id, tenantId } });
    if (!slot) throw new NotFoundException('Slot not found');

    return this.prisma.doctorSlot.update({
      where: { id },
      data: { isBlocked: false, blockReason: null },
    });
  }

  async deleteSlot(id: string, tenantId: string) {
    const slot = await this.prisma.doctorSlot.findFirst({ where: { id, tenantId } });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.bookedCount > 0) {
      throw new ConflictException('Cannot delete a slot that has booked appointments');
    }

    return this.prisma.doctorSlot.delete({ where: { id } });
  }
}
