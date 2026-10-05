import { createdAudit } from '../shared/audit';
import type { DatabaseShape, Member, Transaction } from '../shared/types';
import { syncMensalidades } from '../mensalidades/mensalidades';
import { membersByPhone, payeeCheck, phoneKey, proofReply, reconcileProof } from './proof-intake';
import type { ProofData } from './proof-reader';

const E2E = 'E00416968202605111422abcDEF12345';
const TODAY = '2026-05-11';

function member(id: string, name: string, phone = ''): Member {
  return {
    id,
    name,
    email: '',
    phone,
    branch: 'escoteiro',
    role: 'jovem',
    status: 'active',
    joinedAt: '2026-03-01',
    monthlyFee: 89.5,
    clubeLtc: false,
    ...createdAudit('u1'),
  } as unknown as Member;
}

function db(partial: Partial<DatabaseShape> = {}): DatabaseShape {
  const type = (id: string, name: string, direction: 'income' | 'both') => ({
    id,
    name,
    direction,
    description: '',
    pixKey: '',
    branch: 'grupo' as const,
    active: true,
    ...createdAudit('u1'),
  });
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [type('mens', 'Mensalidade', 'income'), type('idf', 'A identificar', 'both')],
    fees: [],
    projects: [],
    transactions: [],
    trash: [],
    monthClosings: [],
    settings: { openingBalance: 0, groupName: 'Arno', mensalidadeDueDay: 10 },
    ...partial,
  };
}

function credit(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'amount'>): Transaction {
  return {
    date: TODAY,
    type: 'income',
    nature: 'variable',
    movementTypeId: 'idf',
    description: 'RECEBIMENTO PIX 12345678900 CARLA EXEMPLO PIX_CRED',
    branch: 'grupo',
    method: 'pix',
    paymentStatus: 'paid',
    paidAt: TODAY,
    externalId: E2E,
    ...createdAudit('u1'),
    ...partial,
  };
}

function proof(partial: Partial<ProofData> = {}): ProofData {
  return {
    kind: 'pix',
    source: 'pdf',
    amount: 0,
    date: TODAY,
    e2e: E2E,
    bank: '',
    payerName: 'CARLA EXEMPLO',
    payerDocument: '',
    payeeName: 'GRUPO ESCOTEIRO ARNO FRIEDRICH',
    payeeDocument: '',
    rawText: '',
    ...partial,
  };
}

/** Associada com mensalidades de mar–dez geradas; devolve a de maio (vence 10/05). */
function withJulia(phone = '(51) 99571-5143') {
  const store = db({ members: [member('julia', 'JÚLIA EXEMPLO')] });
  store.memberGuardians.push({
    id: 'g1',
    memberId: 'julia',
    name: 'CARLA EXEMPLO',
    relationship: 'Mãe',
    email: '',
    phone,
  } as never);
  syncMensalidades(store, 2026, 'u1', '2026-03-01');
  // Março e abril já pagos: a mais antiga em aberto passa a ser maio.
  for (const tx of store.transactions) {
    if (tx.date < '2026-05-01') tx.paymentStatus = 'paid';
  }
  const may = store.transactions.find((item) => item.date === '2026-05-10')!;
  return { store, may };
}

describe('telefone', () => {
  it('normaliza com e sem 55 e nono dígito', () => {
    expect(phoneKey('555195715143')).toBe('5195715143');
    expect(phoneKey('+55 (51) 99571-5143')).toBe('5195715143');
    expect(phoneKey('(51) 9571-5143')).toBe('5195715143');
    expect(phoneKey('123')).toBe('');
  });

  it('acha o associado pelo telefone do responsável', () => {
    const { store } = withJulia();
    expect(membersByPhone(store, '555195715143').map((item) => item.id)).toEqual(['julia']);
    expect(membersByPhone(store, '555199999999')).toEqual([]);
  });
});

