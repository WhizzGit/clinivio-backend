import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import {
  LabTest,
  LabOrder,
  LabOrderItem,
  Invoice,
  LabOrderStatus,
  LabResultFlag,
  PaymentStatus,
} from '@mediflow/database';

export class CreateLabTestDto {
  name: string;
  code: string;
  category: string;
  unit?: string;
  normalRange?: string;
  price?: number;
  turnaround?: number;
}

export class CreateLabOrderDto {
  patientId: string;
  orderedById: string;
  appointmentId?: string;
  priority?: string;
  clinicalNotes?: string;
  sampleType?: string;
  testIds: string[];
}

export class UpdateLabOrderItemDto {
  result?: string;
  unit?: string;
  normalRange?: string;
  flag?: LabResultFlag;
  notes?: string;
}

@Injectable()
export class LabService {
  constructor(
    @InjectRepository(LabTest)
    private labTestRepo: Repository<LabTest>,
    @InjectRepository(LabOrder)
    private labOrderRepo: Repository<LabOrder>,
    @InjectRepository(LabOrderItem)
    private labOrderItemRepo: Repository<LabOrderItem>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
  ) {}

  private async generateOrderNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.labOrderRepo.count({ where: { tenantId } });
    return `LAB-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private async loadOrder(id: string) {
    return this.labOrderRepo.findOne({
      where: { id },
      relations: ['patient', 'orderedBy', 'assignedTo', 'items', 'items.labTest'],
    });
  }

  // ─── Lab Tests (Catalog) ──────────────────────────────────────────────────────

  async createTest(tenantId: string, dto: CreateLabTestDto) {
    const existing = await this.labTestRepo.findOne({
      where: { tenantId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Lab test with code '${dto.code}' already exists`);
    }

    return this.labTestRepo.save(
      this.labTestRepo.create({
        tenantId,
        name: dto.name,
        code: dto.code.toUpperCase(),
        category: dto.category,
        unit: dto.unit ?? null,
        normalRange: dto.normalRange ?? null,
        price: dto.price !== undefined ? String(dto.price) : '0',
        turnaround: dto.turnaround ?? 24,
        isActive: true,
      }),
    );
  }

  async findTests(tenantId: string, q?: string, category?: string) {
    if (q) {
      return this.labTestRepo.find({
        where: [
          { tenantId, isActive: true, name: ILike(`%${q}%`) },
          { tenantId, isActive: true, code: ILike(`%${q}%`) },
          { tenantId, isActive: true, category: ILike(`%${q}%`) },
        ],
        order: { name: 'ASC' },
      });
    }

    const where: any = { tenantId, isActive: true };
    if (category) where.category = category;

    return this.labTestRepo.find({ where, order: { name: 'ASC' } });
  }

  async findTestById(id: string, tenantId: string) {
    const test = await this.labTestRepo.findOne({ where: { id, tenantId } });
    if (!test) throw new NotFoundException('Lab test not found');
    return test;
  }

  async updateTest(id: string, tenantId: string, dto: Partial<CreateLabTestDto>) {
    await this.findTestById(id, tenantId);
    const updates: Partial<LabTest> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.normalRange !== undefined) updates.normalRange = dto.normalRange;
    if (dto.price !== undefined) updates.price = String(dto.price);
    if (dto.turnaround !== undefined) updates.turnaround = dto.turnaround;
    await this.labTestRepo.update(id, updates);
    return this.labTestRepo.findOne({ where: { id } });
  }

  // ─── Lab Orders ───────────────────────────────────────────────────────────────

  async createOrder(tenantId: string, dto: CreateLabOrderDto) {
    if (!dto.testIds?.length) {
      throw new BadRequestException('At least one test is required');
    }

    const tests = await this.labTestRepo.find({
      where: dto.testIds.map((id) => ({ id, tenantId, isActive: true })),
    });

    if (tests.length !== dto.testIds.length) {
      throw new BadRequestException('One or more test IDs are invalid');
    }

    const orderNumber = await this.generateOrderNumber(tenantId);

    const order = await this.labOrderRepo.save(
      this.labOrderRepo.create({
        tenantId,
        orderNumber,
        patientId: dto.patientId,
        orderedById: dto.orderedById,
        appointmentId: dto.appointmentId ?? null,
        priority: dto.priority ?? 'ROUTINE',
        clinicalNotes: dto.clinicalNotes ?? null,
        sampleType: dto.sampleType ?? null,
        status: LabOrderStatus.PENDING,
      }),
    );

    // Create order items
    const items = tests.map((test) =>
      this.labOrderItemRepo.create({
        labOrderId: order.id,
        labTestId: test.id,
        unit: test.unit,
        normalRange: test.normalRange,
      }),
    );
    await this.labOrderItemRepo.save(items);

    // Create invoice for the lab order
    const totalAmount = tests.reduce((sum, t) => sum + Number(t.price), 0);
    const lineItems = tests.map((t) => ({
      testId: t.id,
      name: t.name,
      price: Number(t.price),
    }));

    await this.invoiceRepo.save(
      this.invoiceRepo.create({
        tenantId,
        patientId: dto.patientId,
        appointmentId: dto.appointmentId ?? null,
        invoiceNumber: `INV-LAB-${orderNumber}`,
        invoiceType: 'LAB' as any,
        lineItems,
        subtotal: String(totalAmount),
        discountAmount: '0',
        taxableAmount: String(totalAmount),
        cgstAmount: '0',
        sgstAmount: '0',
        igstAmount: '0',
        totalAmount: String(totalAmount),
        paymentStatus: PaymentStatus.PENDING,
      }),
    );

    return this.loadOrder(order.id);
  }

  async findOrders(
    tenantId: string,
    filters: { patientId?: string; status?: LabOrderStatus; from?: string; to?: string },
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;

    const qb = this.labOrderRepo
      .createQueryBuilder('lo')
      .leftJoinAndSelect('lo.patient', 'patient')
      .leftJoinAndSelect('lo.orderedBy', 'orderedBy')
      .leftJoinAndSelect('lo.assignedTo', 'assignedTo')
      .leftJoinAndSelect('lo.items', 'items')
      .leftJoinAndSelect('items.labTest', 'labTest')
      .where('lo.tenantId = :tenantId', { tenantId });

    if (filters.patientId) qb.andWhere('lo.patientId = :patientId', { patientId: filters.patientId });
    if (filters.status) qb.andWhere('lo.status = :status', { status: filters.status });
    if (filters.from) qb.andWhere('lo.createdAt >= :from', { from: new Date(filters.from) });
    if (filters.to) qb.andWhere('lo.createdAt <= :to', { to: new Date(filters.to) });

    qb.orderBy('lo.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOrderById(id: string, tenantId: string) {
    const order = await this.loadOrder(id);
    if (!order || order.tenantId !== tenantId) {
      throw new NotFoundException('Lab order not found');
    }
    return order;
  }

  async updateOrderStatus(id: string, tenantId: string, status: LabOrderStatus, assignedToId?: string) {
    const order = await this.labOrderRepo.findOne({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Lab order not found');

    const updates: Partial<LabOrder> = { status };
    if (assignedToId) updates.assignedToId = assignedToId;
    if (status === LabOrderStatus.SAMPLE_COLLECTED) updates.collectedAt = new Date();
    if (status === LabOrderStatus.COMPLETED) updates.completedAt = new Date();

    await this.labOrderRepo.update(id, updates);
    return this.loadOrder(id);
  }

  async updateOrderItemResult(itemId: string, tenantId: string, dto: UpdateLabOrderItemDto) {
    const item = await this.labOrderItemRepo
      .createQueryBuilder('item')
      .leftJoin('item.labOrder', 'order')
      .where('item.id = :itemId', { itemId })
      .andWhere('order.tenantId = :tenantId', { tenantId })
      .getOne();

    if (!item) throw new NotFoundException('Lab order item not found');

    const updates: Partial<LabOrderItem> = {};
    if (dto.result !== undefined) updates.result = dto.result;
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.normalRange !== undefined) updates.normalRange = dto.normalRange;
    if (dto.flag !== undefined) updates.flag = dto.flag;
    if (dto.notes !== undefined) updates.notes = dto.notes;

    await this.labOrderItemRepo.update(itemId, updates);
    return this.labOrderItemRepo.findOne({ where: { id: itemId }, relations: ['labTest'] });
  }

  async getAnalytics(tenantId: string, from?: string, to?: string) {
    const qb = this.labOrderRepo
      .createQueryBuilder('lo')
      .where('lo.tenantId = :tenantId', { tenantId });

    if (from) qb.andWhere('lo.createdAt >= :from', { from: new Date(from) });
    if (to) qb.andWhere('lo.createdAt <= :to', { to: new Date(to) });

    const [totalOrders, byStatus, byPriority, pendingCount] = await Promise.all([
      qb.getCount(),

      this.labOrderRepo
        .createQueryBuilder('lo')
        .select('lo.status', 'status')
        .addSelect('COUNT(lo.id)', 'count')
        .where('lo.tenantId = :tenantId', { tenantId })
        .groupBy('lo.status')
        .getRawMany<{ status: string; count: string }>(),

      this.labOrderRepo
        .createQueryBuilder('lo')
        .select('lo.priority', 'priority')
        .addSelect('COUNT(lo.id)', 'count')
        .where('lo.tenantId = :tenantId', { tenantId })
        .groupBy('lo.priority')
        .getRawMany<{ priority: string; count: string }>(),

      this.labOrderRepo.count({
        where: { tenantId, status: LabOrderStatus.PENDING },
      }),
    ]);

    // Top tests by order count
    const topTests = await this.labOrderItemRepo
      .createQueryBuilder('item')
      .leftJoin('item.labOrder', 'order')
      .leftJoinAndSelect('item.labTest', 'test')
      .select('item.labTestId', 'labTestId')
      .addSelect('test.name', 'testName')
      .addSelect('COUNT(item.id)', 'count')
      .where('order.tenantId = :tenantId', { tenantId })
      .groupBy('item.labTestId')
      .addGroupBy('test.name')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ labTestId: string; testName: string; count: string }>();

    return {
      totalOrders,
      pendingCount,
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
      byPriority: byPriority.map((r) => ({ priority: r.priority, count: Number(r.count) })),
      topTests: topTests.map((r) => ({
        labTestId: r.labTestId,
        testName: r.testName,
        count: Number(r.count),
      })),
    };
  }
}
