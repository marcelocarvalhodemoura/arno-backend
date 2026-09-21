import { Injectable } from '@nestjs/common';
import { listNotifications, notifyStatus } from './notify';
import { countQueued } from './outbox';
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
      handleWhatsAppEvents(body);
    } catch (error) {
      console.error('WhatsApp webhook:', error);
    }
    return true;
  }
}
