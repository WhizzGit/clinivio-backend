import { KAFKA_TOPICS } from '../constants';
import { KafkaEvent } from '../types/common.types';

// ─── Event Payload Types ──────────────────────────────────────────────────────

export interface PatientRegisteredPayload {
  patientId: string;
  tenantId: string;
  phone: string;
  name: string;
  uhid: string;
  preferredLanguage: string;
}

export interface AppointmentBookedPayload {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  appointmentType: string;
  scheduledAt: string;
  tokenNumber: number;
  paymentStatus: string;
}

export interface AppointmentCompletedPayload {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  completedAt: string;
}

export interface AppointmentCancelledPayload {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  doctorId: string;
  cancelledAt: string;
  reason: string;
}

export interface PaymentCapturedPayload {
  appointmentId: string;
  tenantId: string;
  patientId: string;
  razorpayPaymentId: string;
  amount: number;
}

export interface WhatsAppInboundMessagePayload {
  tenantId: string;
  phone: string;
  messageId: string;
  messageType: 'text' | 'interactive' | 'audio' | 'image';
  text?: string;
  buttonPayload?: string;
  audioId?: string;
}

export interface WhatsAppStatusUpdatePayload {
  tenantId: string;
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  phone: string;
  timestamp: string;
}

export interface NotificationQueuePayload {
  tenantId: string;
  patientId: string;
  phone: string;
  channel: 'WHATSAPP' | 'SMS';
  templateId: string;
  variables: Record<string, string>;
  scheduledAt?: string;
}

// ─── Typed Kafka Event Aliases ────────────────────────────────────────────────

export type PatientRegisteredEvent = KafkaEvent<PatientRegisteredPayload>;
export type AppointmentBookedEvent = KafkaEvent<AppointmentBookedPayload>;
export type AppointmentCompletedEvent = KafkaEvent<AppointmentCompletedPayload>;
export type AppointmentCancelledEvent = KafkaEvent<AppointmentCancelledPayload>;
export type PaymentCapturedEvent = KafkaEvent<PaymentCapturedPayload>;
export type WhatsAppInboundMessageEvent =
  KafkaEvent<WhatsAppInboundMessagePayload>;
export type WhatsAppStatusUpdateEvent = KafkaEvent<WhatsAppStatusUpdatePayload>;
export type NotificationQueueEvent = KafkaEvent<NotificationQueuePayload>;

// ─── Factory helpers ──────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';

export function createKafkaEvent<T>(
  eventType: KAFKA_TOPICS,
  tenantId: string,
  data: T,
): KafkaEvent<T> {
  return {
    eventId: uuidv4(),
    eventType,
    tenantId,
    timestamp: new Date().toISOString(),
    data,
  };
}
