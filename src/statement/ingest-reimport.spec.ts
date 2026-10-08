import { ingestTransactions, type IngestRow } from './ingest';
import { confirmReconciliation } from '../mensalidades/reconciliation';
import { splitTransaction } from '../ledger/split';
import type { DatabaseShape, Member, MovementType, Transaction } from '../shared/types';

function movement(id: string, name: string, direction: MovementType['direction']): MovementType {
  return {
    id,
    name,
    direction,
    description: '',
    pixKey: '',
    branch: 'grupo',
    active: true,
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const ana = {
  id: 'm-ana',
  name: 'ANA SOUZA',
  email: '',
  phone: '',
  branch: 'escoteiro',
  role: 'jovem',
  monthlyFee: 89.5,
  status: 'active',
  joinedAt: '2026-01-01',
  clubeLtc: false,
  origin: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
} as Member;

function freshDb(): DatabaseShape {
  return {
    settings: { openingBalance: 0, groupName: 'Arno', mensalidadeDueDay: 10 },
    movementTypes: [
      movement('mt-id', 'A identificar', 'both'),
      movement('mt-men', 'Mensalidade', 'income'),
      movement('mt-acamp', 'Acampamento', 'both'),
    ],
    members: [ana],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    fees: [],
    projects: [],
    transactions: [],
  };
}

function bankRow(over: Partial<IngestRow> = {}): IngestRow {
  return {
    date: '2026-10-03',
    type: 'income',
    nature: 'variable',
    movementTypeId: 'mt-id',
    description: 'RECEBIMENTO PIX 64588955004 Joao da Silva PIX_CRED',
    amount: 89.5,
    branch: 'grupo',
    method: 'pix',
    importSource: 'pdf',
    ...over,
  };
}

/** Importa, aplica a edição e importa o mesmo extrato de novo; devolve quantos a 2ª importação criou. */
function reimport(edit: (db: DatabaseShape, credit: Transaction) => void, rows = [bankRow()]) {
  const db = freshDb();
  ingestTransactions(db, rows, 'u');
  edit(db, db.transactions[0]);
  const second = ingestTransactions(db, rows, 'u');
  return { db, created: second.created.length };
}

function pendingMensalidade(db: DatabaseShape): Transaction {
  const pending: Transaction = {
    id: 'pend-out',
    date: '2026-10-10',
    type: 'income',
    nature: 'fixed',
    movementTypeId: 'mt-men',
    description: 'Mensalidade Outubro 2026 — ANA SOUZA',
    amount: 89.5,
    branch: 'escoteiro',
    method: 'pix',
    paymentStatus: 'pending',
    memberId: ana.id,
    origin: 'manual',
    createdAt: '2026-03-01T00:00:00.000Z',
  };
  db.transactions.push(pending);
  return pending;
}

describe('reimportação do extrato não duplica lançamentos editados', () => {
  it('grava a linha original do extrato no lançamento importado', () => {
    const db = freshDb();
    ingestTransactions(db, [bankRow()], 'u');
    expect(db.transactions[0]).toMatchObject({
      sourceDate: '2026-10-03',
      sourceDescription: 'RECEBIMENTO PIX 64588955004 Joao da Silva PIX_CRED',
      sourceAmount: 89.5,
    });
  });

  it('sem edição', () => {
    expect(reimport(() => {}).created).toBe(0);
  });

  it('conciliado com mensalidade (data vai para o vencimento e a descrição muda)', () => {
    const { db, created } = reimport((db, credit) => {
      const pending = pendingMensalidade(db);
      confirmReconciliation(db, credit.id, pending.id, 'u');
    });
    expect(created).toBe(0);
    expect(db.transactions).toHaveLength(1);
    expect(db.transactions[0]).toMatchObject({
      date: '2026-10-10',
      description: 'Mensalidade outubro 2026 — ANA SOUZA',
    });
  });

  it('identificado como mensalidade no formulário (data vira competência)', () => {
    const { created } = reimport((_db, credit) => {
      Object.assign(credit, { movementTypeId: 'mt-men', memberId: ana.id, paidAt: credit.date, date: '2026-10-10' });
    });
    expect(created).toBe(0);
  });

  it('descrição reescrita ao identificar', () => {
    const { created } = reimport((_db, credit) => {
      Object.assign(credit, { movementTypeId: 'mt-acamp', description: 'Acampamento de primavera — ANA' });
    });
    expect(created).toBe(0);
  });

  it('valor alterado', () => {
    expect(reimport((_db, credit) => (credit.amount = 82)).created).toBe(0);
  });

  it('rateado em mensalidades de competências diferentes', () => {
    const { db, created } = reimport(
      (db, credit) => {
        splitTransaction(
          db,
          credit.id,
          [
            {
              amount: 89.5,
              movementTypeId: 'mt-men',
              description: 'Mensalidade Outubro 2026 — ANA SOUZA',
              date: '2026-10-10',
            },
            {
              amount: 89.5,
              movementTypeId: 'mt-men',
              description: 'Mensalidade Novembro 2026 — ANA SOUZA',
              date: '2026-11-10',
            },
          ],
          'u',
        );
      },
      [bankRow({ amount: 179 })],
    );
    expect(created).toBe(0);
    expect(db.transactions).toHaveLength(2);
    // A linha do extrato fica só na 1ª parte.
    expect(db.transactions.filter((tx) => tx.sourceDate)).toHaveLength(1);
  });

  it('legado conciliado antes da linha original (usa paidAt e o "Pix:" das observações)', () => {
    const { db, created } = reimport((db, credit) => {
      const pending = pendingMensalidade(db);
      confirmReconciliation(db, credit.id, pending.id, 'u');
      delete credit.sourceDate;
      delete credit.sourceDescription;
      delete credit.sourceAmount;
    });
    expect(created).toBe(0);
    // A reimportação aproveita e grava a linha original no lançamento legado.
    expect(db.transactions[0]?.sourceDate).toBe('2026-10-03');
  });

  it('dois Pix iguais no mesmo dia continuam sendo dois lançamentos', () => {
    const rows = [bankRow(), bankRow()];
    const db = freshDb();
    expect(ingestTransactions(db, rows, 'u').created).toHaveLength(2);
    db.transactions[0].description = 'Acampamento — ANA';
    expect(ingestTransactions(db, rows, 'u').created).toHaveLength(0);
    expect(db.transactions).toHaveLength(2);
  });

  it('um Pix novo no mesmo dia com outro valor ainda entra', () => {
    const { db } = reimport(() => {});
    const result = ingestTransactions(db, [bankRow({ amount: 150 })], 'u');
    expect(result.created).toHaveLength(1);
  });
});
