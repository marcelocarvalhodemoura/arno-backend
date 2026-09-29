import { Injectable } from '@nestjs/common';
import { listNotifications, notifyStatus } from './notify';
import { countQueued } from './outbox';
import { processIncomingMessage } from '../notas/nota-whatsapp';
import { handleWhatsAppEvents, hubChallenge, isWhatsAppAccount, verifyWebhook } from './whatsapp';

@Injectable()
export class NotificationsService {
  async status() {
    return { ...notifyStatus(), queued: await countQueued() };
  }

  async log(limitQuery?: string) {
    const limit = Number(limitQuery ?? 40);
    return listNotifications(Number.isFinite(limit) ? limit : 40);
  }

  verifyHub(query: Record<string, unknown>) {
    return hubChallenge(query);
  }

  isValidVerify(mode: string, token: string) {
    return verifyWebhook(mode, token);
  }

  receiveEvent(body: unknown) {
    if (!isWhatsAppAccount(body)) return false;
    try {
      // Responde 200 à Meta na hora; a leitura da nota roda em segundo plano.
      for (const message of handleWhatsAppEvents(body)) {
        void processIncomingMessage(message).catch((error) => console.error('WhatsApp nota:', error));
      }
    } catch (error) {
      console.error('WhatsApp webhook:', error);
    }
    return true;
  }
}
