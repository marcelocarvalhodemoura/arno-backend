import { fold } from '../shared/csv';
import { createdAudit, updatedAudit } from '../shared/audit';
import { amountsNear, matchesMensalidadeAmount } from '../mensalidades/fee-table';
import { id } from '../shared/id';
import { isMensalidadeName, isUnidentifiedName } from './statement';
import type { DatabaseShape, RecordOrigin, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';

export type IngestRow = {
  date: string;
  type: Transaction['type'];
  nature: Transaction['nature'];
  movementTypeId: string;
  description: string;
  amount: number;
  branch: Transaction['branch'];
  method: Transaction['method'];
  paymentStatus?: Transaction['paymentStatus'];
  memberId?: string;
  memberGuardianId?: string;
  notes?: string;
  externalId?: string;
};

export type IngestResult = {
  created: string[];
  paid: string[];
  unidentified: string[];
  skipped: { description: string; reason: string }[];
};

function isMensalidadeMovement(db: DatabaseShape, movementTypeId: string) {
  const movement = db.movementTypes.find((item) => item.id === movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

function resolveGuardianId(db: DatabaseShape, memberId: string | undefined, guardianId: string | undefined) {
  if (!guardianId) return undefined;
  if (!memberId) throw new Error('Informe o associado do responsável');
  const guardian = (db.memberGuardians ?? []).find((item) => item.id === guardianId && item.memberId === memberId);
  if (!guardian) throw new Error('Responsável não pertence a este associado');
  return guardian.id;
}

export function ensureIdentifyType(db: DatabaseShape, userId: string, origin: RecordOrigin = 'integration') {
  if (db.movementTypes.some((item) => item.active && isUnidentifiedName(item.name))) return;
  db.movementTypes.push({
    id: id(),
    name: 'A identificar',
    direction: 'both',
    description: 'Lançamento importado do extrato, ainda sem tipo definido',
    pixKey: '',
    branch: 'grupo',
    active: true,
    ...createdAudit(userId, origin === 'sicredi' ? 'integration' : origin),
  });
}

/** Normaliza histórico de Pix (PDF Sicredi vs API) para comparar o mesmo recebimento. */
export function normalizePixDescription(description: string): string {
  return fold(description)
    .replace(/\brecebimento\s+pix\b/g, ' ')
    .replace(/\bpix\s+recebido\b/g, ' ')
    .replace(/\bpix_cred\b/g, ' ')
    .replace(/\bpix\b/g, ' ')
    .replace(/\b\d{11}\b/g, ' ')
    .replace(/\b\d{14}\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function descriptionsCompatible(left: string, right: string): boolean {
  const a = normalizePixDescription(left);
  const b = normalizePixDescription(right);
  if (!a || !b) return true;
  if (a === b) return true;
  const tokensA = new Set(a.split(' ').filter((token) => token.length > 2));
  const tokensB = new Set(b.split(' ').filter((token) => token.length > 2));
  if (!tokensA.size || !tokensB.size) return true;
  for (const token of tokensA) {
    if (tokensB.has(token)) return true;
  }
  return false;
}

function contentFingerprint(row: {
  date: string;
  type: string;
  description: string;
  amount: number;
  memberId?: string;
}) {
  return `${row.date}|${row.type}|${row.amount}|${normalizePixDescription(row.description)}|${row.memberId ?? ''}`;
}

function ingestFingerprint(row: {
  date: string;
  type: string;
  description: string;
  amount: number;
  memberId?: string;
  externalId?: string;
}) {
  if (row.externalId) return `ext:${row.externalId}`;
  return contentFingerprint(row);
}

function scoreReusable(tx: Transaction, row: IngestRow): number {
  let score = 0;
  if (!tx.externalId) score += 4;
  if (row.memberId && tx.memberId === row.memberId) score += 3;
  if (normalizePixDescription(tx.description) === normalizePixDescription(row.description)) score += 2;
  if (tx.origin === 'integration') score += 1;
  if ((tx.paymentStatus ?? 'paid') === 'paid') score += 1;
  return score;
}

/** Casa extrato (sem endToEndId) com Pix Sicredi (com id) quando data/valor/histórico batem. */
export function findReusableTransaction(
  db: DatabaseShape,
  row: Pick<IngestRow, 'date' | 'type' | 'description' | 'amount' | 'memberId' | 'externalId'>,
): Transaction | undefined {
  const amount = roundMoney(row.amount);
  const candidates = db.transactions.filter((tx) => {
    if (tx.date !== row.date || tx.type !== row.type) return false;
    if (!amountsNear(tx.amount, amount)) return false;
    if (tx.externalId && row.externalId && tx.externalId !== row.externalId) return false;
    if (tx.externalId && !row.externalId) {
      // Reimportação de extrato após Sicredi: não cria outro se o histórico for compatível.
    } else if (!tx.externalId && !row.externalId) {
      // Dois lançamentos sem id: só reusa se o conteúdo for o mesmo (já coberto pelo fingerprint).
      return false;
    }
    if (row.memberId && tx.memberId && row.memberId !== tx.memberId) return false;
    return descriptionsCompatible(tx.description, row.description);
  });
  if (!candidates.length) return undefined;
  return [...candidates].sort((a, b) => scoreReusable(b, row as IngestRow) - scoreReusable(a, row as IngestRow))[0];
}

function attachIncomingIds(tx: Transaction, row: IngestRow, memberGuardianId: string | undefined, userId: string) {
  let changed = false;
  if (row.externalId && !tx.externalId) {
    tx.externalId = row.externalId;
    changed = true;
  }
  if (row.memberId && !tx.memberId) {
    tx.memberId = row.memberId;
    changed = true;
  }
  if (memberGuardianId && !tx.memberGuardianId) {
    tx.memberGuardianId = memberGuardianId;
    changed = true;
  }
  if (row.method && !tx.method) {
    tx.method = row.method;
    changed = true;
  }
  if (changed) Object.assign(tx, updatedAudit(userId));
}

export function ingestTransactions(
  db: DatabaseShape,
  rows: IngestRow[],
  userId: string,
  origin: RecordOrigin = 'integration',
): IngestResult {
  const created: string[] = [];
  const paid: string[] = [];
  const unidentified: string[] = [];
  const skipped: { description: string; reason: string }[] = [];
  const seen = new Set<string>();
  const byContent = new Map<string, Transaction>();

  for (const tx of db.transactions) {
    rememberIngest(seen, tx);
    const key = contentFingerprint({
      date: tx.date,
      type: tx.type,
      description: tx.description,
      amount: roundMoney(tx.amount),
      memberId: tx.memberId,
    });
    if (!byContent.has(key)) byContent.set(key, tx);
  }

  for (const row of rows) {
    const movement = db.movementTypes.find((item) => item.id === row.movementTypeId);
    if (!movement || !movement.active) throw new Error('Tipo de movimentação inválido');
    if (movement.direction !== 'both' && movement.direction !== row.type) {
      throw new Error(`O tipo ${movement.name} não aceita essa direção`);
    }
    const memberGuardianId = resolveGuardianId(db, row.memberId, row.memberGuardianId);
    const amount = roundMoney(row.amount);
    const contentKey = contentFingerprint({
      date: row.date,
      type: row.type,
      description: row.description,
      amount,
      memberId: row.memberId,
    });
    const extKey = row.externalId ? `ext:${row.externalId}` : '';
    if (extKey && seen.has(extKey)) {
      skipped.push({
        description: row.description,
        reason: 'Pix já conciliado',
      });
      continue;
    }
    if (seen.has(contentKey)) {
      const existing = byContent.get(contentKey) ?? findReusableTransaction(db, { ...row, amount });
      if (existing) {
        attachIncomingIds(existing, row, memberGuardianId, userId);
        rememberIngest(seen, existing);
        byContent.set(contentKey, existing);
      }
      skipped.push({
        description: row.description,
        reason: 'Lançamento já importado',
      });
      continue;
    }

    const reusable = findReusableTransaction(db, { ...row, amount });
    if (reusable && (row.externalId || reusable.externalId)) {
      attachIncomingIds(reusable, row, memberGuardianId, userId);
      rememberIngest(seen, reusable);
      byContent.set(contentKey, reusable);
      skipped.push({
        description: row.description,
        reason: 'Lançamento já importado',
      });
      continue;
    }

    if (row.type === 'income' && row.memberId && isMensalidadeName(movement.name)) {
      const month = row.date.slice(0, 7);
      const member = db.members.find((item) => item.id === row.memberId);
      const pending = db.transactions
        .filter(
          (tx) =>
            tx.paymentStatus === 'pending' &&
            tx.type === 'income' &&
            tx.memberId === row.memberId &&
            isMensalidadeMovement(db, tx.movementTypeId) &&
            (amountsNear(tx.amount, amount) || (member ? matchesMensalidadeAmount(member, amount) : false)),
        )
        .sort((a, b) => {
          const aSame = a.date.startsWith(month) ? 0 : 1;
          const bSame = b.date.startsWith(month) ? 0 : 1;
          if (aSame !== bSame) return aSame - bSame;
          return a.date.localeCompare(b.date);
        })[0];
      if (pending) {
        pending.paymentStatus = 'paid';
        pending.paidAt = row.date;
        pending.amount = amount;
        pending.method = row.method ?? pending.method;
        if (row.externalId && !pending.externalId) pending.externalId = row.externalId;
        if (memberGuardianId && !pending.memberGuardianId) pending.memberGuardianId = memberGuardianId;
        Object.assign(pending, updatedAudit(userId));
        paid.push(pending.id);
        rememberIngest(seen, pending);
        continue;
      }
      if (
        db.transactions.some(
          (tx) =>
            tx.paymentStatus === 'paid' &&
            tx.type === 'income' &&
            tx.memberId === row.memberId &&
            isMensalidadeMovement(db, tx.movementTypeId) &&
            (tx.date === row.date || tx.date.startsWith(month)),
        )
      ) {
        const paidTx = db.transactions.find(
          (tx) =>
            tx.paymentStatus === 'paid' &&
            tx.type === 'income' &&
            tx.memberId === row.memberId &&
            isMensalidadeMovement(db, tx.movementTypeId) &&
            (tx.date === row.date || tx.date.startsWith(month)),
        );
        if (paidTx && row.externalId && !paidTx.externalId) paidTx.externalId = row.externalId;
        if (paidTx) rememberIngest(seen, paidTx);
        skipped.push({
          description: row.description,
          reason: 'Mensalidade já está paga neste período',
        });
        continue;
      }
    }
    const tx: Transaction = {
      id: id(),
      date: row.date,
      type: row.type,
      nature: row.nature,
      movementTypeId: row.movementTypeId,
      description: row.description,
      amount,
      branch: row.branch,
      method: row.method,
      paymentStatus: row.paymentStatus ?? 'paid',
      memberId: row.memberId,
      memberGuardianId,
      notes: row.notes,
      externalId: row.externalId,
      ...createdAudit(userId, origin),
    };
    if ((tx.paymentStatus ?? 'paid') === 'paid') tx.paidAt = row.date;
    if (!memberGuardianId) delete tx.memberGuardianId;
    if (!tx.memberId) delete tx.memberId;
    if (!tx.notes) delete tx.notes;
    if (!tx.externalId) delete tx.externalId;
    db.transactions.push(tx);
    created.push(tx.id);
    rememberIngest(seen, { ...row, amount });
    byContent.set(contentKey, tx);
    if (isUnidentifiedName(movement.name)) unidentified.push(tx.id);
  }

  return { created, paid, unidentified, skipped };
}

function rememberIngest(
  seen: Set<string>,
  row: {
    date: string;
    type: string;
    description: string;
    amount: number;
    memberId?: string;
    externalId?: string;
  },
) {
  seen.add(ingestFingerprint(row));
  if (row.externalId) {
    seen.add(contentFingerprint(row));
  }
}
