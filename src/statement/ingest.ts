import { fold } from '../shared/csv';
import { createdAudit, updatedAudit } from '../shared/audit';
import { amountsNear, matchesMensalidadeAmount, scheduleOf } from '../mensalidades/fee-table';
import { id } from '../shared/id';
import { isMensalidadeName, isUnidentifiedName } from './statement';
import type { DatabaseShape, ImportSource, RecordOrigin, Transaction } from '../shared/types';
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
  importSource?: ImportSource;
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

/** Normaliza histórico de Pix (PDF Sicredi vs API / rateio) para comparar o mesmo recebimento. */
export function normalizePixDescription(description: string): string {
  let text = fold(description);
  const wrapped = text.match(/^.+?\s·\sparte\s+\d+\s*\/\s*\d+\s*·\s*r\$\s*[\d.,]+\s*de\s*r\$\s*[\d.,]+\s*·\s*(.+)$/);
  if (wrapped?.[1]) text = wrapped[1];
  text = text.replace(/\s*-\s*[a-z]+$/i, ' ');
  return text
    .replace(/\brecebimento\s+pix\b/g, ' ')
    .replace(/\bpix\s+recebido\b/g, ' ')
    .replace(/\bpix_cred\b/g, ' ')
    .replace(/\bpix_deb\b/g, ' ')
    .replace(/\bpix\b/g, ' ')
    .replace(/\b\d{11}\b/g, ' ')
    .replace(/\b\d{14}\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBankStatementLine(description: string): boolean {
  const text = fold(description);
  return (
    /\bpix_cred\b/.test(text) ||
    /\bpix_deb\b/.test(text) ||
    /\brecebimento\s+pix\b/.test(text) ||
    /\bpix\s+recebido\b/.test(text) ||
    /\bpagamento\s+pix\b/.test(text) ||
    /\bdevolucao\s+pix\b/.test(text)
  );
}

function descriptionsCompatible(left: string, right: string): boolean {
  const a = normalizePixDescription(left);
  const b = normalizePixDescription(right);
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const tokensA = new Set(a.split(' ').filter((token) => token.length > 2));
  const tokensB = new Set(b.split(' ').filter((token) => token.length > 2));
  if (!tokensA.size || !tokensB.size) return true;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return overlap >= Math.min(2, Math.min(tokensA.size, tokensB.size));
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

function softContentKey(row: { date: string; type: string; description: string; amount: number }) {
  return `soft:${row.date}|${row.type}|${roundMoney(row.amount)}|${normalizePixDescription(row.description)}`;
}

function effectiveMatchAmount(tx: Transaction): number {
  if (tx.splitTotal != null && Number(tx.splitTotal) > 0) return roundMoney(Number(tx.splitTotal));
  return roundMoney(tx.amount);
}

function datesOf(tx: Transaction, db: DatabaseShape): Set<string> {
  if (!tx.splitGroupId) return new Set([tx.date]);
  return new Set(db.transactions.filter((item) => item.splitGroupId === tx.splitGroupId).map((item) => item.date));
}

/** Um jeito de enxergar o lançamento como a linha do extrato que o gerou. */
type MatchView = { date: string; description: string; amount: number };

/** Histórico do Pix que a conciliação guarda nas observações ("Pix: ...") ao reescrever a descrição. */
function pixLineFromNotes(tx: Transaction): string {
  const line = (tx.notes ?? '')
    .split('\n')
    .reverse()
    .find((item) => item.startsWith('Pix: '));
  return line ? line.slice(5).trim() : '';
}

/**
 * Datas, históricos e valores pelos quais a reimportação reconhece o lançamento.
 * - Como está hoje (todas as datas do rateio).
 * - Linha original do extrato (source*), gravada na importação e nunca editada.
 * - Legado sem source*: a conciliação move a data para o vencimento e reescreve a descrição,
 *   mas deixa a data do Pix em paidAt e o histórico nas observações.
 */
export function matchViews(tx: Transaction, db: DatabaseShape): MatchView[] {
  const amount = effectiveMatchAmount(tx);
  const dates = [...datesOf(tx, db)];
  const paidAt = tx.paidAt?.slice(0, 10);
  if (paidAt && !dates.includes(paidAt)) dates.push(paidAt);
  const pixLine = pixLineFromNotes(tx);
  const descriptions = pixLine ? [tx.description, pixLine] : [tx.description];
  const views: MatchView[] = dates.flatMap((date) =>
    descriptions.map((description) => ({ date, description, amount })),
  );
  if (tx.sourceDate && tx.sourceDescription && tx.sourceAmount != null) {
    views.push({ date: tx.sourceDate, description: tx.sourceDescription, amount: roundMoney(tx.sourceAmount) });
  }
  const unique = new Map(views.map((view) => [`${view.date}|${view.amount}|${view.description}`, view]));
  return [...unique.values()];
}

function sameSourceLine(tx: Transaction, row: Pick<IngestRow, 'date' | 'description'>): boolean {
  return (
    tx.sourceDate === row.date &&
    Boolean(tx.sourceDescription) &&
    normalizePixDescription(tx.sourceDescription ?? '') === normalizePixDescription(row.description)
  );
}

function scoreReusable(tx: Transaction, row: IngestRow): number {
  let score = 0;
  if (sameSourceLine(tx, row)) score += 10;
  if (tx.splitIndex === 1) score += 6;
  if (tx.splitGroupId) score += 4;
  if (!tx.externalId) score += 3;
  if (row.memberId && tx.memberId === row.memberId) score += 3;
  if (normalizePixDescription(tx.description) === normalizePixDescription(row.description)) score += 2;
  if (tx.origin === 'integration' || tx.origin === 'sicredi') score += 1;
  if ((tx.paymentStatus ?? 'paid') === 'paid') score += 1;
  return score;
}

/** Casa extrato/PDF com lançamento já conciliado (inclui rateio pelo valor original). */
export function findReusableTransaction(
  db: DatabaseShape,
  row: Pick<IngestRow, 'date' | 'type' | 'description' | 'amount' | 'memberId' | 'externalId'>,
  claimedIds?: Set<string>,
): Transaction | undefined {
  const amount = roundMoney(row.amount);
  const candidates = db.transactions.filter((tx) => {
    if (claimedIds?.has(tx.id)) return false;
    if (tx.type !== row.type) return false;
    if (tx.externalId && row.externalId && tx.externalId !== row.externalId) return false;
    if (row.memberId && tx.memberId && row.memberId !== tx.memberId && !tx.splitGroupId) return false;
    return matchViews(tx, db).some((view) => {
      if (view.date !== row.date) return false;
      if (!amountsNear(view.amount, amount) && !amountsNear(tx.amount, amount)) return false;
      if (!tx.externalId && !row.externalId) {
        // Reimportação de extrato após rateio/edição: histórico bancário compatível.
        if (!isBankStatementLine(row.description) && !isBankStatementLine(view.description)) return false;
      }
      return descriptionsCompatible(view.description, row.description);
    });
  });
  if (!candidates.length) return undefined;
  const best = [...candidates].sort(
    (a, b) => scoreReusable(b, row as IngestRow) - scoreReusable(a, row as IngestRow),
  )[0];
  if (!best?.splitGroupId) return best;
  const primary =
    db.transactions.find((item) => item.splitGroupId === best.splitGroupId && item.splitIndex === 1) ?? best;
  if (claimedIds?.has(primary.id)) return undefined;
  return primary;
}

/** Grava a linha do extrato no lançamento que ainda não a tem (importações anteriores a source*). */
function stampSourceLine(tx: Transaction, row: Pick<IngestRow, 'date' | 'description' | 'amount'>): boolean {
  if (tx.sourceDate) return false;
  tx.sourceDate = row.date;
  tx.sourceDescription = row.description;
  tx.sourceAmount = roundMoney(row.amount);
  return true;
}

function attachIncomingIds(tx: Transaction, row: IngestRow, memberGuardianId: string | undefined, userId: string) {
  let changed = stampSourceLine(tx, row);
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
  if (row.importSource && !tx.importSource) {
    tx.importSource = row.importSource;
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
  const seenExt = new Set<string>();
  const byContent = new Map<string, Transaction>();
  /** Quantos lançamentos iguais (data/tipo/valor/histórico) já existem no caixa. */
  const softExisting = new Map<string, number>();
  /** Quantos iguais já foram consumidos nesta importação (match com o que já está no caixa). */
  const softConsumed = new Map<string, number>();
  /** Evita que dois PIX iguais do extrato casem com o mesmo lançamento já existente. */
  const claimedIds = new Set<string>();

  for (const tx of db.transactions) {
    if (tx.externalId) seenExt.add(`ext:${tx.externalId}`);
    const softKeys = new Set<string>();
    for (const view of matchViews(tx, db)) {
      const key = contentFingerprint({ ...view, type: tx.type, memberId: tx.memberId });
      if (!byContent.has(key)) byContent.set(key, tx);
      softKeys.add(softContentKey({ ...view, type: tx.type }));
    }
    // Cada lançamento conta uma vez por chave, mesmo visto por mais de uma data/histórico.
    for (const soft of softKeys) softExisting.set(soft, (softExisting.get(soft) ?? 0) + 1);
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
    const softKey = softContentKey({
      date: row.date,
      type: row.type,
      description: row.description,
      amount,
    });
    const extKey = row.externalId ? `ext:${row.externalId}` : '';
    if (extKey && seenExt.has(extKey)) {
      skipped.push({
        description: row.description,
        reason: 'Pix já conciliado',
      });
      continue;
    }

    const already = softExisting.get(softKey) ?? 0;
    const consumed = softConsumed.get(softKey) ?? 0;
    if (consumed < already) {
      const fromContent = byContent.get(contentKey);
      const existing =
        (fromContent && !claimedIds.has(fromContent.id) ? fromContent : undefined) ??
        findReusableTransaction(db, { ...row, amount }, claimedIds);
      if (existing) {
        attachIncomingIds(existing, row, memberGuardianId, userId);
        byContent.set(contentKey, existing);
        claimedIds.add(existing.id);
      }
      softConsumed.set(softKey, consumed + 1);
      skipped.push({
        description: row.description,
        reason: 'Lançamento já importado',
      });
      continue;
    }

    const reusable = findReusableTransaction(db, { ...row, amount }, claimedIds);
    if (reusable) {
      attachIncomingIds(reusable, row, memberGuardianId, userId);
      byContent.set(contentKey, reusable);
      claimedIds.add(reusable.id);
      softConsumed.set(softKey, consumed + 1);
      softExisting.set(softKey, Math.max(already, consumed + 1));
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
            (amountsNear(tx.amount, amount) ||
              (member ? matchesMensalidadeAmount(member, amount, scheduleOf(db)) : false)),
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
        if (row.importSource && !pending.importSource) pending.importSource = row.importSource;
        stampSourceLine(pending, { ...row, amount });
        Object.assign(pending, updatedAudit(userId));
        paid.push(pending.id);
        softConsumed.set(softKey, (softConsumed.get(softKey) ?? 0) + 1);
        softExisting.set(softKey, (softExisting.get(softKey) ?? 0) + 1);
        if (pending.externalId) seenExt.add(`ext:${pending.externalId}`);
        byContent.set(contentKey, pending);
        claimedIds.add(pending.id);
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
        if (paidTx && row.importSource && !paidTx.importSource) paidTx.importSource = row.importSource;
        if (paidTx) {
          softConsumed.set(softKey, (softConsumed.get(softKey) ?? 0) + 1);
          softExisting.set(softKey, (softExisting.get(softKey) ?? 0) + 1);
          byContent.set(contentKey, paidTx);
          claimedIds.add(paidTx.id);
        }
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
      importSource: row.importSource,
      sourceDate: row.date,
      sourceDescription: row.description,
      sourceAmount: amount,
      ...createdAudit(userId, origin),
    };
    if ((tx.paymentStatus ?? 'paid') === 'paid') tx.paidAt = row.date;
    if (!memberGuardianId) delete tx.memberGuardianId;
    if (!tx.memberId) delete tx.memberId;
    if (!tx.notes) delete tx.notes;
    if (!tx.externalId) delete tx.externalId;
    if (!tx.importSource) delete tx.importSource;
    db.transactions.push(tx);
    created.push(tx.id);
    byContent.set(contentKey, tx);
    claimedIds.add(tx.id);
    softConsumed.set(softKey, (softConsumed.get(softKey) ?? 0) + 1);
    softExisting.set(softKey, (softExisting.get(softKey) ?? 0) + 1);
    if (tx.externalId) seenExt.add(`ext:${tx.externalId}`);
    if (isUnidentifiedName(movement.name)) unidentified.push(tx.id);
  }

  return { created, paid, unidentified, skipped };
}
