import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, OneToMany, JoinColumn, Unique, Index,
} from 'typeorm';
import { LabOrderStatus, LabResultFlag } from './enums';
import { Tenant } from './tenant.entity';
import { Patient } from './patient.entity';
import { User } from './user.entity';

// ─── Lab Test Catalog ─────────────────────────────────────────────────────────

@Entity('lab_tests')
@Unique('tenant_lab_test_code_unique', ['tenantId', 'code'])
@Index(['tenantId'])
export class LabTest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  name: string;

  @Column()
  code: string;

  @Column()
  category: string;

  @Column({ nullable: true })
  unit: string | null;

  @Column({ name: 'normal_range', nullable: true })
  normalRange: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: string;

  @Column({ name: 'turnaround_hours', type: 'int', default: 24 })
  turnaround: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @OneToMany('LabOrderItem', 'labTest', { eager: false })
  orderItems: any[];
}

// ─── Lab Order ────────────────────────────────────────────────────────────────

@Entity('lab_orders')
@Unique('tenant_lab_order_number_unique', ['tenantId', 'orderNumber'])
@Index(['tenantId'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'patientId'])
export class LabOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'order_number' })
  orderNumber: string;

  @Column({ name: 'patient_id' })
  patientId: string;

  @Column({ name: 'appointment_id', nullable: true })
  appointmentId: string | null;

  @Column({ name: 'ordered_by_id' })
  orderedById: string;

  @Column({ name: 'assigned_to_id', nullable: true })
  assignedToId: string | null;

  @Column({ type: 'enum', enum: LabOrderStatus, default: LabOrderStatus.PENDING })
  status: LabOrderStatus;

  @Column({ default: 'ROUTINE' })
  priority: string;

  @Column({ name: 'clinical_notes', nullable: true, type: 'text' })
  clinicalNotes: string | null;

  @Column({ name: 'sample_type', nullable: true })
  sampleType: string | null;

  @Column({ name: 'collected_at', type: 'timestamptz', nullable: true })
  collectedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ordered_by_id' })
  orderedBy: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo: User | null;

  @ManyToOne('Appointment', 'labOrders', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'appointment_id' })
  appointment: any;

  @OneToMany('LabOrderItem', 'labOrder', { cascade: true, eager: false })
  items: any[];
}

// ─── Lab Order Item ───────────────────────────────────────────────────────────

@Entity('lab_order_items')
export class LabOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lab_order_id' })
  labOrderId: string;

  @Column({ name: 'lab_test_id' })
  labTestId: string;

  @Column({ nullable: true, type: 'text' })
  result: string | null;

  @Column({ nullable: true })
  unit: string | null;

  @Column({ name: 'normal_range', nullable: true })
  normalRange: string | null;

  @Column({ type: 'enum', enum: LabResultFlag, nullable: true })
  flag: LabResultFlag | null;

  @Column({ nullable: true, type: 'text' })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => LabOrder, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lab_order_id' })
  labOrder: LabOrder;

  @ManyToOne(() => LabTest, (t) => t.orderItems, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lab_test_id' })
  labTest: LabTest;
}
