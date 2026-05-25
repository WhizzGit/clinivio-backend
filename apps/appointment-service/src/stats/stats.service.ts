import { Injectable } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getAdminDashboard(tenantId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      todayAppts, todayIPD, activeIPD,
      labPending, labInProgress, labCompletedToday,
      bedsOccupied, bedsTotal,
      revenueToday, revenueMTD, pendingInvoices,
      invoicesByType,
      departmentLoad,
    ] = await Promise.all([
      this.prisma.appointment.count({ where: { tenantId, createdAt: { gte: today } } }),
      this.prisma.iPDAdmission.count({ where: { tenantId, admittedAt: { gte: today } } }),
      this.prisma.iPDAdmission.count({ where: { tenantId, status: { in: ['ADMITTED', 'UNDER_TREATMENT', 'READY_FOR_DISCHARGE'] } } }),
      this.prisma.labOrder.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.labOrder.count({ where: { tenantId, status: 'IN_PROGRESS' } }),
      this.prisma.labOrder.count({ where: { tenantId, status: 'COMPLETED', completedAt: { gte: today } } }),
      this.prisma.bed.count({ where: { tenantId, status: 'OCCUPIED' } }),
      this.prisma.bed.count({ where: { tenantId } }),
      this.prisma.invoice.aggregate({ where: { tenantId, paymentStatus: 'PAID', paidAt: { gte: today } }, _sum: { totalAmount: true } }),
      this.prisma.invoice.aggregate({ where: { tenantId, paymentStatus: 'PAID', paidAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
      this.prisma.invoice.aggregate({ where: { tenantId, paymentStatus: 'PENDING' }, _sum: { totalAmount: true }, _count: { id: true } }),
      this.prisma.invoice.groupBy({ by: ['invoiceType'], where: { tenantId, paymentStatus: 'PAID', paidAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
      this.prisma.appointment.groupBy({
        by: ['departmentId'],
        where: { tenantId, createdAt: { gte: today }, departmentId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 6,
      }),
    ]);

    const deptIds = departmentLoad.map(d => d.departmentId).filter(Boolean) as string[];
    const departments = deptIds.length > 0
      ? await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true, icon: true, color: true } })
      : [];
    const deptMap = Object.fromEntries(departments.map(d => [d.id, d]));

    return {
      today: {
        appointments: todayAppts,
        ipdAdmissions: todayIPD,
        labCompleted: labCompletedToday,
      },
      ipd: {
        activeAdmissions: activeIPD,
        bedsOccupied,
        bedsTotal,
        occupancyRate: bedsTotal > 0 ? Math.round((bedsOccupied / bedsTotal) * 100) : 0,
      },
      lab: { pending: labPending, inProgress: labInProgress, completedToday: labCompletedToday },
      revenue: {
        today: Math.round(Number(revenueToday._sum.totalAmount || 0) * 100) / 100,
        mtd: Math.round(Number(revenueMTD._sum.totalAmount || 0) * 100) / 100,
        pendingAmount: Math.round(Number(pendingInvoices._sum.totalAmount || 0) * 100) / 100,
        pendingCount: pendingInvoices._count.id,
        byType: invoicesByType.reduce((acc: Record<string, number>, r) => {
          acc[r.invoiceType] = Math.round(Number(r._sum.totalAmount || 0) * 100) / 100;
          return acc;
        }, {}),
      },
      departmentLoad: departmentLoad.map(d => ({
        department: deptMap[d.departmentId!] || { id: d.departmentId, name: 'Other', icon: '🏥', color: '#6B7280' },
        count: d._count.id,
      })),
    };
  }

  async getPharmacyAnalytics(tenantId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [inventory, ordersToday, ordersMTD, pendingOrders, pharmacyRevenueMTD] = await Promise.all([
      this.prisma.pharmacyInventory.findMany({ where: { tenantId, isActive: true }, select: { stockQty: true, reorderLevel: true, sellingPrice: true, mrp: true, expiryDate: true, name: true, category: true } }),
      this.prisma.pharmacyOrder.count({ where: { tenantId, status: 'DISPENSED', dispensedAt: { gte: today } } }),
      this.prisma.pharmacyOrder.count({ where: { tenantId, status: 'DISPENSED', dispensedAt: { gte: monthStart } } }),
      this.prisma.pharmacyOrder.count({ where: { tenantId, status: { in: ['PENDING', 'DISPENSING'] } } }),
      this.prisma.invoice.aggregate({ where: { tenantId, invoiceType: 'PHARMACY', paymentStatus: 'PAID', paidAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
    ]);

    const inventoryValue = inventory.reduce((s, i) => s + i.stockQty * Number(i.sellingPrice), 0);
    const lowStockItems = inventory.filter(i => i.stockQty <= i.reorderLevel);
    const lowStockValue = lowStockItems.reduce((s, i) => s + i.stockQty * Number(i.sellingPrice), 0);
    const expiresIn90 = inventory.filter(i => {
      if (!i.expiryDate) return false;
      const diff = (i.expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 90;
    });
    const expiringSoonValue = expiresIn90.reduce((s, i) => s + i.stockQty * Number(i.sellingPrice), 0);

    const categoryMap: Record<string, { count: number; value: number }> = {};
    inventory.forEach(i => {
      const cat = i.category || 'Other';
      if (!categoryMap[cat]) categoryMap[cat] = { count: 0, value: 0 };
      categoryMap[cat].count++;
      categoryMap[cat].value += i.stockQty * Number(i.sellingPrice);
    });

    return {
      inventory: {
        totalItems: inventory.length,
        inventoryValue: Math.round(inventoryValue * 100) / 100,
        lowStockCount: lowStockItems.length,
        lowStockValue: Math.round(lowStockValue * 100) / 100,
        expiringSoonCount: expiresIn90.length,
        expiringSoonValue: Math.round(expiringSoonValue * 100) / 100,
        categoryBreakdown: categoryMap,
      },
      orders: {
        dispensedToday: ordersToday,
        dispensedMTD: ordersMTD,
        pending: pendingOrders,
        revenueMTD: Math.round(Number(pharmacyRevenueMTD._sum.totalAmount || 0) * 100) / 100,
      },
    };
  }
}
