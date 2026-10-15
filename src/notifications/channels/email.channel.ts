import type { DatabaseShape } from '../../shared/types';
import { emailsOf } from '../contacts';
import { mailConfigured } from '../mail';
import type { ChannelTarget, NotificationChannel } from './notification-channel';

export class EmailChannel implements NotificationChannel {
  readonly name = 'email' as const;

  isConfigured() {
    return mailConfigured();
  }

  resolveTargets(db: DatabaseShape, memberId?: string): Promise<ChannelTarget[]> {
    const targets = emailsOf(db, memberId);
    if (!targets.length) {
      return Promise.resolve([{ kind: 'skip', to: '(sem e-mail)', reason: 'Associado sem e-mail cadastrado' }]);
    }
    return Promise.resolve(targets.map((target) => ({ kind: 'send', to: target.email, who: target.name })));
  }
}
