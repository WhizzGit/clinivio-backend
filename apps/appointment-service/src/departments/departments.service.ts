import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/create-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateDepartmentDto) {
    const existing = await this.prisma.department.findFirst({
      where: { tenantId, code: dto.code.toUpperCase() },
    });
    if (existing) throw new ConflictException(`Department code '${dto.code}' already exists`);

    return this.prisma.department.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code.toUpperCase(),
        description: dto.description,
        icon: dto.icon,
        color: dto.color,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async findAll(tenantId: string, activeOnly = true) {
    return this.prisma.department.findMany({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { doctors: true, appointments: true } },
      },
    });
  }

  async findOne(id: string, tenantId: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, tenantId },
      include: {
        doctors: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async update(id: string, tenantId: string, dto: UpdateDepartmentDto) {
    await this.findOne(id, tenantId);
    return this.prisma.department.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        icon: dto.icon,
        color: dto.color,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return this.prisma.department.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // Seed default departments for a new tenant
  async seedDefaults(tenantId: string) {
    const defaults = [
      { name: 'General Medicine', code: 'GENERAL', icon: '🩺', color: '#3B82F6', sortOrder: 1 },
      { name: 'Emergency', code: 'EMERGENCY', icon: '🚨', color: '#EF4444', sortOrder: 2 },
      { name: 'Cardiology', code: 'CARDIO', icon: '❤️', color: '#EC4899', sortOrder: 3 },
      { name: 'Orthopedics', code: 'ORTHO', icon: '🦴', color: '#F59E0B', sortOrder: 4 },
      { name: 'Dermatology', code: 'DERM', icon: '🧴', color: '#8B5CF6', sortOrder: 5 },
      { name: 'Gynecology', code: 'GYNEC', icon: '👩‍⚕️', color: '#EC4899', sortOrder: 6 },
      { name: 'Pediatrics', code: 'PEDS', icon: '👶', color: '#10B981', sortOrder: 7 },
      { name: 'ENT', code: 'ENT', icon: '👂', color: '#6366F1', sortOrder: 8 },
      { name: 'Ophthalmology', code: 'OPHTHAL', icon: '👁️', color: '#14B8A6', sortOrder: 9 },
      { name: 'Diabetology', code: 'DIAB', icon: '🩸', color: '#F97316', sortOrder: 10 },
    ];

    await this.prisma.department.createMany({
      data: defaults.map((d) => ({ ...d, tenantId })),
      skipDuplicates: true,
    });

    return this.findAll(tenantId);
  }
}