describe('reconcileProof', () => {
  it('id do Pix + telefone conhecido + valor da mensalidade → baixa automática', () => {
    const { store, may } = withJulia();
    store.transactions.push(credit({ id: 'pix', amount: may.amount }));
    const outcome = reconcileProof(store, proof({ amount: may.amount }), {
      memberIds: ['julia'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome).toMatchObject({ status: 'matched', creditId: 'pix', memberId: 'julia' });
    expect(outcome.status === 'matched' && outcome.label).toBe('Mensalidade de maio/2026 de Júlia');
    expect(store.transactions.some((item) => item.id === may.id)).toBe(false);
    expect(store.transactions.find((item) => item.id === 'pix')).toMatchObject({
      movementTypeId: 'mens',
      memberId: 'julia',
    });
    // CPF do pagador aprendido para os próximos Pix.
    expect(store.memberAccounts).toEqual([expect.objectContaining({ memberId: 'julia', document: '12345678900' })]);
  });

  it('crédito ainda não sincronizado → aguardando', () => {
    const { store, may } = withJulia();
    const outcome = reconcileProof(store, proof({ amount: may.amount }), {
      memberIds: ['julia'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome.status).toBe('waiting');
  });

  it('com id do Pix, mas crédito só no extrato importado (sem id) → sugere o crédito para conferir', () => {
    const { store, may } = withJulia();
    store.transactions.push(credit({ id: 'csv', amount: may.amount, externalId: undefined }));
    // Pix de outra pessoa, com outro id, não serve de sugestão.
    store.transactions.push(
      credit({ id: 'outro', amount: may.amount, externalId: 'E99999999202605111422zzzZZZ99999' }),
    );
    const outcome = reconcileProof(store, proof({ amount: may.amount, e2e: 'E00416968202605111422aaaAAA11111' }), {
      memberIds: ['julia'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome).toMatchObject({ status: 'review', creditId: 'csv' });
    expect(store.transactions.some((item) => item.id === may.id)).toBe(true);
  });

  it('crédito já identificado → já registrado', () => {
    const { store, may } = withJulia();
    store.transactions.push(
      credit({ id: 'pix', amount: may.amount, movementTypeId: 'mens', description: 'Mensalidade maio 2026' }),
    );
    const outcome = reconcileProof(store, proof({ amount: may.amount }), {
      memberIds: ['julia'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome).toMatchObject({ status: 'already', label: 'Mensalidade maio 2026' });
  });

  it('telefone desconhecido nunca baixa sozinho', () => {
    const { store, may } = withJulia();
    store.transactions.push(credit({ id: 'pix', amount: may.amount }));
    const outcome = reconcileProof(store, proof({ amount: may.amount }), { memberIds: [], userId: 'u1', today: TODAY });
    expect(outcome).toMatchObject({ status: 'review', creditId: 'pix' });
    expect(store.transactions.some((item) => item.id === may.id)).toBe(true);
  });

  it('valor diferente do extrato → revisão', () => {
    const { store, may } = withJulia();
    store.transactions.push(credit({ id: 'pix', amount: may.amount }));
    const outcome = reconcileProof(store, proof({ amount: may.amount + 10 }), {
      memberIds: ['julia'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome.status).toBe('review');
  });

  it('valor que não é de nenhuma mensalidade (ex.: dois meses juntos) → revisão', () => {
    const { store, may } = withJulia();
    store.transactions.push(credit({ id: 'pix', amount: may.amount * 2 }));
    const outcome = reconcileProof(store, proof({ amount: may.amount * 2 }), {
      memberIds: ['julia'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome.status).toBe('review');
  });

  it('dois irmãos com o mesmo valor em aberto → revisão com os nomes', () => {
    const { store, may } = withJulia();
    store.members.push(member('pedro', 'PEDRO EXEMPLO'));
    syncMensalidades(store, 2026, 'u1', '2026-03-01');
    for (const tx of store.transactions) if (tx.date < '2026-05-01') tx.paymentStatus = 'paid';
    store.transactions.push(credit({ id: 'pix', amount: may.amount }));
    const outcome = reconcileProof(store, proof({ amount: may.amount }), {
      memberIds: ['julia', 'pedro'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome).toMatchObject({ status: 'review', memberNames: ['JÚLIA EXEMPLO', 'PEDRO EXEMPLO'] });
    expect(proofReply(outcome, proof({ amount: may.amount }))).toMatch(/de qual associado/);
  });

  it('sem id do Pix só sugere o crédito provável', () => {
    const { store, may } = withJulia();
    store.transactions.push(
      credit({ id: 'ted', amount: may.amount, externalId: undefined, date: '2026-05-12', paidAt: '2026-05-12' }),
    );
    const outcome = reconcileProof(store, proof({ kind: 'ted', e2e: '', amount: may.amount }), {
      memberIds: ['julia'],
      userId: 'u1',
      today: TODAY,
    });
    expect(outcome).toMatchObject({ status: 'review', creditId: 'ted' });
    expect(store.transactions.some((item) => item.id === may.id)).toBe(true);
  });

  it('pagamento para outra conta → recusado', () => {
    const { store } = withJulia();
    const outcome = reconcileProof(
      store,
      proof({ amount: 10, payeeName: 'LOJA X', payeeDocument: '11.111.111/0001-11' }),
      {
        memberIds: ['julia'],
        userId: 'u1',
        today: TODAY,
      },
    );
    expect(payeeCheck(proof({ payeeDocument: '11.111.111/0001-11' }), '12.345.678/0001-90')).toBe('other');
    // Sem GROUP_CNPJ configurado, CNPJ diferente não basta para recusar.
    expect(outcome.status).not.toBe('rejected');
  });
});
