import type { DatabaseShape, Transaction } from '../shared/types';
import type { ChannelTarget, NotificationChannel } from './channels/notification-channel';
import { NotificationDispatcher } from './notification-dispatcher';
import type { OutboxRow, OutboxWriter } from './outbox-writer';
import type { NotifyChannel } from './types';

jest.mock('./templates', () => ({
  composeNotifyMessage: (_db: unknown, _tx: unknown, kind: string, who: string) => ({
    subject: `${kind} ${who}`,
    text: `texto ${who}`,
    html: `<p>${who}</p>`,
  }),
}));

class FakeChannel implements NotificationChannel {
  constructor(
    readonly name: NotifyChannel,
    private readonly targets: ChannelTarget[],
    private readonly configured = true,
  ) {}
  isConfigured() {
    return this.configured;
  }
  resolveTargets() {
    return Promise.resolve(this.targets);
  }
}

class FakeOutbox implements OutboxWriter {
  rows: OutboxRow[] = [];
  kicks = 0;
  record(row: OutboxRow) {
    this.rows.push(row);
    return Promise.resolve(`row-${this.rows.length}`);
  }
  kick() {
    this.kicks += 1;
  }
}

const db = {} as DatabaseShape;
const tx = { id: 'tx-1', memberId: 'm-1' } as Transaction;

describe('NotificationDispatcher', () => {
  it('enfileira em cada canal pedido e acorda o worker', async () => {
    const outbox = new FakeOutbox();
    const dispatcher = new NotificationDispatcher(
      [
        new FakeChannel('email', [{ kind: 'send', to: 'mae@x.org', who: 'Mãe' }]),
        new FakeChannel('whatsapp', [{ kind: 'send', to: '51999990000', who: 'Pai' }]),
      ],
      outbox,
    );
    const deliveries = await dispatcher.notifyTransaction(db, tx, 'receipt', ['email', 'whatsapp', 'email'], 'u-1');
    expect(deliveries.map((item) => [item.channel, item.status, item.to])).toEqual([
      ['email', 'queued', 'mae@x.org'],
      ['whatsapp', 'queued', '51999990000'],
    ]);
    expect(outbox.rows[0]).toMatchObject({ html: '<p>Mãe</p>', transactionId: 'tx-1', memberId: 'm-1', userId: 'u-1' });
    expect(outbox.rows[1].html).toBeUndefined();
    expect(outbox.kicks).toBe(1);
  });

  it('cai para o e-mail quando o WhatsApp está fora da janela', async () => {
    const outbox = new FakeOutbox();
    const dispatcher = new NotificationDispatcher(
      [
        new FakeChannel('email', [{ kind: 'send', to: 'mae@x.org', who: 'Mãe' }]),
        new FakeChannel('whatsapp', [{ kind: 'skip', to: '5199', reason: 'fora da janela', fallbackToEmail: true }]),
      ],
      outbox,
    );
    const deliveries = await dispatcher.notifyTransaction(db, tx, 'charge', ['whatsapp'], 'u-1');
    expect(deliveries.map((item) => [item.channel, item.status])).toEqual([
      ['whatsapp', 'skipped'],
      ['email', 'queued'],
    ]);
    expect(deliveries[0].error).toBe('fora da janela');
  });

  it('não cai para o e-mail quando ele não está configurado e não acorda o worker sem fila', async () => {
    const outbox = new FakeOutbox();
    const dispatcher = new NotificationDispatcher(
      [
        new FakeChannel('email', [{ kind: 'send', to: 'mae@x.org', who: 'Mãe' }], false),
        new FakeChannel('whatsapp', [{ kind: 'skip', to: '5199', reason: 'fora', fallbackToEmail: true }]),
      ],
      outbox,
    );
    const deliveries = await dispatcher.notifyTransaction(db, tx, 'charge', ['whatsapp'], 'u-1');
    expect(deliveries).toHaveLength(1);
    expect(outbox.kicks).toBe(0);
  });

  it('resume recibos e avisa quando não há canal configurado', async () => {
    const none = new NotificationDispatcher([new FakeChannel('email', [], false)], new FakeOutbox());
    expect(await none.notifyReceipts(db, [tx, { id: 'tx-2' } as Transaction], 'u-1')).toEqual({
      queued: 0,
      sent: 0,
      failed: 0,
      skipped: 1,
      total: 1,
      note: 'Configure MAIL_HOST (ou MAIL_MOCK=1) para enviar o recibo',
    });

    const email = new NotificationDispatcher(
      [new FakeChannel('email', [{ kind: 'send', to: 'mae@x.org', who: 'Mãe' }])],
      new FakeOutbox(),
    );
    expect(await email.notifyReceipts(db, [tx, { ...tx, id: 'tx-3' }], 'u-1')).toMatchObject({ queued: 2, total: 2 });
    expect(email.status()).toEqual({ email: true, whatsapp: false });
    expect(email.configuredChannels()).toEqual(['email']);
  });
});
