import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  PharmacyOrder,
  PharmacyInventory,
  Appointment,
  PharmacyOrderStatus,
  TenantEntityManager,
  ILike,
} from '@mediflow/database';

export class CreateInventoryItemDto {
  name: string;
  genericName?: string;
  category?: string;
  unit?: string;
  stockQty?: number;
  reorderLevel?: number;
  batchNo?: string;
  expiryDate?: string;
  mrp?: number;
  sellingPrice?: number;
  manufacturer?: string;
  hsn?: string;
}

export class UpdateInventoryItemDto {
  name?: string;
  genericName?: string;
  category?: string;
  unit?: string;
  stockQty?: number;
  reorderLevel?: number;
  batchNo?: string;
  expiryDate?: string;
  mrp?: number;
  sellingPrice?: number;
  manufacturer?: string;
  hsn?: string;
  isActive?: boolean;
}

export class UpdatePharmacyOrderDto {
  status?: PharmacyOrderStatus;
  dispenserNotes?: string;
}

@Injectable()
export class PharmacyService {
  constructor(private readonly db: TenantEntityManager) {}

  async findAll(
    tenantId: string,
    filters: { status?: PharmacyOrderStatus; from?: string; to?: string },
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;

    const qb = this.db
      .qb(PharmacyOrder, 'po')
      .leftJoinAndSelect('po.patient', 'patient')
      .leftJoinAndSelect('po.appointment', 'appointment')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .leftJoinAndSelect('appointment.department', 'department')
      .leftJoinAndSelect('appointment.consultation', 'consultation')
      .leftJoinAndSelect('consultation.prescriptions', 'prescriptions')
      .leftJoinAndSelect('prescriptions.items', 'items')
      .where('po.tenantId = :tenantId', { tenantId });

    if (filters.status) qb.andWhere('po.status = :status', { status: filters.status });
    if (filters.from) qb.andWhere('po.createdAt >= :from', { from: new Date(filters.from) });
    if (filters.to) qb.andWhere('po.createdAt <= :to', { to: new Date(filters.to) });

    qb.orderBy('po.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOrderById(id: string, tenantId: string) {
    const order = await this.db
      .qb(PharmacyOrder, 'po')
      .leftJoinAndSelect('po.patient', 'patient')
      .leftJoinAndSelect('po.appointment', 'appointment')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .leftJoinAndSelect('appointment.department', 'department')
      .leftJoinAndSelect('appointment.consultation', 'consultation')
      .leftJoinAndSelect('consultation.prescriptions', 'prescriptions')
      .leftJoinAndSelect('prescriptions.items', 'items')
      .where('po.id = :id', { id })
      .andWhere('po.tenantId = :tenantId', { tenantId })
      .getOne();

    if (!order) throw new NotFoundException('Pharmacy order not found');
    return order;
  }

  async updateOrder(id: string, tenantId: string, dto: UpdatePharmacyOrderDto) {
    const order = await this.db.repo(PharmacyOrder).findOne({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Pharmacy order not found');

    const updates: Partial<PharmacyOrder> = {};
    if (dto.status) updates.status = dto.status;
    if (dto.dispenserNotes !== undefined) updates.dispenserNotes = dto.dispenserNotes;
    if (dto.status === PharmacyOrderStatus.DISPENSED) updates.dispensedAt = new Date();

    await this.db.repo(PharmacyOrder).update(id, updates);
    return this.findOrderById(id, tenantId);
  }

  async listInventory(tenantId: string, q?: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    let items: PharmacyInventory[];
    let total: number;

    if (q) {
      [items, total] = await this.db.repo(PharmacyInventory).findAndCount({
        where: [
          { tenantId, isActive: true, name: ILike(`%${q}%`) },
          { tenantId, isActive: true, genericName: ILike(`%${q}%`) },
          { tenantId, isActive: true, category: ILike(`%${q}%`) },
        ],
        order: { name: 'ASC' },
        skip,
        take: limit,
      });
    } else {
      [items, total] = await this.db.repo(PharmacyInventory).findAndCount({
        where: { tenantId, isActive: true },
        order: { name: 'ASC' },
        skip,
        take: limit,
      });
    }

    return { data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findInventoryItem(id: string, tenantId: string) {
    const item = await this.db.repo(PharmacyInventory).findOne({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  async createInventoryItem(tenantId: string, dto: CreateInventoryItemDto) {
    return this.db.repo(PharmacyInventory).save(
      this.db.repo(PharmacyInventory).create({
        tenantId,
        name: dto.name,
        genericName: dto.genericName ?? null,
        category: dto.category ?? null,
        unit: dto.unit ?? 'Tablet',
        stockQty: dto.stockQty ?? 0,
        reorderLevel: dto.reorderLevel ?? 10,
        batchNo: dto.batchNo ?? null,
        expiryDate: dto.expiryDate ?? null,
        mrp: dto.mrp !== undefined ? String(dto.mrp) : '0',
        sellingPrice: dto.sellingPrice !== undefined ? String(dto.sellingPrice) : '0',
        manufacturer: dto.manufacturer ?? null,
        hsn: dto.hsn ?? null,
        isActive: true,
      }),
    );
  }

  async updateInventoryItem(id: string, tenantId: string, dto: UpdateInventoryItemDto) {
    await this.findInventoryItem(id, tenantId);

    const updates: Partial<PharmacyInventory> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.genericName !== undefined) updates.genericName = dto.genericName;
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.stockQty !== undefined) updates.stockQty = dto.stockQty;
    if (dto.reorderLevel !== undefined) updates.reorderLevel = dto.reorderLevel;
    if (dto.batchNo !== undefined) updates.batchNo = dto.batchNo;
    if (dto.expiryDate !== undefined) updates.expiryDate = dto.expiryDate;
    if (dto.mrp !== undefined) updates.mrp = String(dto.mrp);
    if (dto.sellingPrice !== undefined) updates.sellingPrice = String(dto.sellingPrice);
    if (dto.manufacturer !== undefined) updates.manufacturer = dto.manufacturer;
    if (dto.hsn !== undefined) updates.hsn = dto.hsn;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;

    await this.db.repo(PharmacyInventory).update(id, updates);
    return this.db.repo(PharmacyInventory).findOne({ where: { id } });
  }

  async adjustStock(id: string, tenantId: string, delta: number) {
    const item = await this.findInventoryItem(id, tenantId);
    const newQty = item.stockQty + delta;
    if (newQty < 0) throw new BadRequestException('Insufficient stock');
    await this.db.repo(PharmacyInventory).update(id, { stockQty: newQty });
    return this.db.repo(PharmacyInventory).findOne({ where: { id } });
  }

  async getLowStockItems(tenantId: string) {
    return this.db.qb(PharmacyInventory, 'inv')
      .where('inv.tenantId = :tenantId', { tenantId })
      .andWhere('inv.isActive = true')
      .andWhere('inv.stockQty <= inv.reorderLevel')
      .orderBy('inv.stockQty', 'ASC')
      .getMany();
  }

  async getExpiringItems(tenantId: string, withinDays = 30) {
    const today = new Date().toISOString().split('T')[0];
    const future = new Date();
    future.setDate(future.getDate() + withinDays);
    const futureDate = future.toISOString().split('T')[0];

    return this.db.qb(PharmacyInventory, 'inv')
      .where('inv.tenantId = :tenantId', { tenantId })
      .andWhere('inv.isActive = true')
      .andWhere('inv.expiryDate IS NOT NULL')
      .andWhere('inv.expiryDate >= :today', { today })
      .andWhere('inv.expiryDate <= :futureDate', { futureDate })
      .orderBy('inv.expiryDate', 'ASC')
      .getMany();
  }
}
