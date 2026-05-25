import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppInboundMessageEvent } from '@mediflow/shared';
import { SessionService } from '../session/session.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RegistrationFlowService } from '../flows/registration.flow';
import { BookingFlowService } from '../flows/booking.flow';

const EMERGENCY_KEYWORDS = [
  'emergency', 'urgent', 'ambulance', 'critical', 'help',
  'आपातकाल', 'तत्काल', 'जरूरी',
  'அவசரம்', 'உதவி',
  'అత్యవసర', 'సహాయం',
  'ತುರ್ತು', 'ಸಹಾಯ',
  'জরুরি', 'সাহায্য',
];

@Injectable()
export class FsmService {
  private readonly logger = new Logger(FsmService.name);

  constructor(
    private sessionService: SessionService,
    private whatsappService: WhatsappService,
    private registrationFlow: RegistrationFlowService,
    private bookingFlow: BookingFlowService,
  ) {}

  async processMessage(event: WhatsAppInboundMessageEvent): Promise<void> {
    const phone = event.data.phone;
    const rawInput = event.data.text || event.data.buttonPayload || '';
    const input = rawInput.trim();

    if (!phone || !input) return;

    const isEmergency = EMERGENCY_KEYWORDS.some((kw) =>
      input.toLowerCase().includes(kw.toLowerCase()),
    );

    if (isEmergency) {
      await this.whatsappService.sendText(
        phone,
        '🚨 EMERGENCY ALERT\n\nPlease call 108 (Ambulance) or 112 (Emergency Services) immediately.\n\nFor hospital emergencies, please visit the Emergency Department directly.',
      );
      return;
    }

    const session = await this.sessionService.getSession(phone);

    await this.sessionService.addToHistory(phone, 'user', input);

    try {
      await this.route(session.fsmState, input, session, event);
    } catch (err: any) {
      this.logger.error(`FSM error for ${phone} [state=${session.fsmState}]: ${err.message}`, err.stack);
      await this.whatsappService.sendText(
        phone,
        'Sorry, something went wrong. Please type "hi" to start over.',
      );
    }
  }

  private async route(
    state: string,
    input: string,
    session: any,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;

    // Reset command
    if (input.toLowerCase() === 'reset' || input.toLowerCase() === 'restart') {
      await this.sessionService.clearSession(phone);
      await this.whatsappService.sendText(phone, 'Session reset. Type "hi" to start again.');
      return;
    }

    switch (state) {
      case 'IDLE':
      case 'LANGUAGE_SELECTION':
        await this.registrationFlow.handleLanguageSelection(session, input, event);
        break;

      case 'REGISTRATION_NAME':
        await this.registrationFlow.handleName(session, input, event);
        break;

      case 'REGISTRATION_DOB':
        await this.registrationFlow.handleDob(session, input, event);
        break;

      case 'REGISTRATION_GENDER':
        await this.registrationFlow.handleGender(session, input, event);
        break;

      case 'REGISTRATION_ABHA':
        await this.registrationFlow.handleAbha(session, input, event);
        break;

      case 'REGISTRATION_CONSENT':
        await this.registrationFlow.handleConsent(session, input, event);
        break;

      case 'REGISTRATION_OTP':
        await this.registrationFlow.handleOtp(session, input, event);
        break;

      case 'MAIN_MENU':
        await this.handleMainMenu(phone, input, session, event);
        break;

      case 'BOOKING_SPECIALTY':
        await this.bookingFlow.handleSpecialty(session, input, event);
        break;

      case 'BOOKING_DOCTOR':
        await this.bookingFlow.handleDoctor(session, input, event);
        break;

      case 'BOOKING_DATE':
        await this.bookingFlow.handleDate(session, input, event);
        break;

      case 'BOOKING_SLOT':
        await this.bookingFlow.handleSlot(session, input, event);
        break;

      case 'BOOKING_TYPE':
        await this.bookingFlow.handleType(session, input, event);
        break;

      case 'BOOKING_COMPLAINT':
        await this.bookingFlow.handleComplaint(session, input, event);
        break;

      case 'BOOKING_PAYMENT':
      case 'BOOKING_CONFIRM':
        await this.bookingFlow.handlePayment(session, input, event);
        break;

      default:
        this.logger.warn(`Unknown FSM state: ${state} for ${phone}`);
        await this.sessionService.clearSession(phone);
        await this.registrationFlow.handleLanguageSelection(session, input, event);
    }
  }

  private async handleMainMenu(
    phone: string,
    input: string,
    session: any,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    switch (input) {
      case 'BOOK_APPOINTMENT':
        await this.sessionService.updateFsmState(phone, 'BOOKING_SPECIALTY');
        await this.bookingFlow.sendSpecialtyMenu(phone);
        break;

      case 'MY_APPOINTMENTS':
        await this.bookingFlow.sendAppointments(phone, session);
        break;

      case 'HELP':
        await this.whatsappService.sendText(
          phone,
          'MediFlow Help 🏥\n\n📅 Book Appointment: Choose specialty, doctor, date & time\n📋 My Appointments: View your upcoming visits\n🚨 Emergency: Call 108 or 112\n\nType "reset" to start over.',
        );
        await this.sendMainMenuButtons(phone);
        break;

      default:
        await this.sendMainMenuButtons(phone);
    }
  }

  private async sendMainMenuButtons(phone: string): Promise<void> {
    await this.whatsappService.sendButtons(phone, 'How can I help you today? 🏥', [
      { id: 'BOOK_APPOINTMENT', title: '📅 Book Appointment' },
      { id: 'MY_APPOINTMENTS', title: '📋 My Appointments' },
      { id: 'HELP', title: '❓ Help' },
    ]);
  }
}
