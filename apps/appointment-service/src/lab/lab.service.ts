import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { CreateLabTestDto, UpdateLabTestDto, CreateLabOrderDto, CollectSampleDto, EnterResultsDto } from './dto/lab.dto';

function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(100000 + Math.random() * 900000);
  return `LAB-${year}-${seq}`;
}

const ORDER_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true, uhid: true, phone: true } },
  appointment: { select: { id: true, tokenNumber: true } },
  orderedBy: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  items: {
    include: {
      labTest: { select: { id: true, name: true, code: true, unit: true, normalRange: true, price: true } },
    },
  },
};

@Injectable()
export class LabService {
  constructor(private prisma: PrismaService) {}

  private async generateInvoiceNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.invoice.count({ where: { tenantId } });
    return `INV-${yyyymm}-${String(count + 1).padStart(6, '0')}`;
  }

  // ── Lab Test Catalog ─────────────────────────────────────────────────────────

  async createTest(tenantId: string, dto: CreateLabTestDto) {
    return this.prisma.labTest.create({
      data: { tenantId, ...dto, code: dto.code.toUpperCase() },
    });
  }

  async findAllTests(tenantId: string, activeOnly = true) {
    return this.prisma.labTest.findMany({
      where: { tenantId, ...(activeOnly && { isActive: true }) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async updateTest(id: string, tenantId: string, dto: UpdateLabTestDto) {
    await this.prisma.labTest.findFirstOrThrow({ where: { id, tenantId } });
    return this.prisma.labTest.update({ where: { id }, data: dto });
  }

  // ── Lab Orders ───────────────────────────────────────────────────────────────

  async createOrder(tenantId: string, orderedById: string, dto: CreateLabOrderDto) {
    if (!dto.items.length) throw new BadRequestException('At least one test is required');
    const tests = await this.prisma.labTest.findMany({
      where: { tenantId, id: { in: dto.items.map(i => i.labTestId) }, isActive: true },
    });
    if (tests.length !== dto.items.length) throw new BadRequestException('One or more tests not found or inactive');

    const orderNumber = generateOrderNumber();
    const [order] = await Promise.all([
      this.prisma.labOrder.create({
        data: {
          tenantId,
          orderNumber,
          patientId: dto.patientId,
          appointmentId: dto.appointmentId,
          orderedById,
          priority: dto.priority ?? 'ROUTINE',
          clinicalNotes: dto.clinicalNotes,
          sampleType: dto.sampleType,
          items: {
            create: dto.items.map(i => {
              const test = tests.find(t => t.id === i.labTestId)!;
              return { labTestId: i.labTestId, unit: test.unit, normalRange: test.normalRange };
            }),
          },
        },
        include: ORDER_INCLUDE,
      }),
      this.generateInvoiceNumber(tenantId).then(invoiceNumber => {
        const subtotal = tests.reduce((s, t) => s + Number(t.price), 0);
        return this.prisma.invoice.create({
          data: {
            tenantId,
            patientId: dto.patientId,
            appointmentId: dto.appointmentId,
            invoiceNumber,
            invoiceType: 'LAB',
            lineItems: tests.map(t => ({
              description: t.name,
              code: t.code,
              quantity: 1,
              unitPrice: Number(t.price),
              amount: Number(t.price),
            })),
            subtotal,
            discountAmount: 0,
            taxableAmount: subtotal,
            cgstAmount: 0,
            sgstAmount: 0,
            igstAmount: 0,
            totalAmount: subtotal,
            paymentStatus: 'PENDING',
            notes: `Lab order ${orderNumber}`,
          },
        });
      }),
    ]);
    return order;
  }

  async getAnalytics(tenantId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [allOrders, allTests, criticalItems] = await Promise.all([
      this.prisma.labOrder.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: {
          id: true, status: true, createdAt: true, completedAt: true,
          items: { select: { flag: true, labTest: { select: { category: true, price: true } } } },
        },
      }),
      this.prisma.labTest.findMany({ where: { tenantId }, select: { category: true, price: true, isActive: true } }),
      this.prisma.labOrderItem.count({ where: { labOrder: { tenantId }, flag: 'CRITICAL' } }),
    ]);

    const completedOrders = allOrders.filter(o => o.status === 'COMPLETED');
    const todayOrders = allOrders.filter(o => o.createdAt >= today);

    const completedRevenue = completedOrders.reduce(
      (sum, o) => sum + o.items.reduce((s, i) => s + Number(i.labTest.price), 0), 0,
    );

    const turnarounds = completedOrders
      .filter(o => o.completedAt)
      .map(o => (o.completedAt!.getTime() - o.createdAt.getTime()) / (1000 * 60 * 60));
    const avgTurnaroundHours = turnarounds.length > 0
      ? Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 10) / 10
      : 0;

    const totalItems = completedOrders.reduce((sum, o) => sum + o.items.length, 0);

    const categoryBreakdown: Record<string, { orderCount: number; revenue: number; testCount: number; activeTests: number }> = {};
    allTests.forEach(t => {
      if (!categoryBreakdown[t.category]) categoryBreakdown[t.category] = { orderCount: 0, revenue: 0, testCount: 0, activeTests: 0 };
      categoryBreakdown[t.category].testCount++;
      if (t.isActive) categoryBreakdown[t.category].activeTests++;
    });
    completedOrders.forEach(o => {
      const seen = new Set<string>();
      o.items.forEach(i => {
        const cat = i.labTest.category;
        if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { orderCount: 0, revenue: 0, testCount: 0, activeTests: 0 };
        if (!seen.has(cat)) { categoryBreakdown[cat].orderCount++; seen.add(cat); }
        categoryBreakdown[cat].revenue += Number(i.labTest.price);
      });
    });

    return {
      period: days,
      totalOrders: allOrders.length,
      completedOrders: completedOrders.length,
      todayOrders: todayOrders.length,
      completedRevenue: Math.round(completedRevenue * 100) / 100,
      avgTurnaroundHours,
      criticalItems,
      criticalRate: totalItems > 0 ? Math.round((criticalItems / totalItems) * 100) : 0,
      categoryBreakdown,
    };
  }

  async findAllOrders(tenantId: string, status?: string, patientId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = { tenantId, ...(status && { status }), ...(patientId && { patientId }) };
    const [orders, total] = await Promise.all([
      this.prisma.labOrder.findMany({ where, include: ORDER_INCLUDE, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.labOrder.count({ where }),
    ]);
    return { data: orders, total, page, limit };
  }

  async findOrder(id: string, tenantId: string) {
    const order = await this.prisma.labOrder.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Lab order not found');
    return order;
  }

  async collectSample(id: string, tenantId: string, technicianId: string, dto: CollectSampleDto) {
    const order = await this.findOrder(id, tenantId);
    if (order.status !== 'PENDING') throw new BadRequestException('Order is not in PENDING status');
    return this.prisma.labOrder.update({
      where: { id },
      data: {
        status: 'SAMPLE_COLLECTED',
        assignedToId: technicianId,
        collectedAt: new Date(),
        ...(dto.sampleType && { sampleType: dto.sampleType }),
      },
      include: ORDER_INCLUDE,
    });
  }

  async startProcessing(id: string, tenantId: string, technicianId: string) {
    const order = await this.findOrder(id, tenantId);
    if (order.status !== 'SAMPLE_COLLECTED') throw new BadRequestException('Sample not yet collected');
    return this.prisma.labOrder.update({
      where: { id },
      data: { status: 'IN_PROGRESS', assignedToId: technicianId },
      include: ORDER_INCLUDE,
    });
  }

  async enterResults(id: string, tenantId: string, dto: EnterResultsDto) {
    const order = await this.findOrder(id, tenantId);
    if (!['IN_PROGRESS', 'SAMPLE_COLLECTED'].includes(order.status)) {
      throw new BadRequestException('Order must be IN_PROGRESS or SAMPLE_COLLECTED to enter results');
    }
    await Promise.all(
      dto.results.map(r =>
        this.prisma.labOrderItem.update({
          where: { id: r.itemId },
          data: {
            result: r.result,
            ...(r.unit && { unit: r.unit }),
            ...(r.normalRange && { normalRange: r.normalRange }),
            ...(r.flag && { flag: r.flag as any }),
            ...(r.notes && { notes: r.notes }),
          },
        }),
      ),
    );
    const allItems = await this.prisma.labOrderItem.findMany({ where: { labOrderId: id } });
    const allFilled = allItems.every(i => i.result !== null);
    if (allFilled) {
      await this.prisma.labOrder.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    }
    return this.findOrder(id, tenantId);
  }

  async cancelOrder(id: string, tenantId: string) {
    const order = await this.findOrder(id, tenantId);
    if (order.status === 'COMPLETED') throw new BadRequestException('Cannot cancel a completed order');
    return this.prisma.labOrder.update({ where: { id }, data: { status: 'CANCELLED' }, include: ORDER_INCLUDE });
  }

  async getStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [pending, sampleCollected, inProgress, completedToday, total] = await Promise.all([
      this.prisma.labOrder.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.labOrder.count({ where: { tenantId, status: 'SAMPLE_COLLECTED' } }),
      this.prisma.labOrder.count({ where: { tenantId, status: 'IN_PROGRESS' } }),
      this.prisma.labOrder.count({ where: { tenantId, status: 'COMPLETED', completedAt: { gte: today } } }),
      this.prisma.labOrder.count({ where: { tenantId } }),
    ]);
    return { pending, sampleCollected, inProgress, completedToday, total };
  }
}
