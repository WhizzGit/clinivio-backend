import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsAppSession, WhatsAppInboundMessageEvent } from '@mediflow/shared';
import { SessionService } from '../session/session.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { format, addDays, parseISO } from 'date-fns';

const SPECIALTY_MAP: Record<string, string> = {
  SPEC_GENERAL: 'General Medicine',
  SPEC_CARDIOLOGY: 'Cardiology',
  SPEC_ORTHOPEDICS: 'Orthopedics',
  SPEC_DERMATOLOGY: 'Dermatology',
  SPEC_GYNECOLOGY: 'Gynecology',
  SPEC_PEDIATRICS: 'Pediatrics',
  SPEC_ENT: 'ENT',
  SPEC_OPHTHALMOLOGY: 'Ophthalmology',
};

const APPOINTMENT_TYPE_MAP: Record<string, string> = {
  TYPE_INPERSON: 'IN_PERSON',
  TYPE_VIDEO: 'VIDEO',
  TYPE_FOLLOWUP: 'FOLLOW_UP',
};

const APPOINTMENT_TYPE_LABEL: Record<string, string> = {
  IN_PERSON: 'In-Person',
  VIDEO: 'Video',
  FOLLOW_UP: 'Follow-up',
};

@Injectable()
export class BookingFlowService {
  private readonly logger = new Logger(BookingFlowService.name);
  private readonly appointmentServiceUrl: string;

  constructor(
    private sessionService: SessionService,
    private whatsappService: WhatsappService,
    private configService: ConfigService,
  ) {
    this.appointmentServiceUrl =
      this.configService.get<string>('services.appointmentServiceUrl') ||
      'http://appointment-service:3000';
  }

  async sendSpecialtyMenu(phone: string): Promise<void> {
    await this.whatsappService.sendList(
      phone,
      'Please select a medical specialty for your appointment:',
      'View Specialties',
      [
        {
          title: 'Medical Specialties',
          rows: [
            {
              id: 'SPEC_GENERAL',
              title: 'General Medicine',
              description: 'Fever, cold, general checkup',
            },
            {
              id: 'SPEC_CARDIOLOGY',
              title: 'Cardiology',
              description: 'Heart & blood pressure',
            },
            {
              id: 'SPEC_ORTHOPEDICS',
              title: 'Orthopedics',
              description: 'Bones, joints & muscles',
            },
            {
              id: 'SPEC_DERMATOLOGY',
              title: 'Dermatology',
              description: 'Skin, hair & nails',
            },
            {
              id: 'SPEC_GYNECOLOGY',
              title: 'Gynecology',
              description: "Women's health",
            },
            {
              id: 'SPEC_PEDIATRICS',
              title: 'Pediatrics',
              description: "Children's health",
            },
            {
              id: 'SPEC_ENT',
              title: 'ENT',
              description: 'Ear, nose & throat',
            },
            {
              id: 'SPEC_OPHTHALMOLOGY',
              title: 'Ophthalmology',
              description: 'Eye care',
            },
          ],
        },
      ],
    );
  }

  async handleSpecialty(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const specialtyName = SPECIALTY_MAP[input];

    if (!specialtyName) {
      await this.whatsappService.sendText(
        phone,
        'Please select a specialty from the list.',
      );
      await this.sendSpecialtyMenu(phone);
      return;
    }

    await this.sessionService.updateFsmState(phone, 'BOOKING_DOCTOR', {
      specialty: specialtyName,
    });

    // Fetch available doctors
    try {
      const tenantId = session.tenantId || 'default';
      const response = await axios.get(
        `${this.appointmentServiceUrl}/slots/doctors`,
        {
          params: { specialty: specialtyName, tenantId },
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 8000,
        },
      );
      const doctors: any[] = response.data?.data || response.data || [];

      if (!doctors || doctors.length === 0) {
        await this.whatsappService.sendText(
          phone,
          `No doctors available for ${specialtyName}. Please try another specialty.`,
        );
        await this.sessionService.updateFsmState(phone, 'BOOKING_SPECIALTY');
        await this.sendSpecialtyMenu(phone);
        return;
      }

      const top3 = doctors.slice(0, 3);

      if (top3.length <= 3) {
        await this.whatsappService.sendButtons(
          phone,
          `Available doctors for ${specialtyName}:\nSelect a doctor to continue:`,
          top3.map((doc) => ({
            id: `DOCTOR_${doc.id}`,
            title: `Dr. ${doc.firstName} ${doc.lastName}`,
          })),
        );
      } else {
        await this.whatsappService.sendList(
          phone,
          `Available doctors for ${specialtyName}:`,
          'Select Doctor',
          [
            {
              title: `${specialtyName} Doctors`,
              rows: top3.map((doc) => ({
                id: `DOCTOR_${doc.id}`,
                title: `Dr. ${doc.firstName} ${doc.lastName}`,
                description: doc.qualification || doc.experience || '',
              })),
            },
          ],
        );
      }
    } catch (err: any) {
      this.logger.error(`Failed to fetch doctors for ${specialtyName}: ${err.message}`);
      await this.whatsappService.sendText(
        phone,
        'Unable to fetch available doctors at this time. Please try again.',
      );
    }
  }

