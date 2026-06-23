import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { PharmacyOrderStatus } from "./enums";
import { Tenant } from "./tenant.entity";
import { Appointment } from "./appointment.entity";
import { Patient } from "./patient.entity";

@Entity("pharmacy_orders")
export class PharmacyOrder {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "tenant_id" })
  tenantId: string;

  @Column({ name: "appointment_id", unique: true })
  appointmentId: string;

  @Column({ name: "patient_id" })
  patientId: string;

  @Column({ name: "prescription_id", nullable: true, unique: true })
  prescriptionId: string | null;

  @Column({
    type: "enum",
    enum: PharmacyOrderStatus,
    default: PharmacyOrderStatus.PENDING,
  })
  status: PharmacyOrderStatus;

  @Column({ name: "dispenser_notes", nullable: true })
  dispenserNotes: string | null;

  @Column({ name: "dispensed_at", type: "timestamptz", nullable: true })
  dispensedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Tenant, {
    onDelete: "CASCADE",
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: "tenant_id" })
  tenant: Tenant;

  @OneToOne(() => Appointment, (a: any) => a.pharmacyOrder, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "appointment_id" })
  appointment: Appointment;

  @ManyToOne(() => Patient, { onDelete: "CASCADE" })
  @JoinColumn({ name: "patient_id" })
  patient: Patient;
}

@Entity("pharmacy_inventory")
export class PharmacyInventory {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "tenant_id" })
  tenantId: string;

  @Column()
  name: string;

  @Column({ name: "generic_name", nullable: true })
  genericName: string | null;

  @Column({ nullable: true })
  category: string | null;

  @Column({ default: "Tablet" })
  unit: string;

  @Column({ name: "stock_qty", type: "int", default: 0 })
  stockQty: number;

  @Column({ name: "reorder_level", type: "int", default: 10 })
  reorderLevel: number;

  @Column({ name: "batch_no", nullable: true })
  batchNo: string | null;

  @Column({ name: "expiry_date", type: "date", nullable: true })
  expiryDate: string | null;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  mrp: string;

  @Column({
    name: "selling_price",
    type: "decimal",
    precision: 10,
    scale: 2,
    default: 0,
  })
  sellingPrice: string;

  @Column({
    name: "gst_rate",
    type: "decimal",
    precision: 5,
    scale: 2,
    nullable: true,
  })
  gstRate: string | null;

  @Column({ nullable: true })
  manufacturer: string | null;

  @Column({ nullable: true })
  hsn: string | null;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Tenant, {
    onDelete: "CASCADE",
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: "tenant_id" })
  tenant: Tenant;
}
