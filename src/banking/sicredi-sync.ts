import { ensureIdentifyType, ingestTransactions } from '../statement/ingest';
import {
  getBankSyncState,
  listBankMovements,
  markBankMovement,
  saveBankSyncState,
  upsertBankMovements,
} from './bank-store';
import {
  brasiliaDate,
  getReceivedPix,
  listReceivedPix,
  parsePixPayload,
  pixDescription,
  pixDocument,
  sicrediStatus,
  type PixReceived,
} from './sicredi';
import { interpretStatement, isUnidentifiedName, type StatementCatalog } from '../statement/statement';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import type { BankMovement, DatabaseShape } from '../shared/types';
import { roundMoney } from '../shared/types';
import { listUsers } from '../identity/users';
import { notifyStatus, notifyTransaction } from '../notifications/notify';

export type BankMovementView = BankMovement & {
  memberName?: string;
  movementTypeName?: string;
  transactionDescription?: string;
  settlement: 'matched' | 'imported' | 'pending-bank' | 'pending-cash';
};

function catalogOf(db: DatabaseShape): StatementCatalog {
  return {
    movementTypes: db.movementTypes,
    members: db.members.map((member) => ({
      id: member.id,
      name: member.name,
      branch: member.branch,
      monthlyFee: member.monthlyFee,
      clubeLtc: member.clubeLtc,
      status: member.status,
      accounts: db.memberAccounts
        .filter((account) => account.memberId === member.id && account.active)
        .map((account) => ({
          holderName: account.holderName,
          pixKey: account.pixKey,
          document: account.document,
        })),
      guardians: (db.memberGuardians ?? [])
        .filter((guardian) => guardian.memberId === member.id)
        .map((guardian) => ({ id: guardian.id, name: guardian.name })),
    })),
    fees: db.fees,
    pendingPayments: db.transactions
      .filter((tx) => tx.paymentStatus === 'pending' && tx.type === 'income')
      .map((tx) => ({
        id: tx.id,
        memberId: tx.memberId,
        amount: tx.amount,
        date: tx.date,
        movementTypeId: tx.movementTypeId,
      })),
  };
}

export function pixToMovement(pix: PixReceived): Parameters<typeof upsertBankMovements>[0][number] | null {
  const amount = roundMoney(Number(String(pix.valor).replace(',', '.')));
  if (!pix.endToEndId || !Number.isFinite(amount) || amount <= 0) return null;
  const occurredAt = pix.horario || new Date().toISOString();
  return {
    provider: 'sicredi',
    externalId: pix.endToEndId,
    occurredAt,
    date: brasiliaDate(occurredAt),
    amount,
    type: 'income',
    method: 'pix',
    description: pixDescription(pix) || `PIX ${pix.endToEndId}`,
    payerName: pix.pagador?.nome ?? '',
    payerDocument: pixDocument(pix),
    txid: pix.txid ?? '',
  };
}

function csvFromMovements(items: BankMovement[]) {
  const lines = ['data;historico;valor;tipo'];
  for (const item of items) {
    lines.push(`${item.date};${item.description};${String(item.amount).replace('.', ',')};entrada`);
  }
  return lines.join('\n');
}

async function actorUserId(preferred?: string) {
  if (preferred) return preferred;
  const users = await listUsers();
  return (
    users.find((user) => user.role === 'tesoureiro' && user.active)?.id ?? users.find((user) => user.active)?.id ?? ''
  );
}

function decorate(movements: BankMovement[], db: DatabaseShape): BankMovementView[] {
  return movements.map((item) => {
    const tx = item.transactionId ? db.transactions.find((row) => row.id === item.transactionId) : undefined;
    const member = tx?.memberId ? db.members.find((row) => row.id === tx.memberId) : undefined;
    const movementType = tx ? db.movementTypes.find((row) => row.id === tx.movementTypeId) : undefined;
    return {
      ...item,
      memberName: member?.name,
      movementTypeName: movementType?.name,
      transactionDescription: tx?.description,
      settlement: item.status === 'matched' ? 'matched' : item.status === 'imported' ? 'imported' : 'pending-bank',
    };
  });
}

export async function pendingCashWithoutBank(from: string, to: string) {
  const db = await loadDb();
  const bank = await listBankMovements(from, to);
  const linked = new Set(bank.map((item) => item.transactionId).filter(Boolean));
  return db.transactions.filter(
    (tx) =>
      tx.date >= from &&
      tx.date <= to &&
      tx.paymentStatus === 'pending' &&
      tx.type === 'income' &&
      !tx.externalId &&
      !linked.has(tx.id),
  );
}

