import {
  assertFamilyDiscountXor,
  assertYouthGuardians,
  cleanedGuardians,
  createMember,
  memberHasOpenDebt,
  officialFeesStale,
  refreshOfficialFees,
  correctStatusEffectiveDate,
  setMemberStatus,
  siblingIdsOf,
  statusHistoryOf,
  updateMember,
} from './members';
import type { DatabaseShape, Member } from '../shared/types';
import { syncMensalidades } from '../mensalidades/mensalidades';

function emptyDb(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
  };
}

describe('members', () => {
  it('requires a guardian for a youth', () => {
    expect(() => assertYouthGuardians('jovem', 0)).toThrow(/responsável/);
    expect(() => assertYouthGuardians('escotista', 0)).not.toThrow();
  });

  it('trims and drops empty guardians', () => {
    expect(
      cleanedGuardians([
        {
          name: '  Helena Souza  ',
          relationship: 'Mãe',
          phone: ' 51 ',
          email: '',
        },
        { name: 'X', relationship: 'Pai' },
      ]),
    ).toEqual([
      {
        id: undefined,
        name: 'HELENA SOUZA',
        relationship: 'Mãe',
        phone: '51',
        email: '',
      },
    ]);
  });

  it('uses the guardian e-mail below pioneiro so siblings can share it', () => {
    const db = emptyDb();
    const youth = (name: string, branch: 'lobinho' | 'senior' | 'pioneiro') =>
      createMember(
        db,
        {
          name,
          email: `${branch}@example.com`,
          phone: '51999990001',
          branch,
          role: 'jovem',
          joinedAt: '2026-03-01',
          clubeLtc: false,
          guardians: [{ name: 'Helena Souza', relationship: 'Mãe', phone: '', email: 'Helena@Example.com' }],
        },
        'u1',
      );
    expect(youth('Ana Souza', 'lobinho').email).toBe('helena@example.com');
    expect(youth('Caio Souza', 'senior').email).toBe('helena@example.com');
    expect(youth('Bia Souza', 'pioneiro').email).toBe('pioneiro@example.com');
  });

  it('officialFeesStale agrees with refreshOfficialFees', () => {
    const db = emptyDb();
    const ana = createMember(
      db,
      {
        name: 'Ana Souza',
        email: 'ana@example.com',
        phone: '51999990001',
        branch: 'lobinho',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Helena Souza', relationship: 'Mãe', phone: '', email: 'helena@example.com' }],
      },
      'u1',
    );
    refreshOfficialFees(db);
    expect(officialFeesStale(db)).toBe(false);

    ana.monthlyFee = 1;
    expect(officialFeesStale(db)).toBe(true);
    refreshOfficialFees(db);
    expect(officialFeesStale(db)).toBe(false);

    // Quem não paga mensalidade (escotista) com cobrança em aberto: a rotina cancela, então está desatualizado.
    db.movementTypes.push({
      id: 'mt-men',
      name: 'Mensalidade',
      direction: 'income',
      description: '',
      pixKey: '',
      branch: 'grupo',
      active: true,
      origin: 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    ana.role = 'escotista';
    refreshOfficialFees(db);
    db.transactions.push({
      id: 'p1',
      date: '2026-11-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: 'mt-men',
      description: 'Mensalidade novembro',
      amount: 75,
      branch: 'lobinho',
      method: 'pix',
      paymentStatus: 'pending',
      memberId: ana.id,
      origin: 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(officialFeesStale(db)).toBe(true);
    refreshOfficialFees(db);
    expect(db.transactions).toHaveLength(0);
    expect(officialFeesStale(db)).toBe(false);
  });

  it('requires a contact e-mail', () => {
    const base = { phone: '51999990001', joinedAt: '2026-03-01', clubeLtc: false } as const;
    expect(() =>
      createMember(
        emptyDb(),
        {
          ...base,
          name: 'Ana Souza',
          email: '',
          branch: 'lobinho',
          role: 'jovem',
          guardians: [{ name: 'Helena Souza', relationship: 'Mãe', phone: '', email: '' }],
        },
        'u1',
      ),
    ).toThrow('Informe o e-mail de pelo menos um responsável');
    expect(() =>
      createMember(emptyDb(), { ...base, name: 'Rui Lima', email: '', branch: 'pioneiro', role: 'escotista' }, 'u1'),
    ).toThrow('Informe o e-mail do associado');
  });

  it('upper-cases member and guardian names on create', () => {
    const db = emptyDb();
    const member = createMember(
      db,
      {
        name: 'Ana Clara dos  Casaes',
        email: 'ana.clara@example.com',
        phone: '51999990001',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Cristina dos Casaes Claro', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(member.name).toBe('ANA CLARA DOS CASAES');
    expect(db.memberGuardians[0]?.name).toBe('CRISTINA DOS CASAES CLARO');
  });

  it('creates a youth with official fee and a guardian', () => {
    const db = emptyDb();
    const member = createMember(
      db,
      {
        name: 'Ana Souza',
        email: 'ana@example.com',
        phone: '51999990000',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: true,
        guardians: [{ name: 'Helena Souza', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(member.monthlyFee).toBe(75);
    expect(member.feeOverride).toBeNull();
    expect(member.chiefChild).toBe(false);
    expect(db.memberGuardians).toHaveLength(1);
  });

  it('stores a fee override for sibling or chief-child discounts', () => {
    const db = emptyDb();
    const member = createMember(
      db,
      {
        name: 'Caio Dias',
        email: 'caio@example.com',
        phone: '51999990004',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        feeOverride: 82,
        guardians: [{ name: 'Lia Dias', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(member.feeOverride).toBe(82);
    expect(member.monthlyFee).toBe(82);
  });

  it('applies special fee for chief child', () => {
    const db = emptyDb();
    const member = createMember(
      db,
      {
        name: 'Leo Chefe',
        email: 'leo@example.com',
        phone: '51999990010',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        chiefChild: true,
        guardians: [{ name: 'Chefe', relationship: 'Pai' }],
      },
      'u1',
    );
    expect(member.chiefChild).toBe(true);
    expect(member.feeOverride).toBe(82);
    expect(member.monthlyFee).toBe(82);

    const asMember = updateMember(db, member.id, { clubeLtc: true }, 'u1');
    expect(asMember?.feeOverride).toBe(67.5);
    expect(asMember?.monthlyFee).toBe(67.5);
  });

  it('links siblings bidirectionally and applies special fee to both', () => {
    const db = emptyDb();
    const older = createMember(
      db,
      {
        name: 'Ana Irmã',
        email: 'ana.irma@example.com',
        phone: '51999990011',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    const younger = createMember(
      db,
      {
        name: 'Bruno Irmão',
        email: 'bruno.irmao@example.com',
        phone: '51999990012',
        branch: 'lobinho',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        siblingIds: [older.id],
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(siblingIdsOf(db, younger.id)).toEqual([older.id]);
    expect(siblingIdsOf(db, older.id)).toEqual([younger.id]);
    expect(younger.feeOverride).toBe(82);
    expect(older.feeOverride).toBe(82);
    expect(younger.monthlyFee).toBe(82);
    expect(older.monthlyFee).toBe(82);
  });

  it('rejects chief child together with siblings', () => {
    expect(() => assertFamilyDiscountXor(true, ['x'])).toThrow(/só uma opção/);
    const db = emptyDb();
    const other = createMember(
      db,
      {
        name: 'Outro',
        email: 'outro@example.com',
        phone: '51999990013',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    expect(() =>
      createMember(
        db,
        {
          name: 'Conflito',
          email: 'conflito@example.com',
          phone: '51999990014',
          branch: 'escoteiro',
          role: 'jovem',
          joinedAt: '2026-03-01',
          clubeLtc: false,
          chiefChild: true,
          siblingIds: [other.id],
          guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
        },
        'u1',
      ),
    ).toThrow(/só uma opção/);
  });

  it('clears special fee when siblings are removed', () => {
    const db = emptyDb();
    const a = createMember(
      db,
      {
        name: 'A',
        email: 'a@example.com',
        phone: '51999990015',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    const b = createMember(
      db,
      {
        name: 'B',
        email: 'b@example.com',
        phone: '51999990016',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        siblingIds: [a.id],
        guardians: [{ name: 'Mãe', relationship: 'Mãe' }],
      },
      'u1',
    );
    updateMember(db, b.id, { siblingIds: [] }, 'u1');
    expect(siblingIdsOf(db, a.id)).toEqual([]);
    expect(siblingIdsOf(db, b.id)).toEqual([]);
    expect(a.feeOverride).toBeNull();
    expect(b.feeOverride).toBeNull();
  });

  it('does not charge dirigentes, escotistas or Clube da Flor de Lis', () => {
    const db = emptyDb();
    const escotista = createMember(
      db,
      {
        name: 'Bia Lima',
        email: 'bia@example.com',
        phone: '51999990001',
        branch: 'escoteiro',
        role: 'escotista',
        joinedAt: '2026-03-01',
        clubeLtc: false,
      },
      'u1',
    );
    const dirigente = createMember(
      db,
      {
        name: 'Caio Dias',
        email: 'caio@example.com',
        phone: '51999990002',
        branch: 'senior',
        role: 'dirigente',
        joinedAt: '2026-03-01',
        clubeLtc: false,
      },
      'u1',
    );
    const clube = createMember(
      db,
      {
        name: 'Duda Nunes',
        email: 'duda@example.com',
        phone: '51999990003',
        branch: 'flor-de-lis',
        role: 'clube',
        joinedAt: '2026-03-01',
        clubeLtc: true,
      },
      'u1',
    );
    expect(escotista.monthlyFee).toBe(0);
    expect(dirigente.monthlyFee).toBe(0);
    expect(clube.monthlyFee).toBe(0);
  });

  it('rejects a youth without guardians', () => {
    const db = emptyDb();
    expect(() =>
      createMember(
        db,
        {
          name: 'Ana Souza',
          email: 'ana@example.com',
          phone: '51999990000',
          branch: 'escoteiro',
          role: 'jovem',
          joinedAt: '2026-03-01',
          clubeLtc: false,
        },
        'u1',
      ),
    ).toThrow(/responsável/);
  });

  describe('member status (inactivate/reactivate)', () => {
    const makeDirigente = (db: DatabaseShape) =>
      createMember(
        db,
        {
          name: 'Caio Dias',
          email: 'caio@example.com',
          phone: '51999990002',
          branch: 'senior',
          role: 'dirigente',
          joinedAt: '2026-03-01',
          clubeLtc: false,
        },
        'u1',
      );

    it('records a history entry with reason and author in both directions', () => {
      const db = emptyDb();
      const member = makeDirigente(db);

      setMemberStatus(db, member.id, 'inactive', '  Saiu do grupo  ', 'u1');
      expect(member.status).toBe('inactive');
      setMemberStatus(db, member.id, 'active', 'Voltou ao grupo', 'u2');
      expect(member.status).toBe('active');

      const history = statusHistoryOf(db, member.id);
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        fromStatus: 'inactive',
        toStatus: 'active',
        reason: 'Voltou ao grupo',
        byId: 'u2',
      });
      expect(history[1]).toMatchObject({
        fromStatus: 'active',
        toStatus: 'inactive',
        reason: 'Saiu do grupo',
        byId: 'u1',
      });
    });

    it('requires a justification', () => {
      const db = emptyDb();
      const member = makeDirigente(db);
      expect(() => setMemberStatus(db, member.id, 'inactive', '  ', 'u1')).toThrow(/justificativa/i);
      expect(statusHistoryOf(db, member.id)).toHaveLength(0);
    });

    it('rejects a no-op transition to the same status', () => {
      const db = emptyDb();
      const member = makeDirigente(db);
      expect(() => setMemberStatus(db, member.id, 'active', 'já está ativo', 'u1')).toThrow(/já está ativo/i);
    });

    it('blocks inactivation when there is an open arrears balance', () => {
      const db = emptyDb();
      const member = makeDirigente(db);
      (db.memberArrears ??= []).push({
        id: 'arr1',
        memberId: member.id,
        originalAmount: 300,
        balance: 120,
        installmentAmount: 60,
        totalCount: 5,
        remainingCount: 2,
        startYearMonth: '2026-01',
        chargeMode: 'separate',
        note: '',
        status: 'active',
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      expect(memberHasOpenDebt(db, member.id)).toBe(true);
      expect(() => setMemberStatus(db, member.id, 'inactive', 'tentativa', 'u1')).toThrow(/acordo de atraso/i);
      expect(member.status).toBe('active');
      expect(statusHistoryOf(db, member.id)).toHaveLength(0);
    });

    it('allows inactivation when the arrears plan is already settled', () => {
      const db = emptyDb();
      const member = makeDirigente(db);
      (db.memberArrears ??= []).push({
        id: 'arr2',
        memberId: member.id,
        originalAmount: 300,
        balance: 0,
        installmentAmount: 60,
        totalCount: 5,
        remainingCount: 0,
        startYearMonth: '2026-01',
        chargeMode: 'separate',
        note: '',
        status: 'settled',
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      expect(memberHasOpenDebt(db, member.id)).toBe(false);
      expect(() => setMemberStatus(db, member.id, 'inactive', 'quitou e saiu', 'u1')).not.toThrow();
      expect(member.status).toBe('inactive');
    });

    it('returns null for an unknown member', () => {
      const db = emptyDb();
      expect(setMemberStatus(db, 'nope', 'inactive', 'x', 'u1')).toBeNull();
    });
  });

  describe('data efetiva da saída e do retorno', () => {
    const NOW = new Date('2026-11-20T15:00:00.000Z');
    const TODAY = '2026-11-20';

    function youthDb(): DatabaseShape {
      const db = emptyDb();
      const youth: Member = {
        id: 'j1',
        name: 'ANA SOUZA',
        email: 'ana@example.com',
        phone: '',
        branch: 'escoteiro',
        role: 'jovem',
        monthlyFee: 89.5,
        status: 'active',
        clubeLtc: false,
        origin: 'manual',
        joinedAt: '2026-03-01',
        createdAt: '2026-03-01T00:00:00.000Z',
      };
      db.members.push(youth);
      syncMensalidades(db, 2026, 'u1', '2026-03-01');
      return db;
    }
    const months = (db: DatabaseShape) =>
      db.transactions
        .filter((tx) => tx.memberId === 'j1')
        .map((tx) => tx.date.slice(0, 7))
        .sort();
    const pay = (db: DatabaseShape, ym: string) => {
      const tx = db.transactions.find((item) => item.memberId === 'j1' && item.date.startsWith(ym))!;
      tx.paymentStatus = 'paid';
      tx.paidAt = `${ym}-05`;
    };
    const opts = { today: TODAY, now: NOW };

    it('saída retroativa manda para a lixeira as pendentes a partir do mês seguinte à saída e preserva as pagas', () => {
      const db = youthDb();
      pay(db, '2026-03');
      pay(db, '2026-09'); // pagou mesmo depois de ter parado de ir

      const result = setMemberStatus(db, 'j1', 'inactive', 'Parou de frequentar', 'u1', {
        ...opts,
        effectiveDate: '2026-07-15',
        kind: 'abandono',
      })!;

      expect(months(db)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-09']);
      expect(result.trashedIds).toHaveLength(3); // agosto, outubro, novembro
      expect(db.trash!.map((item) => item.transaction.date.slice(0, 7)).sort()).toEqual([
        '2026-08',
        '2026-10',
        '2026-11',
      ]);
      expect(result.paidDuringAbsence.map((tx) => tx.date.slice(0, 7))).toEqual(['2026-09']);
      expect(statusHistoryOf(db, 'j1')[0]).toMatchObject({
        effectiveDate: '2026-07-15',
        kind: 'abandono',
        confirmedBy: null,
      });
    });

    it('desligamento informal exige quem confirmou', () => {
      const db = youthDb();
      expect(() =>
        setMemberStatus(db, 'j1', 'inactive', 'Saiu', 'u1', { ...opts, effectiveDate: '2026-07-15', kind: 'informal' }),
      ).toThrow(/quem confirmou/);
      setMemberStatus(db, 'j1', 'inactive', 'Saiu', 'u1', {
        ...opts,
        effectiveDate: '2026-07-15',
        kind: 'informal',
        confirmedBy: ' Chefe Paula ',
      });
      expect(statusHistoryOf(db, 'j1')[0].confirmedBy).toBe('Chefe Paula');
    });

    it('rejeita data no futuro, antes da entrada e antes da mudança anterior', () => {
      const db = youthDb();
      const exit = (effectiveDate: string) =>
        setMemberStatus(db, 'j1', 'inactive', 'Saiu', 'u1', { ...opts, effectiveDate, kind: 'formal' });
      expect(() => exit('2026-12-01')).toThrow(/futuro/);
      expect(() => exit('2026-02-10')).toThrow(/entrada no grupo/);
      exit('2026-07-15');
      expect(() =>
        setMemberStatus(db, 'j1', 'active', 'Voltou', 'u1', { ...opts, effectiveDate: '2026-07-01' }),
      ).toThrow(/mudança de situação anterior/);
    });

    it('retorno retroativo volta a cobrar a partir do mês do retorno, sem cobrar o intervalo', () => {
      const db = youthDb();
      setMemberStatus(db, 'j1', 'inactive', 'Saiu', 'u1', { ...opts, effectiveDate: '2026-06-20', kind: 'formal' });
      setMemberStatus(db, 'j1', 'active', 'Voltou em setembro', 'u1', { ...opts, effectiveDate: '2026-09-03' });
      expect(months(db)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-09', '2026-10', '2026-11']);
    });

    it('corrigir a saída para antes manda os novos meses de ausência para a lixeira e guarda a correção', () => {
      const db = youthDb();
      setMemberStatus(db, 'j1', 'inactive', 'Registrado agora', 'u1', { ...opts, kind: 'abandono' });
      expect(months(db)).toContain('2026-08');
      const entry = statusHistoryOf(db, 'j1')[0];

      const result = correctStatusEffectiveDate(db, 'j1', entry.id, '2026-07-10', 'Chefe confirmou julho', 'u2', opts)!;

      expect(months(db)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
      expect(result.trashedIds).toHaveLength(4); // agosto a novembro
      expect(statusHistoryOf(db, 'j1')[0]).toMatchObject({
        effectiveDate: '2026-07-10',
        corrections: [{ from: TODAY, to: '2026-07-10', reason: 'Chefe confirmou julho', byId: 'u2' }],
      });
    });

    it('corrigir o retorno para antes gera os meses que voltaram a ser devidos', () => {
      const db = youthDb();
      setMemberStatus(db, 'j1', 'inactive', 'Saiu', 'u1', { ...opts, effectiveDate: '2026-05-20', kind: 'formal' });
      setMemberStatus(db, 'j1', 'active', 'Voltou', 'u1', { ...opts, effectiveDate: '2026-10-01' });
      expect(months(db)).not.toContain('2026-08');
      const back = statusHistoryOf(db, 'j1')[0];

      correctStatusEffectiveDate(db, 'j1', back.id, '2026-08-02', 'Voltou antes do registrado', 'u1', opts);

      expect(months(db)).toEqual(['2026-03', '2026-04', '2026-05', '2026-08', '2026-09', '2026-10', '2026-11']);
    });

    it('a correção respeita as mudanças vizinhas', () => {
      const db = youthDb();
      setMemberStatus(db, 'j1', 'inactive', 'Saiu', 'u1', { ...opts, effectiveDate: '2026-05-20', kind: 'formal' });
      setMemberStatus(db, 'j1', 'active', 'Voltou', 'u1', { ...opts, effectiveDate: '2026-10-01' });
      const [back, exit] = statusHistoryOf(db, 'j1');
      expect(() => correctStatusEffectiveDate(db, 'j1', exit.id, '2026-10-15', 'x', 'u1', opts)).toThrow(
        /mudança de situação seguinte/,
      );
      expect(() => correctStatusEffectiveDate(db, 'j1', back.id, '2026-05-01', 'x', 'u1', opts)).toThrow(
        /mudança de situação anterior/,
      );
      expect(() => correctStatusEffectiveDate(db, 'j1', back.id, '2026-10-01', 'x', 'u1', opts)).toThrow(/igual/);
      expect(() => correctStatusEffectiveDate(db, 'j1', 'nope', '2026-09-01', 'x', 'u1', opts)).toThrow(
        /não encontrado/,
      );
    });
  });
});
