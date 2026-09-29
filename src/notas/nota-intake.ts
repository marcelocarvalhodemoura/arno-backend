import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import { fold } from '../shared/csv';
import type { BranchId, DatabaseShape, MovementType, PaymentMethod, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';
import { classifyMovement, findType, isUnidentifiedName } from '../statement/statement';
import { ensureIdentifyType } from '../statement/ingest';
import { brl, formatDate } from '../notifications/templates';
import { describeNota, type NotaData } from './nota-reader';

/** Diferença máxima, em dias, entre a data da nota e a saída do extrato. */
const MATCH_WINDOW_DAYS = 3;

const FIXED_TYPES = new Set(['mensalidade', 'ueb / registro', 'sede', 'utilidades']);

const BRANCH_HINTS: Array<{ needles: string[]; branch: BranchId }> = [
  { needles: ['filhote'], branch: 'filhote' },
  { needles: ['lobinho', 'alcateia'], branch: 'lobinho' },
  { needles: ['senior', 'tropa senior'], branch: 'senior' },
  { needles: ['pioneiro', 'cla'], branch: 'pioneiro' },
  { needles: ['flor de lis', 'flor-de-lis'], branch: 'flor-de-lis' },
  { needles: ['escoteiro', 'tropa'], branch: 'escoteiro' },
];

export type NotaIntakeResult =
  | {
      kind: 'matched';
      tx: Transaction;
      previousType: string;
      typeName: string;
      typeChanged: boolean;
      methodChanged: boolean;
      needsUpload: boolean;
    }
  | { kind: 'created'; tx: Transaction; typeName: string; needsUpload: boolean }
  | { kind: 'duplicate'; tx: Transaction; typeName: string; needsUpload: false };

export function notaExternalId(nota: NotaData) {
  return nota.accessKey ? `nfe:${nota.accessKey}` : undefined;
}

/**
 * Concilia a nota com o caixa. Deve rodar dentro de `mutate`:
 * - mesma chave já lançada → duplicate;
 * - saída do extrato com mesmo valor e data próxima → anexa e troca "A identificar" pelo tipo da nota;
 * - senão cria o lançamento (fica "A identificar" se nenhuma regra reconhecer a nota).
 */
export function reconcileNota(
  db: DatabaseShape,
  nota: NotaData,
  options: { caption?: string; userId: string; today: string },
): NotaIntakeResult {
  const externalId = notaExternalId(nota);
  const keyNote = nota.accessKey ? `Chave NF ${nota.accessKey}` : '';
  if (externalId) {
    const existing = db.transactions.find(
      (tx) => tx.externalId === externalId || (keyNote && tx.notes?.includes(keyNote)),
    );
    if (existing) return { kind: 'duplicate', tx: existing, typeName: typeName(db, existing), needsUpload: false };
  }

  ensureIdentifyType(db, options.userId);
  const classified = classifyNota(db, nota, options.caption);
  const date = nota.date || options.today;
  const summary = notaNotes(nota);

  const match = findMatch(db, nota.total, date);
  if (match) {
    const previousType = typeName(db, match);
    const current = db.movementTypes.find((item) => item.id === match.movementTypeId);
    const canRetype = !current || isUnidentifiedName(current.name);
    const typeChanged = Boolean(canRetype && classified && classified.id !== match.movementTypeId);
    if (typeChanged && classified) {
      match.movementTypeId = classified.id;
      match.nature = FIXED_TYPES.has(fold(classified.name)) ? 'fixed' : 'variable';
    }
    // Pagamento "a definir" (other) recebe o meio que consta na nota.
    const notaMethod = paymentMethod(nota.paymentMethod);
    const methodChanged = match.method === 'other' && notaMethod !== 'other';
    if (methodChanged) match.method = notaMethod;
    const branch = branchFromCaption(options.caption);
    if (branch && match.branch === 'grupo') match.branch = branch;
    match.notes = [match.notes, summary].filter(Boolean).join('\n');
    Object.assign(match, updatedAudit(options.userId));
    return {
      kind: 'matched',
      tx: match,
      previousType,
      typeName: typeName(db, match),
      typeChanged,
      methodChanged,
      needsUpload: !match.notaKey,
    };
  }

  const movement = classified ?? unidentifiedType(db);
  if (!movement) throw new Error('Nenhum tipo de saída cadastrado');
  const tx: Transaction = {
    id: id(),
    date,
    type: 'expense',
    nature: FIXED_TYPES.has(fold(movement.name)) ? 'fixed' : 'variable',
    movementTypeId: movement.id,
    description: notaDescription(nota),
    amount: roundMoney(nota.total),
    branch: branchFromCaption(options.caption) ?? 'grupo',
    method: paymentMethod(nota.paymentMethod),
    paymentStatus: 'paid',
    paidAt: date,
    notes: summary,
    externalId,
    ...createdAudit(options.userId, 'integration'),
  };
  if (!tx.externalId) delete tx.externalId;
  db.transactions.push(tx);
  return { kind: 'created', tx, typeName: movement.name, needsUpload: true };
}

export function classifyNota(db: DatabaseShape, nota: NotaData, caption?: string): MovementType | null {
  const expenseTypes = db.movementTypes.filter(
    (item) => item.active && (item.direction === 'both' || item.direction === 'expense'),
  );

  // O que a tesouraria já corrigiu antes para o mesmo CNPJ vale mais que as palavras-chave.
  if (nota.issuerDocument) {
    const learned = [...db.transactions]
      .reverse()
      .find(
        (tx) => tx.type === 'expense' && tx.notes?.includes(`CNPJ ${nota.issuerDocument}`) && !isUnidentified(db, tx),
      );
    const type = learned && expenseTypes.find((item) => item.id === learned.movementTypeId);
    if (type) return type;
  }

  const text = [caption, nota.issuerName, ...nota.items.map((item) => item.description)].filter(Boolean).join(' ');
  const found = classifyMovement(text, 'expense', expenseTypes);
  if (!found.type || isUnidentifiedName(found.type.name)) return null;
  return expenseTypes.find((item) => item.id === found.type?.id) ?? null;
}

function findMatch(db: DatabaseShape, amount: number, date: string) {
  const target = dayNumber(date);
  const candidates = db.transactions.filter(
    (tx) =>
      tx.type === 'expense' &&
      Math.abs(tx.amount - amount) < 0.005 &&
      Math.abs(dayNumber(tx.date) - target) <= MATCH_WINDOW_DAYS,
  );
  return (
    candidates.sort((a, b) => {
      const score = (tx: Transaction) =>
        (tx.notaKey ? 100 : 0) + (isUnidentified(db, tx) ? 0 : 10) + Math.abs(dayNumber(tx.date) - target);
      return score(a) - score(b);
    })[0] ?? null
  );
}

function notaDescription(nota: NotaData) {
  const items = describeNota(nota, 3);
  const base = nota.issuerName || 'Nota recebida por WhatsApp';
  return (items ? `${base} — ${items}` : base).slice(0, 180);
}

function notaNotes(nota: NotaData) {
  const lines = [
    `Nota recebida por WhatsApp (${nota.source === 'sefaz' ? 'consulta Sefaz' : nota.source === 'pdf' ? 'PDF' : 'OCR'})`,
    nota.issuerName ? `Emitente ${nota.issuerName}` : '',
    nota.issuerDocument ? `CNPJ ${nota.issuerDocument}` : '',
    nota.accessKey ? `Chave NF ${nota.accessKey}` : '',
    ...nota.items
      .slice(0, 40)
      .map(
        (item) =>
          `• ${item.description}${item.quantity ? ` ${String(item.quantity).replace('.', ',')}x` : ''} ${brl(item.total)}`,
      ),
    `Total ${brl(nota.total)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'dinheiro',
  transfer: 'transferência',
  card: 'cartão',
  other: 'outro',
};

function paymentMethod(label?: string): PaymentMethod {
  const key = fold(label ?? '');
  if (key.includes('pix')) return 'pix';
  if (key.includes('dinheiro')) return 'cash';
  if (key.includes('cartao') || key.includes('credito') || key.includes('debito')) return 'card';
  return 'other';
}

export function branchFromCaption(caption?: string): BranchId | undefined {
  const key = fold(caption ?? '');
  if (!key) return undefined;
  return BRANCH_HINTS.find((hint) => hint.needles.some((needle) => new RegExp(`\\b${needle}\\b`).test(key)))?.branch;
}

function unidentifiedType(db: DatabaseShape) {
  return findType(db.movementTypes, 'A identificar');
}

function isUnidentified(db: DatabaseShape, tx: Transaction) {
  const type = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return !type || isUnidentifiedName(type.name);
}

function typeName(db: DatabaseShape, tx: Transaction) {
  return db.movementTypes.find((item) => item.id === tx.movementTypeId)?.name ?? 'A identificar';
}

function dayNumber(iso: string) {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) / 86_400_000);
}

export function notaReply(result: NotaIntakeResult, nota: NotaData) {
  const value = brl(result.tx.amount);
  const who = nota.issuerName ? ` de ${nota.issuerName}` : '';
  const when = formatDate(result.tx.date);
  const pending = isUnidentifiedName(result.typeName)
    ? ' Não reconheci o tipo, ficou "A identificar" para a tesouraria conferir.'
    : '';
  if (result.kind === 'duplicate') {
    return `Esta nota${who} (${value}, ${when}) já estava lançada como ${result.typeName}. Nada foi alterado.`;
  }
  if (result.kind === 'matched') {
    const change = result.typeChanged
      ? ` Tipo alterado de ${result.previousType} para ${result.typeName}.`
      : ` Tipo mantido: ${result.typeName}.`;
    const method = result.methodChanged ? ` Pagamento atualizado para ${METHOD_LABELS[result.tx.method]}.` : '';
    const file = result.needsUpload ? ' Nota anexada.' : ' O lançamento já tinha nota; mantive a anterior.';
    return `Encontrei a saída de ${value} em ${when}${who} no caixa.${change}${method}${file}${pending}`;
  }
  return `Nota${who} de ${value} em ${when} lançada como ${result.typeName}, com a nota anexada.${pending}`;
}
