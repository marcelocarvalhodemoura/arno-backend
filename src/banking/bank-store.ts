import { pool } from '../shared/db';
import { id } from '../shared/id';
import type { BankMovement, BankMovementStatus } from '../shared/types';

type MovementInput = Omit<BankMovement, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'transactionId'> & {
  status?: BankMovementStatus;
  transactionId?: string;
};

function mapMovement(row: Record<string, unknown>): BankMovement {
  return {
    id: String(row.id),
    provider: 'sicredi',
    externalId: String(row.external_id),
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    date: String(row.date).slice(0, 10),
    amount: Number(row.amount),
    type: row.type === 'expense' ? 'expense' : 'income',
    method: 'pix',
    description: String(row.description),
    payerName: String(row.payer_name ?? ''),
    payerDocument: String(row.payer_document ?? ''),
    txid: String(row.txid ?? ''),
    status: (row.status as BankMovementStatus) ?? 'new',
    transactionId: row.transaction_id ? String(row.transaction_id) : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at
      ? row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at)
      : undefined,
  };
}

export async function upsertBankMovements(items: MovementInput[]) {
  const upserted: BankMovement[] = [];
  for (const item of items) {
    const result = await pool.query(
      `INSERT INTO bank_movements (
         id, provider, external_id, occurred_at, date, amount, type, method, description,
         payer_name, payer_document, txid, status, transaction_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (external_id) DO UPDATE SET
         occurred_at = EXCLUDED.occurred_at,
         date = EXCLUDED.date,
         amount = EXCLUDED.amount,
         type = EXCLUDED.type,
         description = EXCLUDED.description,
         payer_name = EXCLUDED.payer_name,
         payer_document = EXCLUDED.payer_document,
         txid = EXCLUDED.txid,
         updated_at = NOW()
       RETURNING *`,
      [
        id(),
        item.provider,
        item.externalId,
        item.occurredAt,
        item.date,
        item.amount,
        item.type,
        item.method,
        item.description,
        item.payerName,
        item.payerDocument,
        item.txid,
        item.status ?? 'new',
        item.transactionId ?? null,
      ],
    );
    upserted.push(mapMovement(result.rows[0]));
  }
  return upserted;
}

export async function listBankMovements(from: string, to: string) {
  const result = await pool.query(
    `SELECT * FROM bank_movements
     WHERE date BETWEEN $1 AND $2
     ORDER BY occurred_at DESC, created_at DESC`,
    [from, to],
  );
  return result.rows.map(mapMovement);
}

export async function markBankMovement(externalId: string, status: BankMovementStatus, transactionId?: string) {
  const result = await pool.query(
    `UPDATE bank_movements
     SET status = $2, transaction_id = COALESCE($3, transaction_id), updated_at = NOW()
     WHERE external_id = $1
     RETURNING *`,
    [externalId, status, transactionId ?? null],
  );
  return result.rows[0] ? mapMovement(result.rows[0]) : undefined;
}

export async function getBankSyncState(provider = 'sicredi') {
  const result = await pool.query(`SELECT * FROM bank_sync_state WHERE provider = $1`, [provider]);
  const row = result.rows[0];
  if (!row)
    return {
      provider,
      lastSyncAt: undefined,
      lastError: undefined,
      lastFrom: undefined,
      lastTo: undefined,
    };
  return {
    provider,
    lastSyncAt: row.last_sync_at
      ? row.last_sync_at instanceof Date
        ? row.last_sync_at.toISOString()
        : String(row.last_sync_at)
      : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    lastFrom: row.last_from ? String(row.last_from).slice(0, 10) : undefined,
    lastTo: row.last_to ? String(row.last_to).slice(0, 10) : undefined,
  };
}

export async function saveBankSyncState(input: {
  provider?: string;
  lastSyncAt?: string;
  lastError?: string | null;
  lastFrom?: string;
  lastTo?: string;
}) {
  await pool.query(
    `INSERT INTO bank_sync_state (provider, last_sync_at, last_error, last_from, last_to, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (provider) DO UPDATE SET
       last_sync_at = COALESCE(EXCLUDED.last_sync_at, bank_sync_state.last_sync_at),
       last_error = EXCLUDED.last_error,
       last_from = COALESCE(EXCLUDED.last_from, bank_sync_state.last_from),
       last_to = COALESCE(EXCLUDED.last_to, bank_sync_state.last_to),
       updated_at = NOW()`,
    [
      input.provider ?? 'sicredi',
      input.lastSyncAt ?? null,
      input.lastError ?? null,
      input.lastFrom ?? null,
      input.lastTo ?? null,
    ],
  );
  return getBankSyncState(input.provider ?? 'sicredi');
}
