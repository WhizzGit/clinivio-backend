import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  Invoice,
  Patient,
  InvoiceType,
  PaymentStatus,
  TenantEntityManager,
} from '@mediflow/database';

interface LineItem {
  name: string;
  quantity?: number;
  unitPrice: number;
  gstPercent?: number;
  discount?: number;
}

export class CreateInvoiceDto {
  patientId: string;
  appointmentId?: string;
  ipdAdmissionId?: string;
  invoiceType: InvoiceType;
  lineItems: LineItem[];
  discountAmount?: number;
  notes?: string;
  useIGST?: boolean;
}

export class ConfirmPaymentDto {
  paymentMethod: string;
  amount?: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
}

const DEFAULT_GST_RATE = 0;

interface GSTCalculation {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

function calculateGST(lineItems: LineItem[], discountAmount: number, useIGST: boolean): GSTCalculation {
  let subtotal = 0;
  let totalTaxable = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalIGST = 0;

  for (const item of lineItems) {
    const qty = item.quantity ?? 1;
    const basePrice = item.unitPrice * qty;
    const itemDiscount = item.discount ?? 0;
    const taxable = basePrice - itemDiscount;
    const gstRate = item.gstPercent ?? DEFAULT_GST_RATE;

    subtotal += basePrice;

    if (useIGST) {
      totalIGST += (taxable * gstRate) / 100;
    } else {
      totalCGST += (taxable * gstRate) / 2 / 100;
      totalSGST += (taxable * gstRate) / 2 / 100;
    }

    totalTaxable += taxable;
  }

  totalTaxable = Math.max(0, totalTaxable - discountAmount);
  const totalAmount = totalTaxable + totalCGST + totalSGST + totalIGST;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxableAmount: Math.round(totalTaxable * 100) / 100,
    cgstAmount: Math.round(totalCGST * 100) / 100,
    sgstAmount: Math.round(totalSGST * 100) / 100,
    igstAmount: Math.round(totalIGST * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
  };
}

@Injectable()
export class InvoicesService {
  constructor(private readonly db: TenantEntityManager) {}

  private async generateInvoiceNumber(tenantId: string, type: InvoiceType): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.db.repo(Invoice).count({ where: { tenantId, invoiceType: type } });
    const prefix = type.slice(0, 3).toUpperCase();
    return `INV-${prefix}-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  async create(tenantId: string, dto: CreateInvoiceDto) {
    const patient = await this.db.repo(Patient).findOne({ where: { id: dto.patientId, tenantId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const gst = calculateGST(dto.lineItems, dto.discountAmount ?? 0, dto.useIGST ?? false);
    const invoiceNumber = await this.generateInvoiceNumber(tenantId, dto.invoiceType);

    const invoice = await this.db.repo(Invoice).save(
      this.db.repo(Invoice).create({
        tenantId,
        patientId: dto.patientId,
        appointmentId: dto.appointmentId ?? null,
        ipdAdmissionId: dto.ipdAdmissionId ?? null,
        invoiceNumber,
        invoiceDate: new Date().toISOString().split('T')[0],
        invoiceType: dto.invoiceType,
        lineItems: dto.lineItems,
        subtotal: String(gst.subtotal),
        discountAmount: String(gst.discountAmount),
        taxableAmount: String(gst.taxableAmount),
        cgstAmount: String(gst.cgstAmount),
        sgstAmount: String(gst.sgstAmount),
        igstAmount: String(gst.igstAmount),
        totalAmount: String(gst.totalAmount),
        paymentStatus: PaymentStatus.PENDING,
        notes: dto.notes ?? null,
      }),
    );

    return this.db.repo(Invoice).findOne({ where: { id: invoice.id }, relations: ['patient'] });
  }

  async findAll(
    tenantId: string,
    filters: { patientId?: string; invoiceType?: InvoiceType; paymentStatus?: PaymentStatus; from?: string; to?: string },
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;

    const qb = this.db.qb(Invoice, 'inv').leftJoinAndSelect('inv.patient', 'patient').where('inv.tenantId = :tenantId', { tenantId });

    if (filters.patientId) qb.andWhere('inv.patientId = :patientId', { patientId: filters.patientId });
    if (filters.invoiceType) qb.andWhere('inv.invoiceType = :invoiceType', { invoiceType: filters.invoiceType });
    if (filters.paymentStatus) qb.andWhere('inv.paymentStatus = :paymentStatus', { paymentStatus: filters.paymentStatus });
    if (filters.from) qb.andWhere('inv.createdAt >= :from', { from: new Date(filters.from) });
    if (filters.to) qb.andWhere('inv.createdAt <= :to', { to: new Date(filters.to) });

    qb.orderBy('inv.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string, tenantId: string) {
    const invoice = await this.db.repo(Invoice).findOne({ where: { id, tenantId }, relations: ['patient'] });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async confirmPayment(id: string, tenantId: string, dto: ConfirmPaymentDto) {
    const invoice = await this.findById(id, tenantId);
    if (invoice.paymentStatus === PaymentStatus.PAID) throw new BadRequestException('Invoice already paid');
    if (invoice.paymentStatus === PaymentStatus.REFUNDED) throw new BadRequestException('Cannot pay a refunded invoice');

    const updateData: Partial<Invoice> = {
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: dto.paymentMethod,
      razorpayOrderId: dto.razorpayOrderId ?? null,
      razorpayPaymentId: dto.razorpayPaymentId ?? null,
      paidAt: new Date(),
    };
    if (dto.amount !== undefined) {
      updateData.totalAmount = String(dto.amount);
      updateData.subtotal = String(dto.amount);
      updateData.taxableAmount = String(dto.amount);
    }
    await this.db.repo(Invoice).update(id, updateData);

    return this.findById(id, tenantId);
  }

  async refund(id: string, tenantId: string) {
    const invoice = await this.findById(id, tenantId);
    if (invoice.paymentStatus !== PaymentStatus.PAID) throw new BadRequestException('Only paid invoices can be refunded');
    await this.db.repo(Invoice).update(id, { paymentStatus: PaymentStatus.REFUNDED });
    return this.findById(id, tenantId);
  }

  async getPatientInvoices(patientId: string, tenantId: string) {
    return this.db.repo(Invoice).find({ where: { patientId, tenantId }, order: { createdAt: 'DESC' } });
  }

  async getInvoicesByAppointment(appointmentId: string, tenantId: string) {
    return this.db.repo(Invoice).find({ where: { appointmentId, tenantId }, order: { createdAt: 'DESC' } });
  }

  async getInvoicesByAdmission(ipdAdmissionId: string, tenantId: string) {
    return this.db.repo(Invoice).find({ where: { ipdAdmissionId, tenantId }, order: { createdAt: 'DESC' } });
  }
}