export async function sicrediOverview(from: string, to: string) {
  const status = sicrediStatus();
  const sync = await getBankSyncState();
  const db = await loadDb();
  const movements = decorate(await listBankMovements(from, to), db);
  const pendingCash = await pendingCashWithoutBank(from, to);
  const bankIncome = roundMoney(movements.reduce((sum, item) => sum + item.amount, 0));
  const reconciled = roundMoney(
    movements.filter((item) => item.status !== 'new').reduce((sum, item) => sum + item.amount, 0),
  );
  return {
    ...status,
    lastSyncAt: sync.lastSyncAt,
    lastError: sync.lastError,
    from,
    to,
    summary: {
      bankCount: movements.length,
      bankIncome,
      matched: movements.filter((item) => item.status === 'matched').length,
      imported: movements.filter((item) => item.status === 'imported').length,
      pendingBank: movements.filter((item) => item.status === 'new').length,
      pendingCash: pendingCash.length,
      reconciled,
    },
    movements,
    pendingCash: pendingCash.map((tx) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      memberName: tx.memberId ? db.members.find((member) => member.id === tx.memberId)?.name : undefined,
    })),
  };
}

export async function syncSicrediPix(options: { from?: string; to?: string; userId?: string; pix?: PixReceived[] }) {
  const status = sicrediStatus();
  if (!status.configured) throw new Error('API Pix do Sicredi ainda não está configurada');

  const toDate = options.to ? new Date(`${options.to}T23:59:59.999-03:00`) : new Date();
  const fromDate = options.from
    ? new Date(`${options.from}T00:00:00.000-03:00`)
    : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = brasiliaDate(fromDate.toISOString());
  const to = brasiliaDate(toDate.toISOString());
  const userId = await actorUserId(options.userId);

  try {
    const pix = options.pix ?? (await listReceivedPix(fromDate, toDate));
    const inputs = pix.map(pixToMovement).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const stored = inputs.length ? await upsertBankMovements(inputs) : [];
    const pending = stored.filter((item) => item.status === 'new');

    const ingest = await mutate((db) => {
      ensureIdentifyType(db, userId);
      if (!pending.length) {
        return {
          created: [] as string[],
          paid: [] as string[],
          unidentified: [] as string[],
          skipped: [] as { description: string; reason: string }[],
        };
      }
      const interpreted = interpretStatement(csvFromMovements(pending), catalogOf(db));
      const identify =
        db.movementTypes.find((item) => item.active && isUnidentifiedName(item.name)) ??
        db.movementTypes.find((item) => item.active && (item.direction === 'both' || item.direction === 'income'));
      const rows = pending.map((item, index) => {
        const suggested = interpreted.rows[index];
        return {
          date: item.date,
          type: suggested?.type ?? item.type,
          nature: suggested?.nature ?? 'variable',
          movementTypeId: suggested?.movementTypeId || identify?.id || '',
          description: item.description,
          amount: item.amount,
          branch: suggested?.branch ?? 'grupo',
          method: 'pix' as const,
          paymentStatus: 'paid' as const,
          memberId: suggested?.memberId,
          memberGuardianId: suggested?.memberGuardianId,
          notes: `Sicredi PIX ${item.externalId}`,
          externalId: item.externalId,
        };
      });
      return ingestTransactions(db, rows, userId, 'sicredi');
    });

    const paidSet = new Set(ingest.paid);
    const createdSet = new Set(ingest.created);
    const db = await loadDb();
    for (const item of pending) {
      // ingestTransactions grava externalId no lançamento reutilizado (extrato sem id do Pix).
      const matchedTx = db.transactions.find((tx) => tx.externalId === item.externalId);
      if (matchedTx && paidSet.has(matchedTx.id)) {
        await markBankMovement(item.externalId, 'matched', matchedTx.id);
      } else if (matchedTx && createdSet.has(matchedTx.id)) {
        await markBankMovement(item.externalId, 'imported', matchedTx.id);
      } else if (matchedTx) {
        await markBankMovement(item.externalId, 'imported', matchedTx.id);
      }
    }

    const overview = await sicrediOverview(from, to);
    const sync = await saveBankSyncState({
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      lastFrom: from,
      lastTo: to,
    });
    if (ingest.paid.length && notifyStatus().email) {
      const user =
        userId || (await listUsers()).find((item) => item.role === 'tesoureiro' || item.role === 'admin')?.id;
      if (user) {
        const fresh = await loadDb();
        for (const txId of ingest.paid) {
          const tx = fresh.transactions.find((item) => item.id === txId);
          if (tx?.memberId) {
            try {
              await notifyTransaction(fresh, tx, 'receipt', ['email'], user);
            } catch (error) {
              console.error('Comprovante após Pix:', error);
            }
          }
        }
      }
    }
    return {
      ...overview,
      lastSyncAt: sync.lastSyncAt,
      fetched: pix.length,
      created: ingest.created.length,
      paid: ingest.paid.length,
      unidentified: ingest.unidentified.length,
      skipped: ingest.skipped.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao consultar o Sicredi';
    await saveBankSyncState({ lastError: message, lastFrom: from, lastTo: to });
    throw error;
  }
}

export async function ingestWebhookPix(body: unknown, userId?: string) {
  const parsed = parsePixPayload(body);
  const complete: PixReceived[] = [];
  for (const item of parsed) {
    if (item.valor) {
      complete.push(item);
      continue;
    }
    const fetched = await getReceivedPix(item.endToEndId);
    if (fetched?.valor) complete.push(fetched);
  }
  if (!complete.length) {
    return syncSicrediPix({ userId });
  }
  return syncSicrediPix({ userId, pix: complete });
}
