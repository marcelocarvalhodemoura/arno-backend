import { prisma } from '../shared/db';

type TxRow = {
  id: string;
  date: Date;
  type: string;
  description: string;
  amount: { toString(): string } | number;
  origin: string;
  memberId: string | null;
  externalId: string | null;
  splitGroupId: string | null;
  splitIndex: number | null;
  splitTotal: { toString(): string } | number | null;
  movementTypeId: string;
  createdAt: Date;
};

function fold(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function money(value: TxRow['amount'] | TxRow['splitTotal']): number {
  return Number(value ?? 0);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function extractDocument(description: string): string {
  const match = description.replace(/\D/g, ' ').match(/\b(\d{11}|\d{14})\b/);
  return match?.[1] ?? '';
}

/** Normaliza histórico bancário / rateio para achar o mesmo Pix. */
export function normalizeCleanupDescription(description: string): string {
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

function effectiveAmount(tx: TxRow): number {
  const total = money(tx.splitTotal);
  if (total > 0) return Math.round(total * 100) / 100;
  return Math.round(money(tx.amount) * 100) / 100;
}

function clusterKey(tx: TxRow, date: string): string | null {
  const norm = normalizeCleanupDescription(tx.description);
  const doc = extractDocument(tx.description);
  if (!norm && !doc) return null;
  return `${date}|${tx.type}|${effectiveAmount(tx).toFixed(2)}|${doc}|${norm}`;
}

function scoreKeep(tx: TxRow, identifyIds: Set<string>): number {
  let score = 0;
  if (tx.splitGroupId) score += 100;
  if (!identifyIds.has(tx.movementTypeId)) score += 40;
  if (tx.memberId) score += 20;
  if (tx.externalId) score += 15;
  if (tx.origin === 'sicredi') score += 10;
  if (tx.origin === 'manual') score += 5;
  return score;
}

/** Ids avulsos que duplicam outro lançamento (nunca partes de rateio). */
export function planDuplicateRemovals(txs: TxRow[], identifyIds: Set<string>): { keepId: string; dropIds: string[] }[] {
  const buckets = new Map<string, TxRow[]>();

  for (const tx of txs) {
    if (tx.splitGroupId && tx.splitIndex != null && tx.splitIndex !== 1) continue;
    const dates = tx.splitGroupId
      ? [...new Set(txs.filter((item) => item.splitGroupId === tx.splitGroupId).map((item) => dateOnly(item.date)))]
      : [dateOnly(tx.date)];
    for (const date of dates) {
      const key = clusterKey(tx, date);
      if (!key) continue;
      const list = buckets.get(key) ?? [];
      list.push(tx);
      buckets.set(key, list);
    }
  }

  const plan: { keepId: string; dropIds: string[] }[] = [];
  const alreadyDropping = new Set<string>();
  const protectedSplitParts = new Set(txs.filter((item) => item.splitGroupId).map((item) => item.id));

  for (const group of buckets.values()) {
    const unique = [...new Map(group.map((item) => [item.id, item])).values()];
    if (unique.length < 2) continue;

    const ranked = [...unique].sort((a, b) => {
      const scoreDiff = scoreKeep(b, identifyIds) - scoreKeep(a, identifyIds);
      if (scoreDiff) return scoreDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const keep = ranked[0]!;
    const drop = ranked.slice(1).filter((item) => {
      if (protectedSplitParts.has(item.id)) return false;
      if (alreadyDropping.has(item.id)) return false;
      return true;
    });
    if (!drop.length) continue;
    for (const item of drop) alreadyDropping.add(item.id);
    plan.push({ keepId: keep.id, dropIds: drop.map((item) => item.id) });
  }

  return plan;
}

const CLEANUP_LOCK = 4_202_609_24;

/**
 * Remove duplicatas no caixa (avulso vs rateio / reimportação).
 * Idempotente; usa advisory lock para não concorrer entre instâncias.
 */
export async function cleanupDuplicateTransactions(): Promise<{ deleted: number }> {
  const locked = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(CAST(${CLEANUP_LOCK} AS bigint)) AS locked
  `;
  if (!locked[0]?.locked) {
    return { deleted: 0 };
  }

  try {
    const types = await prisma.movementType.findMany({ select: { id: true, name: true } });
    const identifyIds = new Set(types.filter((item) => /identificar/i.test(item.name)).map((item) => item.id));

    const txs = (await prisma.transaction.findMany({
      select: {
        id: true,
        date: true,
        type: true,
        description: true,
        amount: true,
        origin: true,
        memberId: true,
        externalId: true,
        splitGroupId: true,
        splitIndex: true,
        splitTotal: true,
        movementTypeId: true,
        createdAt: true,
      },
    })) as TxRow[];

    const dropIds = [...new Set(planDuplicateRemovals(txs, identifyIds).flatMap((item) => item.dropIds))];
    if (!dropIds.length) return { deleted: 0 };

    const deleted = await prisma.$transaction(async (tx) => {
      await tx.messageOutbox.deleteMany({ where: { transactionId: { in: dropIds } } });
      await tx.bankMovement.updateMany({
        where: { transactionId: { in: dropIds } },
        data: { transactionId: null, status: 'new' },
      });
      return tx.transaction.deleteMany({ where: { id: { in: dropIds } } });
    });

    return { deleted: deleted.count };
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(CAST(${CLEANUP_LOCK} AS bigint))`;
  }
}
