import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';

const ORDER_INCLUDE = {
  appointment: {
    select: {
      id: true,
      tokenNumber: true,
      patient: { select: { id: true, firstName: true, lastName: true, uhid: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
      department: { select: { name: true, icon: true } },
      consultation: {
        select: {
          prescriptions: {
            take: 1,
            orderBy: { createdAt: 'desc' as const },
            select: {
              id: true,
              items: {
                select: {
                  medicineName: true, genericName: true, dosage: true,
                  frequency: true, duration: true, instructions: true, quantity: true,
                },
              },
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class PharmacyService {
  constructor(private prisma: PrismaService) {}

  // ── Orders ────────────────────────────────────────────────────────────────
  async findAll(tenantId: string, status?: string) {
    return this.prisma.pharmacyOrder.findMany({
      where: { tenantId, ...(status ? { status: status as any } : {}) },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const order = await this.prisma.pharmacyOrder.findFirst({
      where: { id, tenantId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Pharmacy order not found');
    return order;
  }

  async updateStatus(id: string, tenantId: string, status: string) {
    const order = await this.findOne(id, tenantId);
    const transitions: Record<string, string[]> = {
      PENDING: ['DISPENSING', 'RETURNED'],
      DISPENSING: ['DISPENSED', 'RETURNED'],
      DISPENSED: [],
      RETURNED: [],
    };
    const allowed = transitions[order.status] || [];
    if (!allowed.includes(status)) throw new BadRequestException(`Cannot transition from ${order.status} to ${status}`);
    return this.prisma.pharmacyOrder.update({
      where: { id },
      data: { status: status as any, dispensedAt: status === 'DISPENSED' ? new Date() : undefined },
      include: ORDER_INCLUDE,
    });
  }

  // ── Pharmacy Settings ────────────────────────────────────────────────────
  async getSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        pharmacyName: true, drugLicenseNo: true, gstin: true,
        registrationNo: true, address: true, city: true, state: true,
        pincode: true, phone: true, email: true, printHeader: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateSettings(tenantId: string, dto: any) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.pharmacyName !== undefined && { pharmacyName: dto.pharmacyName }),
        ...(dto.drugLicenseNo !== undefined && { drugLicenseNo: dto.drugLicenseNo }),
        ...(dto.gstin !== undefined && { gstin: dto.gstin }),
        ...(dto.registrationNo !== undefined && { registrationNo: dto.registrationNo }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.state !== undefined && { state: dto.state }),
        ...(dto.pincode !== undefined && { pincode: dto.pincode }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.printHeader !== undefined && { printHeader: dto.printHeader }),
      },
      select: {
        pharmacyName: true, drugLicenseNo: true, gstin: true,
        registrationNo: true, address: true, city: true, state: true,
        pincode: true, phone: true, email: true, printHeader: true,
      },
    });
  }

  // ── Inventory ─────────────────────────────────────────────────────────────
  async listInventory(tenantId: string, q?: string, lowStock?: boolean) {
    const where: any = { tenantId, isActive: true };
    if (q) where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { genericName: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
    ];
    const items = await this.prisma.pharmacyInventory.findMany({ where, orderBy: { name: 'asc' } });
    if (lowStock) return items.filter(i => i.stockQty <= i.reorderLevel);
    return items;
  }

  async addInventory(tenantId: string, dto: any) {
    return this.prisma.pharmacyInventory.create({
      data: {
        tenantId,
        name: dto.name,
        genericName: dto.genericName,
        category: dto.category,
        unit: dto.unit ?? 'Tablet',
        stockQty: Number(dto.stockQty ?? 0),
        reorderLevel: Number(dto.reorderLevel ?? 10),
        batchNo: dto.batchNo,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        mrp: dto.mrp ? Number(dto.mrp) : 0,
        sellingPrice: dto.sellingPrice ? Number(dto.sellingPrice) : 0,
        manufacturer: dto.manufacturer,
        hsn: dto.hsn,
      },
    });
  }

  async updateInventory(id: string, tenantId: string, dto: any) {
    await this.prisma.pharmacyInventory.findFirstOrThrow({ where: { id, tenantId } });
    return this.prisma.pharmacyInventory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.genericName !== undefined && { genericName: dto.genericName }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.reorderLevel !== undefined && { reorderLevel: Number(dto.reorderLevel) }),
        ...(dto.batchNo !== undefined && { batchNo: dto.batchNo }),
        ...(dto.expiryDate !== undefined && { expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null }),
        ...(dto.mrp !== undefined && { mrp: Number(dto.mrp) }),
        ...(dto.sellingPrice !== undefined && { sellingPrice: Number(dto.sellingPrice) }),
        ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
        ...(dto.hsn !== undefined && { hsn: dto.hsn }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async adjustStock(id: string, tenantId: string, qty: number) {
    const item = await this.prisma.pharmacyInventory.findFirstOrThrow({ where: { id, tenantId } });
    const newQty = item.stockQty + Number(qty);
    if (newQty < 0) throw new BadRequestException('Stock cannot go below zero');
    return this.prisma.pharmacyInventory.update({ where: { id }, data: { stockQty: newQty } });
  }

  async removeInventory(id: string, tenantId: string) {
    await this.prisma.pharmacyInventory.findFirstOrThrow({ where: { id, tenantId } });
    return this.prisma.pharmacyInventory.update({ where: { id }, data: { isActive: false } });
  }
}
