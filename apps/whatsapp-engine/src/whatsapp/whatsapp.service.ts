import {
  Injectable,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baseUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private client: AxiosInstance;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('whatsapp.apiBaseUrl') || 'https://graph.facebook.com/v18.0';
    this.phoneNumberId = this.configService.get<string>('whatsapp.phoneNumberId') || '';
    this.accessToken = this.configService.get<string>('whatsapp.accessToken') || '';
  }

  onModuleInit() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private get messagesUrl(): string {
    return `/${this.phoneNumberId}/messages`;
  }

  private handleAxiosError(err: any, context: string): never {
    const message = err?.response?.data?.error?.message || err.message || 'Unknown error';
    this.logger.error(`WhatsApp API error [${context}]: ${message}`);
    throw new InternalServerErrorException(`WhatsApp API error: ${message}`);
  }

  async sendText(to: string, text: string): Promise<string> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      };
      const res = await this.client.post(this.messagesUrl, payload);
      return res.data?.messages?.[0]?.id || '';
    } catch (err) {
      this.handleAxiosError(err, 'sendText');
    }
  }

  async sendButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<string> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      };
      const res = await this.client.post(this.messagesUrl, payload);
      return res.data?.messages?.[0]?.id || '';
    } catch (err) {
      this.handleAxiosError(err, 'sendButtons');
    }
  }

  async sendList(
    to: string,
    body: string,
    buttonText: string,
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>,
  ): Promise<string> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: buttonText,
            sections,
          },
        },
      };
      const res = await this.client.post(this.messagesUrl, payload);
      return res.data?.messages?.[0]?.id || '';
    } catch (err) {
      this.handleAxiosError(err, 'sendList');
    }
  }

  async sendDocument(
    to: string,
    url: string,
    filename: string,
    caption?: string,
  ): Promise<string> {
    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { link: url, filename },
      };
      if (caption) {
        payload.document.caption = caption;
      }
      const res = await this.client.post(this.messagesUrl, payload);
      return res.data?.messages?.[0]?.id || '';
    } catch (err) {
      this.handleAxiosError(err, 'sendDocument');
    }
  }

  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: any[],
  ): Promise<string> {
    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
        },
      };
      if (components && components.length > 0) {
        payload.template.components = components;
      }
      const res = await this.client.post(this.messagesUrl, payload);
      return res.data?.messages?.[0]?.id || '';
    } catch (err) {
      this.handleAxiosError(err, 'sendTemplate');
    }
  }

  async markRead(messageId: string): Promise<void> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      };
      await this.client.post(this.messagesUrl, payload);
    } catch (err) {
      // Mark read failures are non-critical — log and continue
      const message = err?.response?.data?.error?.message || err.message;
      this.logger.warn(`Failed to mark message as read [${messageId}]: ${message}`);
    }
  }
}