  async handleDoctor(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;

    if (!input.startsWith('DOCTOR_')) {
      await this.whatsappService.sendText(
        phone,
        'Please select a doctor from the list.',
      );
      return;
    }

    const doctorId = input.replace('DOCTOR_', '');
    const ctx = session.fsmContext as any;

    // Try to get doctor name from context or fetch
    let doctorName = ctx.doctorName || '';
    try {
      const response = await axios.get(
        `${this.appointmentServiceUrl}/slots/doctors/${doctorId}`,
        {
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 5000,
        },
      );
      const doc = response.data?.data || response.data;
      if (doc) {
        doctorName = `${doc.firstName} ${doc.lastName}`;
      }
    } catch {
      // Non-critical — continue without name
      this.logger.warn(`Could not fetch doctor details for ${doctorId}`);
    }

    await this.sessionService.updateFsmState(phone, 'BOOKING_DATE', {
      doctorId,
      doctorName,
    });

    // Show next 7 days
    const rows: Array<{ id: string; title: string }> = [];
    const today = new Date();
    for (let i = 1; i <= 7; i++) {
      const date = addDays(today, i);
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayName = format(date, 'EEEE');
      const display = format(date, 'dd MMM');
      rows.push({
        id: `DATE_${dateStr}`,
        title: `${dayName}, ${display}`,
      });
    }

    await this.whatsappService.sendList(
      phone,
      `Select a date for your appointment with${doctorName ? ' Dr. ' + doctorName : ' the doctor'}:`,
      'Pick a Date',
      [
        {
          title: 'Available Dates (Next 7 Days)',
          rows,
        },
      ],
    );
  }

  async handleDate(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;

    if (!input.startsWith('DATE_')) {
      await this.whatsappService.sendText(
        phone,
        'Please select a date from the list.',
      );
      return;
    }

    const selectedDate = input.replace('DATE_', '');
    const ctx = session.fsmContext as any;

    await this.sessionService.updateFsmState(phone, 'BOOKING_SLOT', {
      selectedDate,
    });

    // Fetch available slots
    try {
      const response = await axios.get(
        `${this.appointmentServiceUrl}/slots/available`,
        {
          params: { doctorId: ctx.doctorId, date: selectedDate },
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 8000,
        },
      );
      const slots: any[] = response.data?.data || response.data || [];

      if (!slots || slots.length === 0) {
        await this.whatsappService.sendText(
          phone,
          `No available slots on ${this.formatDate(selectedDate)}. Please choose another date.`,
        );
        // Go back to date selection
        await this.sessionService.updateFsmState(phone, 'BOOKING_DATE');
        const rows: Array<{ id: string; title: string }> = [];
        const today = new Date();
        for (let i = 1; i <= 7; i++) {
          const date = addDays(today, i);
          const dateStr = format(date, 'yyyy-MM-dd');
          const dayName = format(date, 'EEEE');
          const display = format(date, 'dd MMM');
          rows.push({ id: `DATE_${dateStr}`, title: `${dayName}, ${display}` });
        }
        await this.whatsappService.sendList(
          phone,
          'Select another date:',
          'Pick a Date',
          [{ title: 'Available Dates (Next 7 Days)', rows }],
        );
        return;
      }

      const top = slots.slice(0, 3);

      if (top.length <= 3) {
        await this.whatsappService.sendButtons(
          phone,
          `Available slots on ${this.formatDate(selectedDate)}:`,
          top.map((slot) => ({
            id: `SLOT_${slot.id}`,
            title: `${this.formatTime(slot.startTime)} (${slot.availableCount || 1} slot${(slot.availableCount || 1) > 1 ? 's' : ''} left)`,
          })),
        );
      } else {
        await this.whatsappService.sendList(
          phone,
          `Available slots on ${this.formatDate(selectedDate)}:`,
          'Pick a Slot',
          [
            {
              title: 'Time Slots',
              rows: top.map((slot) => ({
                id: `SLOT_${slot.id}`,
                title: `${this.formatTime(slot.startTime)}`,
                description: `${slot.availableCount || 1} slot${(slot.availableCount || 1) > 1 ? 's' : ''} available`,
              })),
            },
          ],
        );
      }
    } catch (err: any) {
      this.logger.error(`Failed to fetch slots for date ${selectedDate}: ${err.message}`);
      await this.whatsappService.sendText(
        phone,
        'Unable to fetch available slots at this time. Please try again.',
      );
    }
  }

