import { ensureIdentifyType, ingestTransactions } from '../statement/ingest';
import { brasiliaDate, mockPixReceived, parsePixPayload, pixDescription } from './sicredi';
import { pixToMovement } from './sicredi-sync';
import type { DatabaseShape } from '../shared/types';

function emptyDb(): DatabaseShape {
  return {
    members: [
      {
        id: 'm-ana',
        name: 'Ana Souza',
        email: 'ana@example.com',
        phone: '51',
        branch: 'lobinho',
        role: 'jovem',
        monthlyFee: 55,
        status: 'active',
        joinedAt: '2023-03-11',
        clubeLtc: false,
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    memberGuardians: [
      {
        id: 'g-helena',
        memberId: 'm-ana',
        name: 'Helena Souza',
        relationship: 'Mãe',
        phone: '',
        email: '',
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    memberAccounts: [],
    movementTypes: [
      {
        id: 'mt-men',
        name: 'Mensalidade',
        direction: 'income',
        description: '',
        active: true,
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    fees: [
      {
        id: 'f1',
        name: 'Mensalidade',
        amount: 55,
        origin: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    transactions: [
      {
        id: 'tx-pending',
        date: '2026-09-01',
        type: 'income',
        nature: 'fixed',
        movementTypeId: 'mt-men',
        description: 'Mensalidade Ana',
        amount: 55,
        branch: 'lobinho',
        method: 'pix',
        paymentStatus: 'pending',
        memberId: 'm-ana',
        origin: 'manual',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    projects: [],
    settings: { openingBalance: 0, groupName: 'Arno' },
  };
}

describe('sicredi pix mapping', () => {
  it('parses a webhook payload and builds a bank movement', () => {
    const pix = parsePixPayload({
      pix: [
        {
          endToEndId: 'E0118152120260916T0000000000001',
          valor: '55.00',
          horario: '2026-09-16T18:10:00.000-03:00',
          infoPagador: 'Mensalidade',
          pagador: { nome: 'Helena Souza', cpf: '11144477735' },
        },
      ],
    });
    expect(pix).toHaveLength(1);
    expect(pixDescription(pix[0])).toContain('Helena Souza');
    const movement = pixToMovement(pix[0]);
    expect(movement?.amount).toBe(55);
    expect(movement?.type).toBe('income');
    expect(movement?.date).toBe(brasiliaDate(pix[0].horario));
    expect(mockPixReceived().length).toBeGreaterThan(0);
  });
});

describe('ingestTransactions', () => {
  it('marks pending mensalidade as paid and stores the Pix id', () => {
    const db = emptyDb();
    const result = ingestTransactions(
      db,
      [
        {
          date: '2026-09-16',
          type: 'income',
          nature: 'fixed',
          movementTypeId: 'mt-men',
          description: 'PIX RECEBIDO HELENA SOUZA Mensalidade',
          amount: 55,
          branch: 'lobinho',
          method: 'pix',
          memberId: 'm-ana',
          memberGuardianId: 'g-helena',
          externalId: 'E2E-1',
        },
      ],
      'user-1',
      'sicredi',
    );
    expect(result.paid).toEqual(['tx-pending']);
    expect(db.transactions[0]?.paymentStatus).toBe('paid');
    expect(db.transactions[0]?.date).toBe('2026-09-01');
    expect(db.transactions[0]?.paidAt).toBe('2026-09-16');
    expect(db.transactions[0]?.externalId).toBe('E2E-1');
    expect(result.created).toHaveLength(0);
  });

  it('creates an unidentified cash-flow row when there is no pending fee', () => {
    const db = emptyDb();
    db.transactions = [];
    ensureIdentifyType(db, 'user-1');
    const identify = db.movementTypes.find((item) => item.name === 'A identificar');
    expect(identify).toBeTruthy();
    const result = ingestTransactions(
      db,
      [
        {
          date: '2026-09-16',
          type: 'income',
          nature: 'variable',
          movementTypeId: identify!.id,
          description: 'PIX RECEBIDO Doação avulsa',
          amount: 150,
          branch: 'grupo',
          method: 'pix',
          externalId: 'E2E-2',
        },
      ],
      'user-1',
      'sicredi',
    );
    expect(result.created).toHaveLength(1);
    expect(result.unidentified).toHaveLength(1);
    expect(db.transactions[0]?.origin).toBe('sicredi');
  });

  it('does not duplicate the same launch in one import or a second file', () => {
    const db = emptyDb();
    db.transactions = [];
    const row = {
      date: '2026-09-16',
      type: 'income' as const,
      nature: 'fixed' as const,
      movementTypeId: 'mt-men',
      description: 'PIX RECEBIDO HELENA SOUZA Mensalidade',
      amount: 55,
      branch: 'lobinho' as const,
      method: 'pix' as const,
      memberId: 'm-ana',
    };
    const first = ingestTransactions(
      db,
      [row, { ...row, description: 'pix recebido helena souza mensalidade' }],
      'user-1',
    );
    expect(first.created).toHaveLength(1);
    expect(first.skipped).toHaveLength(1);
    const again = ingestTransactions(db, [{ ...row, externalId: 'FILE-1' }], 'user-1', 'integration');
    expect(again.created).toHaveLength(0);
    expect(again.skipped[0]?.reason).toBe('Lançamento já importado');
    expect(db.transactions[0]?.externalId).toBe('FILE-1');
  });

  it('links Sicredi Pix to a prior PDF/CSV import with different historico', () => {
    const db = emptyDb();
    db.transactions = [];
    ensureIdentifyType(db, 'user-1');
    const identify = db.movementTypes.find((item) => item.name === 'A identificar')!;
    const fromPdf = ingestTransactions(
      db,
      [
        {
          date: '2026-01-05',
          type: 'income',
          nature: 'variable',
          movementTypeId: identify.id,
          description: 'RECEBIMENTO PIX 11111111111 JOANA EXEMPLO PIX_CRED',
          amount: 60,
          branch: 'grupo',
          method: 'pix',
        },
      ],
      'user-1',
      'integration',
    );
    expect(fromPdf.created).toHaveLength(1);
    expect(db.transactions[0]?.externalId).toBeUndefined();

    const fromApi = ingestTransactions(
      db,
      [
        {
          date: '2026-01-05',
          type: 'income',
          nature: 'variable',
          movementTypeId: identify.id,
          description: 'PIX RECEBIDO JOANA EXEMPLO',
          amount: 60,
          branch: 'grupo',
          method: 'pix',
          externalId: 'E2E-PDF-1',
        },
      ],
      'user-1',
      'sicredi',
    );
    expect(fromApi.created).toHaveLength(0);
    expect(fromApi.skipped[0]?.reason).toBe('Lançamento já importado');
    expect(db.transactions).toHaveLength(1);
    expect(db.transactions[0]?.externalId).toBe('E2E-PDF-1');
  });

  it('does not merge two same-day incomes from different payers', () => {
    const db = emptyDb();
    db.transactions = [];
    ensureIdentifyType(db, 'user-1');
    const identify = db.movementTypes.find((item) => item.name === 'A identificar')!;
    ingestTransactions(
      db,
      [
        {
          date: '2026-01-05',
          type: 'income',
          nature: 'variable',
          movementTypeId: identify.id,
          description: 'RECEBIMENTO PIX JOANA EXEMPLO PIX_CRED',
          amount: 60,
          branch: 'grupo',
          method: 'pix',
        },
      ],
      'user-1',
    );
    const second = ingestTransactions(
      db,
      [
        {
          date: '2026-01-05',
          type: 'income',
          nature: 'variable',
          movementTypeId: identify.id,
          description: 'PIX RECEBIDO MARIA SILVA',
          amount: 60,
          branch: 'grupo',
          method: 'pix',
          externalId: 'E2E-OTHER',
        },
      ],
      'user-1',
      'sicredi',
    );
    expect(second.created).toHaveLength(1);
    expect(db.transactions).toHaveLength(2);
  });

  it('skips statement reimport after Sicredi already stored the Pix id', () => {
    const db = emptyDb();
    db.transactions = [];
    ensureIdentifyType(db, 'user-1');
    const identify = db.movementTypes.find((item) => item.name === 'A identificar')!;
    ingestTransactions(
      db,
      [
        {
          date: '2026-01-05',
          type: 'income',
          nature: 'variable',
          movementTypeId: identify.id,
          description: 'PIX RECEBIDO JOANA EXEMPLO',
          amount: 60,
          branch: 'grupo',
          method: 'pix',
          externalId: 'E2E-FIRST',
        },
      ],
      'user-1',
      'sicredi',
    );
    const again = ingestTransactions(
      db,
      [
        {
          date: '2026-01-05',
          type: 'income',
          nature: 'variable',
          movementTypeId: identify.id,
          description: 'RECEBIMENTO PIX 11111111111 JOANA EXEMPLO PIX_CRED',
          amount: 60,
          branch: 'grupo',
          method: 'pix',
        },
      ],
      'user-1',
      'integration',
    );
    expect(again.created).toHaveLength(0);
    expect(db.transactions).toHaveLength(1);
    expect(db.transactions[0]?.externalId).toBe('E2E-FIRST');
  });
});
