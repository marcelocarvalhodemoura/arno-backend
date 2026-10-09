import { appConfig } from '../../shared/config';
import type { DatabaseShape } from '../../shared/types';
import { phonesOf } from '../contacts';
import { whatsappStatus } from '../whatsapp';
import { OUTSIDE_WINDOW_ERROR, windowOpen } from '../whatsapp-window';
import type { ChannelTarget, NotificationChannel } from './notification-channel';

/**
 * Mensagem livre só vai para quem escreveu nas últimas 24 h (janela do WhatsApp).
 * Fora da janela o envio é pulado e o dispatcher manda por e-mail, que não tem custo.
 */
export class WhatsAppChannel implements NotificationChannel {
  readonly name = 'whatsapp' as const;

  constructor(private readonly isWindowOpen: (phone: string) => Promise<boolean> = windowOpen) {}

  isConfigured() {
    return whatsappStatus().configured || appConfig.whatsapp.mock;
  }

  async resolveTargets(db: DatabaseShape, memberId?: string): Promise<ChannelTarget[]> {
    const targets = phonesOf(db, memberId);
    if (!targets.length) return [{ kind: 'skip', to: '(sem telefone)', reason: 'Associado sem telefone cadastrado' }];
    const resolved: ChannelTarget[] = [];
    for (const target of targets) {
      if (appConfig.whatsapp.mock || (await this.isWindowOpen(target.phone))) {
        resolved.push({ kind: 'send', to: target.phone, who: target.name });
      } else {
        resolved.push({ kind: 'skip', to: target.phone, reason: OUTSIDE_WINDOW_ERROR, fallbackToEmail: true });
      }
    }
    return resolved;
  }
}
