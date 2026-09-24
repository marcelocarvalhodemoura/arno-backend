/**
 * CLI opcional. Em produção a limpeza já roda ao subir a API (main.ts).
 *
 *   node scripts/cleanup-duplicate-transactions.mjs           # dry-run
 *   node scripts/cleanup-duplicate-transactions.mjs --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

function fold(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
function money(value) {
  return Number(value ?? 0);
}
function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}
function extractDocument(description) {
  const match = description.replace(/\D/g, ' ').match(/\b(\d{11}|\d{14})\b/);
  return match?.[1] ?? '';
}
function normalizeCleanupDescription(description) {
  let text = fold(description);
  const wrapped = text.match(
    /^.+?\s·\sparte\s+\d+\s*\/\s*\d+\s*·\s*r\$\s*[\d.,]+\s*de\s*r\$\s*[\d.,]+\s*·\s*(.+)$/,
  );
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
function effectiveAmount(tx) {
  const total = money(tx.splitTotal);
  if (total > 0) return Math.round(total * 100) / 100;
  return Math.round(money(tx.amount) * 100) / 100;
}
function clusterKey(tx, date) {
  const norm = normalizeCleanupDescription(tx.description);
  const doc = extractDocument(tx.description);
  if (!norm && !doc) return null;
  return `${date}|${tx.type}|${effectiveAmount(tx).toFixed(2)}|${doc}|${norm}`;
}
function scoreKeep(tx, identifyIds) {
  let score = 0;
  if (tx.splitGroupId) score += 100;
  if (!identifyIds.has(tx.movementTypeId)) score += 40;
  if (tx.memberId) score += 20;
  if (tx.externalId) score += 15;
  if (tx.origin === 'sicredi') score += 10;
  if (tx.origin === 'manual') score += 5;
  return score;
}

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();
const types = await prisma.movementType.findMany({ select: { id: true, name: true } });
const identifyIds = new Set(types.filter((item) => /identificar/i.test(item.name)).map((item) => item.id));
const typeName = Object.fromEntries(types.map((item) => [item.id, item.name]));
const txs = await prisma.transaction.findMany({
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
});

const buckets = new Map();
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

const plan = [];
const alreadyDropping = new Set();
const protectedSplitParts = new Set(txs.filter((item) => item.splitGroupId).map((item) => item.id));
for (const [key, group] of buckets) {
  const unique = [...new Map(group.map((item) => [item.id, item])).values()];
  if (unique.length < 2) continue;
  const ranked = [...unique].sort((a, b) => {
    const scoreDiff = scoreKeep(b, identifyIds) - scoreKeep(a, identifyIds);
    if (scoreDiff) return scoreDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const keep = ranked[0];
  const drop = ranked.slice(1).filter((item) => !protectedSplitParts.has(item.id) && !alreadyDropping.has(item.id));
  if (!drop.length) continue;
  for (const item of drop) alreadyDropping.add(item.id);
  plan.push({
    keepLabel: `${dateOnly(keep.date)} · ${typeName[keep.movementTypeId] ?? '?'} · R$ ${effectiveAmount(keep).toFixed(2)} · ${keep.description.slice(0, 70)}${keep.splitGroupId ? ' [rateio]' : ''}`,
    dropIds: drop.map((item) => item.id),
    dropLabels: drop.map(
      (item) =>
        `${dateOnly(item.date)} · ${typeName[item.movementTypeId] ?? '?'} · R$ ${money(item.amount).toFixed(2)} · ${item.description.slice(0, 70)}`,
    ),
  });
}
const dropIds = [...new Set(plan.flatMap((item) => item.dropIds))];
console.log(`Clusters: ${plan.length} · a remover: ${dropIds.length} · ${apply ? 'APPLY' : 'DRY-RUN'}`);
for (const item of plan.slice(0, 40)) {
  console.log(`MANTER  ${item.keepLabel}`);
  for (const label of item.dropLabels) console.log(`  APAGAR ${label}`);
}
if (!apply || !dropIds.length) {
  if (!apply && dropIds.length) console.log('\nAPI já limpa na subida. Este CLI é só para conferência/ops.');
  await prisma.$disconnect();
  process.exit(0);
}
await prisma.$transaction(async (tx) => {
  await tx.messageOutbox.deleteMany({ where: { transactionId: { in: dropIds } } });
  await tx.bankMovement.updateMany({
    where: { transactionId: { in: dropIds } },
    data: { transactionId: null, status: 'new' },
  });
  const deleted = await tx.transaction.deleteMany({ where: { id: { in: dropIds } } });
  console.log(`Apagados: ${deleted.count}`);
});
await prisma.$disconnect();
