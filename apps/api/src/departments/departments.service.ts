import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from '@mediflow/database';

export class CreateDepartmentDto {
  name: string;
  code: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
}

export class UpdateDepartmentDto {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
}

const DEFAULT_DEPARTMENTS = [
  { name: 'General Medicine', code: 'GEN', icon: '🏥', color: '#3B82F6', sortOrder: 1 },
  { name: 'Cardiology', code: 'CARD', icon: '❤️', color: '#EF4444', sortOrder: 2 },
  { name: 'Orthopaedics', code: 'ORTH', icon: '🦴', color: '#F59E0B', sortOrder: 3 },
  { name: 'Gynaecology', code: 'GYN', icon: '👶', color: '#EC4899', sortOrder: 4 },
  { name: 'Paediatrics', code: 'PAED', icon: '🧒', color: '#8B5CF6', sortOrder: 5 },
  { name: 'ENT', code: 'ENT', icon: '👂', color: '#06B6D4', sortOrder: 6 },
  { name: 'Ophthalmology', code: 'OPH', icon: '👁️', color: '#10B981', sortOrder: 7 },
  { name: 'Dermatology', code: 'DERM', icon: '🧴', color: '#F97316', sortOrder: 8 },
  { name: 'Neurology', code: 'NEURO', icon: '🧠', color: '#6366F1', sortOrder: 9 },
  { name: 'Psychiatry', code: 'PSYCH', icon: '🧘', color: '#84CC16', sortOrder: 10 },
];

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private departmentRepo: Repository<Department>,
  ) {}

  async create(tenantId: string, dto: CreateDepartmentDto) {
    const existing = await this.departmentRepo.findOne({
      where: { tenantId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Department with code '${dto.code}' already exists`);
    }

    const dept = await this.departmentRepo.save(
      this.departmentRepo.create({
        tenantId,
        name: dto.name,
        code: dto.code.toUpperCase(),
        description: dto.description ?? null,
        icon: dto.icon ?? null,
        color: dto.color ?? '#3B82F6',
        sortOrder: dto.sortOrder ?? 0,
        isActive: true,
      }),
    );

    return dept;
  }

  async findAll(tenantId: string) {
    const departments = await this.departmentRepo
      .createQueryBuilder('dept')
      .loadRelationCountAndMap('dept.doctorCount', 'dept.doctors')
      .where('dept.tenantId = :tenantId', { tenantId })
      .andWhere('dept.isActive = true')
      .orderBy('dept.sortOrder', 'ASC')
      .addOrderBy('dept.name', 'ASC')
      .getMany();

    return departments;
  }

  async findById(id: string, tenantId: string) {
    const dept = await this.departmentRepo
      .createQueryBuilder('dept')
      .loadRelationCountAndMap('dept.doctorCount', 'dept.doctors')
      .where('dept.id = :id', { id })
      .andWhere('dept.tenantId = :tenantId', { tenantId })
      .getOne();

    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async update(id: string, tenantId: string, dto: UpdateDepartmentDto) {
    const dept = await this.departmentRepo.findOne({ where: { id, tenantId } });
    if (!dept) throw new NotFoundException('Department not found');

    await this.departmentRepo.update(id, {
      name: dto.name ?? undefined,
      description: dto.description ?? undefined,
      icon: dto.icon ?? undefined,
      color: dto.color ?? undefined,
      sortOrder: dto.sortOrder ?? undefined,
      isActive: dto.isActive ?? undefined,
    });

    return this.findById(id, tenantId);
  }

  async delete(id: string, tenantId: string) {
    const dept = await this.departmentRepo.findOne({ where: { id, tenantId } });
    if (!dept) throw new NotFoundException('Department not found');
    await this.departmentRepo.update(id, { isActive: false });
    return { deleted: true };
  }

  async seedDefaults(tenantId: string) {
    const values = DEFAULT_DEPARTMENTS.map((d) => ({
      ...d,
      tenantId,
      isActive: true,
    }));

    await this.departmentRepo
      .createQueryBuilder()
      .insert()
      .into(Department)
      .values(values)
      .orIgnore()
      .execute();

    return this.findAll(tenantId);
  }
}
