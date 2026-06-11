import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  LabTest,
  LabOrder,
  LabOrderItem,
  Invoice,
  LabOrderStatus,
  LabResultFlag,
  TenantEntityManager,
  ILike,
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
  constructor(private readonly db: TenantEntityManager) {}

  private async generateOrderNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.db.repo(LabOrder).count({ where: { tenantId } });
    return `LAB-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private async loadOrder(id: string) {
    return this.db.repo(LabOrder).findOne({
      where: { id },
      relations: ['patient', 'orderedBy', 'assignedTo', 'items', 'items.labTest'],
    });
  }

  async createTest(tenantId: string, dto: CreateLabTestDto) {
    const existing = await this.db.repo(LabTest).findOne({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException(`Lab test with code '${dto.code}' already exists`);

    return this.db.repo(LabTest).save(
      this.db.repo(LabTest).create({
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

  async findTests(tenantId: string, q?: string, category?: string, all = false) {
    const activeFilter = all ? {} : { isActive: true };
    if (q) {
      return this.db.repo(LabTest).find({
        where: [
          { tenantId, ...activeFilter, name: ILike(`%${q}%`) },
          { tenantId, ...activeFilter, code: ILike(`%${q}%`) },
          { tenantId, ...activeFilter, category: ILike(`%${q}%`) },
        ],
        order: { name: 'ASC' },
      });
    }
    const where: any = { tenantId, ...activeFilter };
    if (category) where.category = category;
    return this.db.repo(LabTest).find({ where, order: { name: 'ASC' } });
  }

  async findTestById(id: string, tenantId: string) {
    const test = await this.db.repo(LabTest).findOne({ where: { id, tenantId } });
    if (!test) throw new NotFoundException('Lab test not found');
    return test;
  }

  async updateTest(id: string, tenantId: string, dto: Partial<CreateLabTestDto> & { isActive?: boolean }) {
    await this.findTestById(id, tenantId);
    const updates: Partial<LabTest> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.normalRange !== undefined) updates.normalRange = dto.normalRange;
    if (dto.price !== undefined) updates.price = String(dto.price);
    if (dto.turnaround !== undefined) updates.turnaround = dto.turnaround;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;
    await this.db.repo(LabTest).update(id, updates);
    return this.db.repo(LabTest).findOne({ where: { id } });
  }

  async createOrder(tenantId: string, dto: CreateLabOrderDto) {
    if (!dto.testIds?.length) throw new BadRequestException('At least one test is required');

    const tests = await this.db.repo(LabTest).find({
      where: dto.testIds.map((id) => ({ id, tenantId, isActive: true })),
    });

    if (tests.length !== dto.testIds.length) throw new BadRequestException('One or more test IDs are invalid');

    const orderNumber = await this.generateOrderNumber(tenantId);

    const order = await this.db.repo(LabOrder).save(
      this.db.repo(LabOrder).create({
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

    const items = tests.map((test) =>
      this.db.repo(LabOrderItem).create({
        labOrderId: order.id,
        labTestId: test.id,
        unit: test.unit,
        normalRange: test.normalRange,
      }),
    );
    await this.db.repo(LabOrderItem).save(items);

    const totalAmount = tests.reduce((sum, t) => sum + Number(t.price), 0);
    const lineItems = tests.map((t) => ({ testId: t.id, name: t.name, price: Number(t.price) }));

    await this.db.repo(Invoice).save(
      this.db.repo(Invoice).create({
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
        paymentStatus: 'PENDING' as any,
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

    const qb = this.db
      .qb(LabOrder, 'lo')
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
    if (!order || order.tenantId !== tenantId) throw new NotFoundException('Lab order not found');
    return order;
  }

  async updateOrderStatus(id: string, tenantId: string, status: LabOrderStatus, assignedToId?: string) {
    const order = await this.db.repo(LabOrder).findOne({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Lab order not found');

    const updates: Partial<LabOrder> = { status };
    if (assignedToId) updates.assignedToId = assignedToId;
    if (status === LabOrderStatus.SAMPLE_COLLECTED) updates.collectedAt = new Date();
    if (status === LabOrderStatus.COMPLETED) updates.completedAt = new Date();

    await this.db.repo(LabOrder).update(id, updates);
    return this.loadOrder(id);
  }

  async updateOrderItemResult(itemId: string, tenantId: string, dto: UpdateLabOrderItemDto) {
    const item = await this.db
      .qb(LabOrderItem, 'item')
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

    await this.db.repo(LabOrderItem).update(itemId, updates);
    return this.db.repo(LabOrderItem).findOne({ where: { id: itemId }, relations: ['labTest'] });
  }

  async getAnalytics(tenantId: string, from?: string, to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [totalOrders, byStatus, todayOrders, avgRow, criticalItems, totalItems] = await Promise.all([
      this.db.qb(LabOrder, 'lo')
        .where('lo.tenantId = :tenantId AND lo.createdAt >= :from AND lo.createdAt <= :to', { tenantId, from: fromDate, to: toDate })
        .getCount(),

      this.db.qb(LabOrder, 'lo')
        .select('lo.status', 'status').addSelect('COUNT(lo.id)', 'count')
        .where('lo.tenantId = :tenantId AND lo.createdAt >= :from AND lo.createdAt <= :to', { tenantId, from: fromDate, to: toDate })
        .groupBy('lo.status')
        .getRawMany<{ status: string; count: string }>(),

      this.db.qb(LabOrder, 'lo')
        .where('lo.tenantId = :tenantId AND lo.createdAt >= :today', { tenantId, today })
        .getCount(),

      this.db.qb(LabOrder, 'lo')
        .select('AVG(EXTRACT(EPOCH FROM (lo.completedAt - lo.createdAt)) / 3600)', 'avgHours')
        .where('lo.tenantId = :tenantId AND lo.status = :status AND lo.completedAt IS NOT NULL AND lo.createdAt >= :from AND lo.createdAt <= :to', {
          tenantId, status: LabOrderStatus.COMPLETED, from: fromDate, to: toDate,
        })
        .getRawOne<{ avgHours: string }>(),

      this.db.qb(LabOrderItem, 'item')
        .leftJoin('item.labOrder', 'lo')
        .where('lo.tenantId = :tenantId AND lo.createdAt >= :from AND lo.createdAt <= :to AND item.flag = :flag', {
          tenantId, from: fromDate, to: toDate, flag: LabResultFlag.CRITICAL,
        })
        .getCount(),

      this.db.qb(LabOrderItem, 'item')
        .leftJoin('item.labOrder', 'lo')
        .where('lo.tenantId = :tenantId AND lo.createdAt >= :from AND lo.createdAt <= :to', { tenantId, from: fromDate, to: toDate })
        .getCount(),
    ]);

    const completedOrders = Number(byStatus.find(r => r.status === LabOrderStatus.COMPLETED)?.count ?? 0);
    const avgTurnaroundHours = Math.round(parseFloat(avgRow?.avgHours ?? '0') * 10) / 10;
    const criticalRate = totalItems > 0 ? Math.round((criticalItems / totalItems) * 1000) / 10 : 0;

    // Revenue from lab invoices in the period
    const revenueRow = await this.db.qb(Invoice, 'inv')
      .select('COALESCE(SUM(inv.totalAmount), 0)', 'total')
      .where('inv.tenantId = :tenantId AND inv.invoiceType = :type AND inv.paymentStatus = :paid AND inv.createdAt >= :from AND inv.createdAt <= :to', {
        tenantId, type: 'LAB', paid: 'PAID', from: fromDate, to: toDate,
      })
      .getRawOne<{ total: string }>();
    const completedRevenue = parseFloat(revenueRow?.total ?? '0');

    // Category breakdown: orderCount and revenue per test category
    const categoryOrders = await this.db.qb(LabOrderItem, 'item')
      .leftJoin('item.labOrder', 'lo')
      .leftJoin('item.labTest', 'test')
      .select('test.category', 'category')
      .addSelect('COUNT(DISTINCT lo.id)', 'orderCount')
      .addSelect('COALESCE(SUM(test.price), 0)', 'revenue')
      .where('lo.tenantId = :tenantId AND lo.createdAt >= :from AND lo.createdAt <= :to', { tenantId, from: fromDate, to: toDate })
      .groupBy('test.category')
      .getRawMany<{ category: string; orderCount: string; revenue: string }>();

    const categoryTests = await this.db.qb(LabTest, 'test')
      .select('test.category', 'category')
      .addSelect('COUNT(test.id)', 'testCount')
      .addSelect('SUM(CASE WHEN test.isActive THEN 1 ELSE 0 END)', 'activeTests')
      .where('test.tenantId = :tenantId', { tenantId })
      .groupBy('test.category')
      .getRawMany<{ category: string; testCount: string; activeTests: string }>();

    const categoryBreakdown: Record<string, { orderCount: number; revenue: number; testCount: number; activeTests: number }> = {};
    for (const row of categoryTests) {
      categoryBreakdown[row.category] = {
        orderCount: 0, revenue: 0,
        testCount: Number(row.testCount),
        activeTests: Number(row.activeTests),
      };
    }
    for (const row of categoryOrders) {
      if (!categoryBreakdown[row.category]) {
        categoryBreakdown[row.category] = { orderCount: 0, revenue: 0, testCount: 0, activeTests: 0 };
      }
      categoryBreakdown[row.category].orderCount = Number(row.orderCount);
      categoryBreakdown[row.category].revenue = parseFloat(row.revenue);
    }

    return {
      period: 30,
      totalOrders,
      completedOrders,
      todayOrders,
      completedRevenue,
      avgTurnaroundHours,
      criticalItems,
      criticalRate,
      categoryBreakdown,
    };
  }
}
