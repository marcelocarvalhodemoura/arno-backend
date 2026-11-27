import { buildPossibleDepartures, composeDepartureCheck, departureCheckEmailText } from './departure-check';
import { syncMensalidades } from '../mensalidades/mensalidades';
import type { DatabaseShape, Member, MemberGuardian } from '../shared/types';

const TODAY = '2026-11-20';

function youth(partial: Partial<Member> & Pick<Member, 'id' | 'name'>): Member {
  return {
    email: '',
    phone: '',
    branch: 'escoteiro',
    role: 'jovem',
    monthlyFee: 89.5,
    status: 'active',
    clubeLtc: false,
    origin: 'manual',
    joinedAt: '2026-03-01',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...partial,
  };
}

function guardian(memberId: string, partial: Partial<MemberGuardian> = {}): MemberGuardian {
  return {
    id: `g-${memberId}`,
    memberId,
    name: 'MARIA DA SILVA',
    relationship: 'Mãe',
    phone: '(51) 99999-0001',
    email: 'maria@example.com',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...partial,
  } as MemberGuardian;
}

function dbWith(members: Member[], guardians: MemberGuardian[] = []): DatabaseShape {
  const db: DatabaseShape = {
    members,
    memberGuardians: guardians,
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Grupo Escoteiro Arno Friedrich' },
  };
  syncMensalidades(db, 2026, 'u1', '2026-03-01');
  return db;
}

function payUntil(db: DatabaseShape, memberId: string, lastYm: string) {
  for (const tx of db.transactions) {
    if (tx.memberId === memberId && tx.date.slice(0, 7) <= lastYm) {
      tx.paymentStatus = 'paid';
      tx.paidAt = `${tx.date.slice(0, 7)}-08`;
    }
  }
}

describe('possíveis desligamentos', () => {
  it('lista quem tem N ou mais mensalidades vencidas seguidas, com a saída sugerida', () => {
    const db = dbWith([youth({ id: 'a', name: 'ANA SOUZA' }), youth({ id: 'b', name: 'BRUNO LIMA' })], [guardian('a')]);
    payUntil(db, 'a', '2026-07'); // aberto: ago, set, out, nov (nov vence dia 10, já passou)
    payUntil(db, 'b', '2026-09'); // aberto: out, nov

    const report = buildPossibleDepartures(db, new Map(), { months: 3, today: TODAY });

    expect(report.rows.map((row) => row.memberId)).toEqual(['a']);
    const row = report.rows[0];
    expect(row.streak).toBe(4);
    expect(row.since).toBe('2026-08');
    expect(row.months).toEqual(['ago/2026', 'set/2026', 'out/2026', 'nov/2026']);
    expect(row.lastPaidAt).toBe('2026-07-08');
    expect(row.suggestedEffectiveDate).toBe('2026-07-31');
    expect(row.hasEmail).toBe(true);
    expect(row.contacts.map((c) => c.relationship)).toEqual(['Mãe']);
    expect(row.contacts[0].link).toMatch(/^https:\/\/wa\.me\/5551999990001\?text=/);
    expect(row.contacts[0].text).toContain('Olá, Maria!');
    expect(row.contacts[0].text).toContain('desde ago/2026');
    expect(row.contacts[0].text).toContain('até 05/12/2026');

    expect(buildPossibleDepartures(db, new Map(), { months: 2, today: TODAY }).rows).toHaveLength(2);
  });

  it('um pagamento no meio quebra a sequência; mês ainda não vencido não conta', () => {
    const db = dbWith([youth({ id: 'a', name: 'ANA SOUZA' })]);
    payUntil(db, 'a', '2026-06');
    db.transactions.find((tx) => tx.date.startsWith('2026-09'))!.paymentStatus = 'paid';
    // aberto: jul, ago (antes do pagamento de set), out, nov → sequência atual = out, nov
    expect(buildPossibleDepartures(db, new Map(), { months: 3, today: TODAY }).rows).toHaveLength(0);
    // Em 05/11 novembro ainda não venceu: só outubro conta.
    expect(buildPossibleDepartures(db, new Map(), { months: 1, today: '2026-11-05' }).rows[0].streak).toBe(1);
  });

  it('ignora inativos, quem não paga mensalidade e quem nunca deixou de pagar', () => {
    const db = dbWith([
      youth({ id: 'a', name: 'ANA', status: 'inactive' }),
      youth({ id: 'b', name: 'BRUNO', role: 'escotista' }),
      youth({ id: 'c', name: 'CAIO' }),
    ]);
    payUntil(db, 'c', '2026-11');
    expect(buildPossibleDepartures(db, new Map(), { months: 1, today: TODAY }).rows).toHaveLength(0);
  });

  it('quem nunca pagou: saída sugerida não cai antes da entrada', () => {
    const db = dbWith([youth({ id: 'a', name: 'ANA', joinedAt: '2026-05-12' })]);
    const row = buildPossibleDepartures(db, new Map(), { months: 3, today: TODAY }).rows[0];
    expect(row.since).toBe('2026-05');
    expect(row.lastPaidAt).toBeNull();
    expect(row.suggestedEffectiveDate).toBe('2026-05-12');
  });

  it('mostra a última pergunta enviada e se o prazo de 15 dias venceu', () => {
    const db = dbWith([youth({ id: 'a', name: 'ANA' }), youth({ id: 'b', name: 'BIA' })]);
    const checks = new Map([
      ['a', '2026-11-01T13:00:00.000Z'],
      ['b', '2026-11-15T13:00:00.000Z'],
    ]);
    const report = buildPossibleDepartures(db, checks, { months: 3, today: TODAY });
    const byId = Object.fromEntries(report.rows.map((row) => [row.memberId, row]));
    expect(byId.a.lastCheck).toMatchObject({ deadline: '2026-11-16', expired: true });
    expect(byId.b.lastCheck).toMatchObject({ deadline: '2026-11-30', expired: false });
    expect(report.totals).toMatchObject({ members: 2, contacted: 2, expired: 1 });
  });

  it('texto do e-mail só existe para quem tem mensalidade vencida em aberto', () => {
    const db = dbWith([youth({ id: 'a', name: 'ANA SOUZA' }), youth({ id: 'b', name: 'BIA' })]);
    payUntil(db, 'b', '2026-11');
    expect(departureCheckEmailText(db, 'a', 'Maria', TODAY)).toContain('Ana Souza continua participando');
    expect(departureCheckEmailText(db, 'b', 'Maria', TODAY)).toBeNull();
  });

  it('a mensagem não promete perdão de dívida e dá o prazo', () => {
    const text = composeDepartureCheck({
      group: 'Grupo X',
      who: 'JOÃO PEREIRA',
      memberName: 'ANA DA SILVA',
      since: '2026-08',
      deadline: '2026-12-05',
    });
    expect(text).toContain('Olá, João!');
    expect(text).toContain('Ana da Silva continua participando');
    expect(text).toContain('até 05/12/2026');
    expect(text).not.toMatch(/perdo|isen/i);
  });
});
