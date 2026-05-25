import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@mediflow/database';
import { KAFKA_TOPICS } from '@mediflow/shared';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ConfigService } from '@nestjs/config';

interface GstBreakdown {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  totalAmount: number;
  isInterState: boolean;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly cgstRate: number;
  private readonly sgstRate: number;
  private readonly igstRate: number;

  constructor(
    private prisma: PrismaService,
    private kafka: KafkaProducerService,
    private configService: ConfigService,
  ) {
    this.cgstRate = this.configService.get<number>('gst.cgstRate') || 0.09;
    this.sgstRate = this.configService.get<number>('gst.sgstRate') || 0.09;
    this.igstRate = this.configService.get<number>('gst.igstRate') || 0.18;
  }

  private calculateGst(subtotal: number, patientState?: string, hospitalState?: string): GstBreakdown {
    const isInterState = !!patientState && !!hospitalState && patientState !== hospitalState;
    const taxableAmount = Math.round(subtotal * 100) / 100;

    if (isInterState) {
      const igst = Math.round(taxableAmount * this.igstRate * 100) / 100;
      return { taxableAmount, cgst: 0, sgst: 0, igst, totalGst: igst, totalAmount: taxableAmount + igst, isInterState };
    }

    const cgst = Math.round(taxableAmount * this.cgstRate * 100) / 100;
    const sgst = Math.round(taxableAmount * this.sgstRate * 100) / 100;
    const totalGst = cgst + sgst;
    return { taxableAmount, cgst, sgst, igst: 0, totalGst, totalAmount: taxableAmount + totalGst, isInterState };
  }

  private async generateInvoiceNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.invoice.count({ where: { tenantId } });
    const seq = String(count + 1).padStart(6, '0');
    return `INV-${yyyymm}-${seq}`;
  }

  async create(tenantId: string, dto: CreateInvoiceDto) {
    const patient = await this.prisma.patient.findFirst({ where: { id: dto.patientId, tenantId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const subtotal = dto.lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const discountAmount = dto.discountAmount || 0;
    const taxableSubtotal = subtotal - discountAmount;

    if (taxableSubtotal < 0) throw new BadRequestException('Discount cannot exceed subtotal');

    const gst = this.calculateGst(taxableSubtotal, dto.patientStateCode, dto.hospitalStateCode);
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);

    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId,
        patientId: dto.patientId,
        appointmentId: dto.appointmentId,
        invoiceNumber,
        invoiceType: dto.invoiceType as any,
        lineItems: dto.lineItems as any,
        subtotal,
        discountAmount,
        taxableAmount: gst.taxableAmount,
        cgstAmount: gst.cgst,      // correct field name per schema
        sgstAmount: gst.sgst,
        igstAmount: gst.igst,
        totalAmount: gst.totalAmount,
        paymentStatus: 'PENDING',
        notes: dto.notes,
      },
    });

    await this.kafka.emit(KAFKA_TOPICS.PAYMENT_CAPTURED, {
      event: 'invoice.created',
      timestamp: new Date().toISOString(),
      data: { invoiceId: invoice.id, tenantId, patientId: dto.patientId, amount: gst.totalAmount },
    });

    return invoice;
  }

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { patient: { select: { firstName: true, lastName: true, uhid: true } } },
      }),
      this.prisma.invoice.count({ where: { tenantId } }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async findByPatient(patientId: string, tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { patientId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markPaid(id: string, tenantId: string, paymentId: string, paymentMethod?: string) {
    const invoice = await this.findOne(id, tenantId);
    if (invoice.paymentStatus === 'PAID') throw new BadRequestException('Invoice already paid');
    return this.prisma.invoice.update({
      where: { id },
      data: {
        paymentStatus: 'PAID',
        razorpayPaymentId: paymentId,
        paymentMethod: paymentMethod || 'RAZORPAY',
        paidAt: new Date(),
      },
    });
  }

  async getRevenueSummary(tenantId: string, from: Date, to: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, paymentStatus: 'PAID', paidAt: { gte: from, lte: to } },
    });

    const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const totalGst = invoices.reduce(
      (sum, inv) => sum + Number(inv.cgstAmount) + Number(inv.sgstAmount) + Number(inv.igstAmount),
      0,
    );

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      totalInvoices: invoices.length,
      byType: invoices.reduce((acc: Record<string, number>, inv) => {
        acc[inv.invoiceType] = (acc[inv.invoiceType] || 0) + Number(inv.totalAmount);
        return acc;
      }, {}),
    };
  }
}
