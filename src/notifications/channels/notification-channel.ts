import type { DatabaseShape } from '../../shared/types';
import type { NotifyChannel } from '../types';

/** Para quem enviar; `skip` registra na fila o motivo de não ter enviado. */
export type ChannelTarget =
  { kind: 'send'; to: string; who: string } | { kind: 'skip'; to: string; reason: string; fallbackToEmail?: boolean };

/** Um meio de entrega (e-mail, WhatsApp...). Um canal novo é uma classe nova; o dispatcher não muda. */
export interface NotificationChannel {
  readonly name: NotifyChannel;
  isConfigured(): boolean;
  resolveTargets(db: DatabaseShape, memberId?: string): Promise<ChannelTarget[]>;
}