  async handleSlot(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;

    if (!input.startsWith('SLOT_')) {
      await this.whatsappService.sendText(
        phone,
        'Please select a time slot from the list.',
      );
      return;
    }

    const slotId = input.replace('SLOT_', '');
    const ctx = session.fsmContext as any;

    // Try to get slot time from service
    let slotTime = ctx.slotTime || '';
    try {
      const response = await axios.get(
        `${this.appointmentServiceUrl}/slots/${slotId}`,
        {
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 5000,
        },
      );
      const slot = response.data?.data || response.data;
      if (slot && slot.startTime) {
        slotTime = this.formatTime(slot.startTime);
      }
    } catch {
      this.logger.warn(`Could not fetch slot details for ${slotId}`);
    }

    await this.sessionService.updateFsmState(phone, 'BOOKING_TYPE', {
      slotId,
      slotTime,
    });

    await this.whatsappService.sendButtons(
      phone,
      'What type of appointment would you like?',
      [
        { id: 'TYPE_INPERSON', title: '🏥 In-Person' },
        { id: 'TYPE_VIDEO', title: '💻 Video' },
        { id: 'TYPE_FOLLOWUP', title: '🔄 Follow-up' },
      ],
    );
  }

  async handleType(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const appointmentType = APPOINTMENT_TYPE_MAP[input];

    if (!appointmentType) {
      await this.whatsappService.sendButtons(
        phone,
        'Please select the type of appointment:',
        [
          { id: 'TYPE_INPERSON', title: '🏥 In-Person' },
          { id: 'TYPE_VIDEO', title: '💻 Video' },
          { id: 'TYPE_FOLLOWUP', title: '🔄 Follow-up' },
        ],
      );
      return;
    }

    await this.sessionService.updateFsmState(phone, 'BOOKING_COMPLAINT', {
      appointmentType,
    });

    await this.whatsappService.sendText(
      phone,
      'Briefly describe your reason for visit (optional):',
    );
    await this.whatsappService.sendButtons(
      phone,
      'Or skip this step:',
      [{ id: 'SKIP_COMPLAINT', title: '⏭ Skip' }],
    );
  }

  async handleComplaint(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const ctx = session.fsmContext as any;
    const chiefComplaint =
      input === 'SKIP_COMPLAINT' ? 'Not specified' : input.trim() || 'Not specified';

    await this.sessionService.updateFsmState(phone, 'BOOKING_PAYMENT', {
      chiefComplaint,
    });

    const doctorName = ctx.doctorName || 'Doctor';
    const selectedDate = ctx.selectedDate || '';
    const slotTime = ctx.slotTime || '';
    const typeLabel = APPOINTMENT_TYPE_LABEL[ctx.appointmentType] || ctx.appointmentType || '';

    await this.whatsappService.sendText(
      phone,
      `📋 Appointment Summary\n─────────────────\nDoctor: Dr. ${doctorName}\nDate: ${this.formatDate(selectedDate)}\nTime: ${slotTime}\nType: ${typeLabel}\nReason: ${chiefComplaint}\n─────────────────\nConsultation Fee: ₹500`,
    );

    await this.whatsappService.sendButtons(
      phone,
      'How would you like to pay?',
      [
        { id: 'PAY_COUNTER', title: '🏥 Pay at Counter' },
        { id: 'PAY_NOW', title: '💳 Pay Now (₹500)' },
      ],
    );
  }

