import { buildWhatsAppChargeQueue, crc16, pixCopiaECola, prettyName } from './whatsapp-queue';
import { syncMensalidades } from './mensalidades';
import type { DatabaseShape, Member } from '../shared/types';

function member(partial: Partial<Member> & Pick<Member, 'id' | 'name' | 'joinedAt'>): Member {
  return {
    email: '',
    phone: '',
    branch: 'escoteiro',
    role: 'jovem',
    monthlyFee: 75,
    status: 'active',
    clubeLtc: false,
    origin: 'manual',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...partial,
  };
}

function db(): DatabaseShape {
  const value: DatabaseShape = {
    members: [
      member({ id: 'm1', name: 'JOÃO DA SILVA', joinedAt: '2026-08-01', phone: '' }),
      member({ id: 'm2', name: 'ANA SOUZA', joinedAt: '2026-08-01', phone: '(51) 98888-0002' }),
    ],
    memberGuardians: [
      {
        id: 'g1',
        memberId: 'm1',
        name: 'MARIA DA SILVA',
        relationship: 'Mãe',
        phone: '(51) 99999-1002',
        email: '',
        origin: 'manual',
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Grupo Escoteiro Arno Friedrich' },
  };
  syncMensalidades(value, 2026, 'u1', '2026-08-01');
  return value;
}

describe('pix copia e cola', () => {
  it('uses CRC16-CCITT (0xFFFF)', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('builds a static BR Code with amount and a valid CRC', () => {
    const payload = pixCopiaECola({
      key: '08415677000100',
      amount: 75,
      name: 'GE Arno Friedrich',
      city: 'Porto Alegre',
      info: 'Mensalidade João',
    });
    expect(payload.startsWith('000201')).toBe(true);
    expect(payload).toContain('0014br.gov.bcb.pix0114084156770001000216MENSALIDADE JOAO');
    expect(payload).toContain('540575.00');
    expect(payload).toContain('5802BR5917GE ARNO FRIEDRICH6012PORTO ALEGRE');
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });
});

describe('fila de cobrança pelo WhatsApp', () => {
  it('formats upper-case names', () => {
    expect(prettyName('MARIA DA SILVA')).toBe('Maria da Silva');
  });

  it('lists overdue months with the late surcharge and a wa.me link per contact', () => {
    const queue = buildWhatsAppChargeQueue(
      db(),
      'overdue',
      new Map([['m1', '2026-10-01T12:00:00.000Z']]),
      '2026-10-05',
    );
    expect(queue.totals.members).toBe(2);
    const joao = queue.rows.find((row) => row.memberId === 'm1')!;
    expect(joao.items.map((item) => item.yearMonth)).toEqual(['2026-08', '2026-09']);
    expect(joao.surcharge).toBeGreaterThan(0);
    expect(joao.total).toBe(joao.items.reduce((sum, item) => sum + item.lateAmount, 0));
    expect(joao.lastSentAt).toBe('2026-10-01T12:00:00.000Z');
    expect(joao.contacts).toHaveLength(1);
    const contact = joao.contacts[0];
    expect(contact.link.startsWith('https://wa.me/5551999991002?text=')).toBe(true);
    expect(contact.text).toContain('Olá, Maria!');
    expect(contact.text).toContain('mensalidades de João da Silva');
    expect(contact.text).toContain('ago/2026');
    expect(contact.text).toContain('acréscimo por pagamento após o dia 10');
  });

  it('reminds only the current month in upcoming mode, with the on-time amount', () => {
    const queue = buildWhatsAppChargeQueue(db(), 'upcoming', new Map(), '2026-10-05');
    const ana = queue.rows.find((row) => row.memberId === 'm2')!;
    expect(ana.items.map((item) => item.yearMonth)).toEqual(['2026-10']);
    expect(ana.pixAmount).toBe(ana.items[0].onTimeAmount);
    expect(ana.contacts[0].text).toContain('vence em 10/10/2026');
  });
});
