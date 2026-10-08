import { findReimportDuplicates } from './reimport-duplicates';
import type { DatabaseShape, MovementType, Transaction } from '../shared/types';

function movement(id: string, name: string): MovementType {
  return {
    id,
    name,
    direction: 'both',
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const PIX = 'RECEBIMENTO PIX 64588955004 Joao da Silva PIX_CRED';

function tx(partial: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    date: '2026-10-03',
    type: 'income',
    nature: 'variable',
    movementTypeId: 'mt-id',
    description: PIX,
    amount: 89.5,
    branch: 'grupo',
    method: 'pix',
    paymentStatus: 'paid',
    paidAt: '2026-10-03',
    origin: 'integration',
    createdAt: '2026-10-04T12:00:00.000Z',
    ...partial,
  };
}

/** Conciliado antes da correção: data no vencimento, descrição reescrita, Pix nas observações. */
const reconciled = (id: string, createdAt = '2026-10-04T12:00:00.000Z') =>
  tx({
    id,
    createdAt,
    movementTypeId: 'mt-men',
    memberId: 'm-ana',
    date: '2026-10-10',
    description: 'Mensalidade outubro 2026 — ANA SOUZA',
    notes: `Pix: ${PIX}`,
  });

function db(transactions: Transaction[]): DatabaseShape {
  return {
    settings: { openingBalance: 0, groupName: 'Arno' },
    movementTypes: [movement('mt-id', 'A identificar'), movement('mt-men', 'Mensalidade')],
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    fees: [],
    projects: [],
    transactions,
  };
}

describe('findReimportDuplicates', () => {
  it('acha o "A identificar" que a reimportação criou para um Pix já conciliado', () => {
    const pairs = findReimportDuplicates(
      db([reconciled('orig'), tx({ id: 'copy', createdAt: '2026-10-07T18:00:00.000Z' })]),
    );
    expect(pairs.map((pair) => [pair.keep.id, pair.copy.id])).toEqual([['orig', 'copy']]);
  });

  it('acha cópia de lançamento com descrição reescrita pela linha original gravada', () => {
    const edited = tx({
      id: 'orig',
      movementTypeId: 'mt-men',
      description: 'Acampamento — ANA',
      sourceDate: '2026-10-03',
      sourceDescription: PIX,
      sourceAmount: 89.5,
    });
    const pairs = findReimportDuplicates(db([edited, tx({ id: 'copy', createdAt: '2026-10-07T18:00:00.000Z' })]));
    expect(pairs).toHaveLength(1);
  });

  it('não junta dois Pix iguais da mesma importação (um conciliado, outro ainda sem tipo)', () => {
    expect(
      findReimportDuplicates(db([reconciled('a'), tx({ id: 'b', createdAt: '2026-10-04T12:00:00.000Z' })])),
    ).toEqual([]);
  });

  it('cada lançamento entra em um par só', () => {
    const pairs = findReimportDuplicates(
      db([
        reconciled('orig'),
        tx({ id: 'copy1', createdAt: '2026-10-07T18:00:00.000Z' }),
        tx({ id: 'copy2', createdAt: '2026-10-08T18:00:00.000Z' }),
      ]),
    );
    expect(pairs.map((pair) => pair.copy.id)).toEqual(['copy1']);
  });

  it('ignora valor diferente, cópia já identificada e fora do período', () => {
    const base = [reconciled('orig')];
    expect(
      findReimportDuplicates(db([...base, tx({ id: 'c', amount: 50, createdAt: '2026-10-07T18:00:00.000Z' })])),
    ).toEqual([]);
    expect(
      findReimportDuplicates(db([...base, tx({ id: 'c', memberId: 'm-ana', createdAt: '2026-10-07T18:00:00.000Z' })])),
    ).toEqual([]);
    expect(
      findReimportDuplicates(db([...base, tx({ id: 'c', createdAt: '2026-10-07T18:00:00.000Z' })]), {
        from: '2026-11-01',
      }),
    ).toEqual([]);
  });
});