  async handlePayment(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const ctx = session.fsmContext as any;

    if (input !== 'PAY_COUNTER' && input !== 'PAY_NOW') {
      await this.whatsappService.sendButtons(
        phone,
        'Please select a payment option:',
        [
          { id: 'PAY_COUNTER', title: '🏥 Pay at Counter' },
          { id: 'PAY_NOW', title: '💳 Pay Now (₹500)' },
        ],
      );
      return;
    }

    try {
      const response = await axios.post(
        `${this.appointmentServiceUrl}/appointments`,
        {
          patientId: session.patientId,
          doctorId: ctx.doctorId,
          slotId: ctx.slotId,
          appointmentType: ctx.appointmentType,
          chiefComplaint: ctx.chiefComplaint || 'Not specified',
          payAtCounter: input === 'PAY_COUNTER',
          tenantId: session.tenantId || 'default',
        },
        {
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 10000,
        },
      );

      const appointment = response.data?.data || response.data;
      const tokenNumber = appointment.tokenNumber || appointment.token || 'N/A';
      const appointmentId = appointment.id || appointment.appointmentId || '';

      await this.whatsappService.sendText(
        phone,
        `✅ Appointment Confirmed!\n─────────────────\nToken: #${tokenNumber}\nDoctor: Dr. ${ctx.doctorName || 'Doctor'}\nDate: ${this.formatDate(ctx.selectedDate)} at ${ctx.slotTime}\nAppt ID: ${appointmentId}\n─────────────────\nWe'll remind you 24 hours before your appointment.`,
      );

      await this.sessionService.updateFsmState(phone, 'MAIN_MENU', {});
    } catch (err: any) {
      this.logger.error(`Failed to book appointment for ${phone}: ${err.message}`);
      await this.whatsappService.sendText(
        phone,
        'Sorry, booking failed. Please try again.',
      );
      await this.sessionService.updateFsmState(phone, 'BOOKING_PAYMENT');
    }
  }

  async sendAppointments(phone: string, session: WhatsAppSession): Promise<void> {
    try {
      const response = await axios.get(
        `${this.appointmentServiceUrl}/appointments`,
        {
          params: { patientId: session.patientId, status: 'REGISTERED,CHECKED_IN' },
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 8000,
        },
      );
      const appointments: any[] = response.data?.data || response.data || [];

      if (!appointments.length) {
        await this.whatsappService.sendText(phone, 'You have no upcoming appointments.');
        return;
      }

      const lines = appointments.slice(0, 5).map((a, i) => {
        const date = a.slot?.date ? this.formatDate(a.slot.date) : 'TBD';
        const time = a.slot?.startTime ? this.formatTime(a.slot.startTime) : '';
        const doctor = a.doctor ? `Dr. ${a.doctor.firstName} ${a.doctor.lastName}` : 'Doctor';
        return `${i + 1}. Token #${a.tokenNumber}\n   ${doctor}\n   ${date} at ${time}`;
      });

      await this.whatsappService.sendText(
        phone,
        `📋 Your Appointments\n─────────────────\n${lines.join('\n\n')}\n─────────────────`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to fetch appointments for ${phone}: ${err.message}`);
      await this.whatsappService.sendText(phone, 'Unable to fetch appointments. Please try again.');
    }
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      return format(parseISO(dateStr), 'dd MMM yyyy');
    } catch {
      return dateStr;
    }
  }

  private formatTime(timeStr: string): string {
    if (!timeStr) return '';
    // Handle HH:MM or ISO strings
    try {
      // If it's already a simple time like "10:00" or "10:00:00"
      if (/^\d{2}:\d{2}/.test(timeStr)) {
        const [hour, minute] = timeStr.split(':').map(Number);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
      }
      // ISO string
      const d = new Date(timeStr);
      return format(d, 'hh:mm aa');
    } catch {
      return timeStr;
    }
  }
}
