import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsAppSession, WhatsAppInboundMessageEvent } from '@mediflow/shared';
import { SessionService } from '../session/session.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class RegistrationFlowService {
  private readonly logger = new Logger(RegistrationFlowService.name);
  private readonly patientServiceUrl: string;

  constructor(
    private sessionService: SessionService,
    private whatsappService: WhatsappService,
    private configService: ConfigService,
  ) {
    this.patientServiceUrl =
      this.configService.get<string>('services.patientServiceUrl') ||
      'http://patient-service:3000';
  }

  async handleLanguageSelection(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;

    // If IDLE or no valid language selected yet, show language picker
    if (session.fsmState === 'IDLE' || !this.isLanguageInput(input)) {
      await this.sessionService.updateFsmState(phone, 'LANGUAGE_SELECTION');
      await this.whatsappService.sendButtons(
        phone,
        'Welcome to MediFlow 🏥\n\nPlease select your preferred language:\nकृपया अपनी भाषा चुनें:\nதமிழ் தேர்ந்தெடுக்கவும்:',
        [
          { id: 'LANG_EN', title: '🇬🇧 English' },
          { id: 'LANG_HI', title: '🇮🇳 हिन्दी' },
          { id: 'LANG_TA', title: '🇮🇳 தமிழ்' },
        ],
      );
      // Send second set for more languages
      await this.whatsappService.sendButtons(
        phone,
        'More languages / अधिक भाषाएं:',
        [
          { id: 'LANG_TE', title: '🇮🇳 తెలుగు' },
          { id: 'LANG_KN', title: '🇮🇳 ಕನ್ನಡ' },
          { id: 'LANG_BN', title: '🇮🇳 বাংলা' },
        ],
      );
      return;
    }

    // Map language button to language code
    const languageMap: Record<string, string> = {
      LANG_EN: 'EN',
      LANG_HI: 'HI',
      LANG_TA: 'TA',
      LANG_TE: 'TE',
      LANG_KN: 'KN',
      LANG_BN: 'BN',
    };
    const langCode = languageMap[input];

    // Check if patient exists by phone
    try {
      const response = await axios.get(
        `${this.patientServiceUrl}/patients/by-phone/${encodeURIComponent(phone)}`,
        {
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 5000,
        },
      );
      const patient = response.data?.data || response.data;
      if (patient && patient.id) {
        // Existing patient — go to main menu
        const updatedSession = await this.sessionService.updateFsmState(
          phone,
          'MAIN_MENU',
          { patientId: patient.id },
        );
        updatedSession.patientId = patient.id;
        updatedSession.preferredLanguage = langCode;
        await this.sessionService.saveSession(phone, updatedSession);

        await this.whatsappService.sendText(
          phone,
          `Welcome back, ${patient.firstName || patient.name}! 👋\n\nYour Patient ID: ${patient.uhid || patient.id}`,
        );
        await this.sendMainMenuButtons(phone);
        return;
      }
    } catch (err: any) {
      // 404 = not found, proceed to registration. Other errors log and continue.
      if (err?.response?.status !== 404) {
        this.logger.warn(
          `Could not look up patient for ${phone}: ${err.message}`,
        );
      }
    }

    // New patient — start registration
    await this.sessionService.updateFsmState(phone, 'REGISTRATION_NAME', {
      preferredLanguage: langCode,
    });
    const savedSession = await this.sessionService.getSession(phone);
    savedSession.preferredLanguage = langCode;
    await this.sessionService.saveSession(phone, savedSession);

    await this.whatsappService.sendText(
      phone,
      `Great! Let's get you registered. 📝\n\nPlease share your full name:`,
    );
  }

  async handleName(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const trimmed = input.trim();
    const nameRegex = /^[a-zA-Z\s\-']{2,100}$/;

    if (!trimmed || !nameRegex.test(trimmed)) {
      await this.whatsappService.sendText(
        phone,
        'Please share your full name: (letters, spaces, and hyphens only, 2-100 characters)',
      );
      return;
    }

    await this.sessionService.updateFsmState(phone, 'REGISTRATION_DOB', {
      name: trimmed,
    });
    await this.whatsappService.sendText(
      phone,
      `Nice to meet you, ${trimmed}! 😊\n\nYour date of birth? (DD/MM/YYYY)\nExample: 15/01/1990`,
    );
  }

  async handleDob(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const trimmed = input.trim();
    const dobRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = dobRegex.exec(trimmed);

    if (!match) {
      await this.whatsappService.sendText(
        phone,
        'Invalid date. Please use DD/MM/YYYY format (e.g., 15/01/1990)',
      );
      return;
    }

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const dob = new Date(year, month - 1, day);

    // Validate actual date values
    if (
      dob.getFullYear() !== year ||
      dob.getMonth() !== month - 1 ||
      dob.getDate() !== day
    ) {
      await this.whatsappService.sendText(
        phone,
        'Invalid date. Please use DD/MM/YYYY format (e.g., 15/01/1990)',
      );
      return;
    }

    const now = new Date();
    const ageMs = now.getTime() - dob.getTime();
    const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);

    if (ageYears < 0 || ageYears > 120) {
      await this.whatsappService.sendText(
        phone,
        'Please enter a valid date of birth (age must be between 0 and 120 years).',
      );
      return;
    }

    // ISO date string (YYYY-MM-DD)
    const isoDateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    await this.sessionService.updateFsmState(phone, 'REGISTRATION_GENDER', {
      dob: isoDateString,
    });

    await this.whatsappService.sendButtons(
      phone,
      'Please select your gender:',
      [
        { id: 'GENDER_MALE', title: '♂ Male' },
        { id: 'GENDER_FEMALE', title: '♀ Female' },
        { id: 'GENDER_OTHER', title: '⚧ Other' },
      ],
    );
  }

  async handleGender(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const genderMap: Record<string, string> = {
      GENDER_MALE: 'MALE',
      GENDER_FEMALE: 'FEMALE',
      GENDER_OTHER: 'OTHER',
    };

    if (!genderMap[input]) {
      await this.whatsappService.sendButtons(
        phone,
        'Please select your gender:',
        [
          { id: 'GENDER_MALE', title: '♂ Male' },
          { id: 'GENDER_FEMALE', title: '♀ Female' },
          { id: 'GENDER_OTHER', title: '⚧ Other' },
        ],
      );
      return;
    }

    const gender = genderMap[input];
    await this.sessionService.updateFsmState(phone, 'REGISTRATION_ABHA', {
      gender,
    });

    await this.whatsappService.sendButtons(
      phone,
      'Do you have an ABHA (Ayushman Bharat Health Account) number?\n\nHaving ABHA helps link your health records across all hospitals.',
      [
        { id: 'ABHA_YES', title: '✅ Yes, I have ABHA' },
        { id: 'ABHA_NO', title: '⏭ Skip' },
        { id: 'ABHA_INFO', title: 'ℹ What is ABHA?' },
      ],
    );
  }

  async handleAbha(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const ctx = session.fsmContext as any;

    if (input === 'ABHA_INFO') {
      await this.whatsappService.sendText(
        phone,
        'ℹ ABHA (Ayushman Bharat Health Account) is your unique 14-digit health ID issued by the National Health Authority of India.\n\nIt helps store and access your health records digitally across all hospitals and clinics.',
      );
      await this.whatsappService.sendButtons(
        phone,
        'Do you have an ABHA number?',
        [
          { id: 'ABHA_YES', title: '✅ Yes, I have ABHA' },
          { id: 'ABHA_NO', title: '⏭ Skip' },
          { id: 'ABHA_INFO', title: 'ℹ What is ABHA?' },
        ],
      );
      return;
    }

    if (input === 'ABHA_NO') {
      await this.sessionService.updateFsmState(phone, 'REGISTRATION_CONSENT', {
        awaitingAbhaInput: false,
      });
      await this.sendConsentMessage(phone);
      return;
    }

    if (input === 'ABHA_YES') {
      await this.sessionService.updateFsmState(phone, 'REGISTRATION_ABHA', {
        awaitingAbhaInput: true,
      });
      await this.whatsappService.sendText(
        phone,
        'Please type your 14-digit ABHA number:',
      );
      return;
    }

    // Check if awaiting ABHA input from user
    if (ctx.awaitingAbhaInput) {
      const abhaRegex = /^\d{14}$/;
      if (abhaRegex.test(input.trim())) {
        await this.sessionService.updateFsmState(
          phone,
          'REGISTRATION_CONSENT',
          { abhaId: input.trim(), awaitingAbhaInput: false },
        );
        await this.sendConsentMessage(phone);
      } else {
        await this.whatsappService.sendText(
          phone,
          'Please enter a valid 14-digit ABHA number:',
        );
      }
      return;
    }

    // Fallback — show ABHA buttons
    await this.whatsappService.sendButtons(
      phone,
      'Do you have an ABHA number?',
      [
        { id: 'ABHA_YES', title: '✅ Yes, I have ABHA' },
        { id: 'ABHA_NO', title: '⏭ Skip' },
        { id: 'ABHA_INFO', title: 'ℹ What is ABHA?' },
      ],
    );
  }

  async sendConsentMessage(phone: string): Promise<void> {
    await this.whatsappService.sendText(
      phone,
      'By registering, you agree that MediFlow Hospital may store and process your health information as per our Privacy Policy and DPDP Act 2023.\n\nYour data is protected and will only be used for your healthcare.',
    );
    await this.whatsappService.sendButtons(
      phone,
      'Do you consent to the above?',
      [
        { id: 'CONSENT_YES', title: '✅ I Agree' },
        { id: 'CONSENT_NO', title: '❌ Decline' },
      ],
    );
  }

  async handleConsent(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;

    if (input === 'CONSENT_NO') {
      await this.whatsappService.sendText(
        phone,
        'We cannot register without your consent. Your data will not be stored. Thank you.',
      );
      await this.sessionService.clearSession(phone);
      return;
    }

    if (input === 'CONSENT_YES') {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await this.sessionService.updateFsmState(phone, 'REGISTRATION_OTP', {
        otp,
        otpAttempts: 0,
      });

      if (process.env.NODE_ENV !== 'production') {
        this.logger.log(`[DEV] OTP for ${phone}: ${otp}`);
      }
      // In production: integrate MSG91 or similar SMS/WhatsApp OTP provider here

      await this.whatsappService.sendText(
        phone,
        'A 6-digit OTP has been sent to verify your WhatsApp number. Please enter it:',
      );
      return;
    }

    // Invalid input — resend consent
    await this.sendConsentMessage(phone);
  }

  async handleOtp(
    session: WhatsAppSession,
    input: string,
    event: WhatsAppInboundMessageEvent,
  ): Promise<void> {
    const phone = event.data.phone;
    const ctx = session.fsmContext as any;
    const trimmed = input.trim();

    // Validate format: 6-digit numeric
    if (!/^\d{6}$/.test(trimmed)) {
      await this.whatsappService.sendText(
        phone,
        'Please enter the 6-digit OTP:',
      );
      return;
    }

    const storedOtp = ctx.otp as string;
    const attempts = (ctx.otpAttempts as number) || 0;

    if (trimmed !== storedOtp) {
      const newAttempts = attempts + 1;
      if (newAttempts >= 3) {
        await this.whatsappService.sendText(
          phone,
          'Too many incorrect attempts. Please start over.',
        );
        await this.sessionService.clearSession(phone);
        return;
      }
      await this.sessionService.updateFsmState(phone, 'REGISTRATION_OTP', {
        otpAttempts: newAttempts,
      });
      await this.whatsappService.sendText(
        phone,
        `Incorrect OTP. Please try again: (${3 - newAttempts} attempts left)`,
      );
      return;
    }

    // OTP correct — register the patient
    try {
      const nameParts = (ctx.name as string).trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName =
        nameParts.length > 1 ? nameParts.slice(1).join(' ') : ctx.name;

      const response = await axios.post(
        `${this.patientServiceUrl}/patients`,
        {
          firstName,
          lastName,
          phone: session.phone,
          dob: ctx.dob,
          gender: ctx.gender,
          abhaId: ctx.abhaId || undefined,
          preferredLanguage: session.preferredLanguage,
          consentGiven: true,
          tenantId: session.tenantId || 'default',
        },
        {
          headers: { 'x-internal-service': 'whatsapp-engine' },
          timeout: 10000,
        },
      );

      const patient = response.data?.data || response.data;
      const patientId = patient.id;
      const uhid = patient.uhid || patientId;

      const updatedSession = await this.sessionService.updateFsmState(
        phone,
        'MAIN_MENU',
        {},
      );
      updatedSession.patientId = patientId;
      await this.sessionService.saveSession(phone, updatedSession);

      await this.whatsappService.sendText(
        phone,
        `🎉 Registration successful!\n\nWelcome, ${ctx.name}!\n📋 Patient ID: ${uhid}\n\nYou can now book appointments and access your health records.`,
      );
      await this.sendMainMenuButtons(phone);
    } catch (err: any) {
      this.logger.error(`Failed to register patient for ${phone}: ${err.message}`);
      await this.whatsappService.sendText(
        phone,
        'Sorry, we could not complete your registration. Please try again.',
      );
    }
  }

  private isLanguageInput(input: string): boolean {
    return ['LANG_EN', 'LANG_HI', 'LANG_TA', 'LANG_TE', 'LANG_KN', 'LANG_BN'].includes(input);
  }

  private async sendMainMenuButtons(phone: string): Promise<void> {
    await this.whatsappService.sendButtons(
      phone,
      'How can I help you today? 🏥',
      [
        { id: 'BOOK_APPOINTMENT', title: '📅 Book Appointment' },
        { id: 'MY_APPOINTMENTS', title: '📋 My Appointments' },
        { id: 'HELP', title: '❓ Help' },
      ],
    );
  }
}
