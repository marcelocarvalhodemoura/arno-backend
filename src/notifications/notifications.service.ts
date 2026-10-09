import { Inject, Injectable } from '@nestjs/common';
import { listNotifications } from './notify';
import { NotificationDispatcher } from './notification-dispatcher';
import { FILE_STORAGE, type FileStorage } from '../storage/file-storage';
import { countQueued } from './outbox';
import { processIncomingMessage } from '../notas/nota-whatsapp';
import { handleWhatsAppEvents, hubChallenge, isWhatsAppAccount, verifyWebhook } from './whatsapp';
import { recordInbound } from './whatsapp-window';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notifications: NotificationDispatcher,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async status() {
    return { ...this.notifications.status(), queued: await countQueued() };
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
        // Grava antes de responder: a resposta só sai se a janela de 24 h estiver aberta.
        void recordInbound(message.from, message.contactName, message.timestamp)
          .catch((error) => console.error('WhatsApp janela 24 h:', error))
          .then(() => processIncomingMessage(message, this.storage))
          .catch((error) => console.error('WhatsApp nota:', error));
      }
    } catch (error) {
      console.error('WhatsApp webhook:', error);
    }
    return true;
  }
}
