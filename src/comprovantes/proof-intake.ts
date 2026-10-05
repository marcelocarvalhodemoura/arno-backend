import { fold } from '../shared/csv';
import type { DatabaseShape, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';
import { learnPayerAccount } from '../ledger/transactions';
import { confirmReconciliation } from '../mensalidades/reconciliation';
import { listOpenMensalidades } from '../mensalidades/mensalidades';
import { catalogFromDb } from '../statement/interpret-upload';
import { isUnidentifiedName, matchMember } from '../statement/statement';
import { brl, formatDate } from '../notifications/templates';
import type { ProofData } from './proof-reader';

/** Diferença máxima, em dias, entre a data do comprovante e o crédito no extrato (busca sem id do Pix). */
const MATCH_WINDOW_DAYS = 2;

const MONTHS = [
  '',
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export type ProofOutcome =
  /** Id do Pix bateu com o extrato e a mensalidade foi baixada automaticamente. */
  | { status: 'matched'; creditId: string; memberId: string; label: string }
  /** O crédito já estava identificado no caixa (baixa feita antes, pelo extrato ou pela tesouraria). */
  | { status: 'already'; creditId: string; label: string }
  /** Tem id do Pix, mas o crédito ainda não chegou na sincronização do banco. */
  | { status: 'waiting'; reason: string }
  /** Precisa da tesouraria. `creditId` = crédito provável, quando houver. */
  | { status: 'review'; reason: string; creditId?: string; memberNames?: string[] }
  /** Pagamento para outra conta. */
  | { status: 'rejected'; reason: string };

/** DDD + 8 últimos dígitos: o WhatsApp manda celulares do Brasil sem o nono dígito, o cadastro costuma ter. */
export function phoneKey(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 11 && digits[2] === '9') digits = digits.slice(0, 2) + digits.slice(3);
  return digits.length === 10 ? digits : '';
}

/** Associados ativos ligados ao telefone: o próprio cadastro do associado ou de um responsável. */
export function membersByPhone(db: DatabaseShape, phone: string) {
  const key = phoneKey(phone);
  if (!key) return [];
  const ids = new Set<string>();
  for (const member of db.members) if (phoneKey(member.phone ?? '') === key) ids.add(member.id);
  for (const guardian of db.memberGuardians ?? [])
    if (phoneKey(guardian.phone ?? '') === key) ids.add(guardian.memberId);
  return db.members.filter((member) => ids.has(member.id) && member.status !== 'inactive');
}

/** O recebedor precisa ser o Grupo. Só recusa quando o comprovante mostra claramente outro CNPJ. */
export function payeeCheck(proof: ProofData, groupCnpj = process.env.GROUP_CNPJ ?? '') {
  const expected = groupCnpj.replace(/\D/g, '');
  const document = proof.payeeDocument.replace(/\D/g, '');
  if (expected && document.length === 14) return document === expected ? 'ok' : 'other';
  const name = fold(proof.payeeName);
  if (!name) return 'unknown';
  return /arno|escoteir|friedrich/.test(name) ? 'ok' : 'unknown';
}

/**
 * Concilia o comprovante com o caixa. Deve rodar dentro de `mutate`.
 * - Com id do Pix: busca exata do crédito. Se o remetente é conhecido e há uma única mensalidade em
 *   aberto com o mesmo valor, baixa na hora (decisão da tesouraria em 05/10/2026).
 * - Sem id do Pix (TED, depósito, print sem id): só sugere o crédito; quem confirma é a tesouraria.
 * - Remetente desconhecido nunca baixa sozinho.
 */
export function reconcileProof(
  db: DatabaseShape,
  proof: ProofData,
  options: { memberIds: string[]; userId: string; today: string },
): ProofOutcome {
  if (payeeCheck(proof) === 'other') {
    return { status: 'rejected', reason: `Pagamento para outra conta (${proof.payeeName || proof.payeeDocument})` };
  }
  const amount = roundMoney(proof.amount);

  if (proof.e2e) {
    const credit = db.transactions.find((tx) => tx.externalId === proof.e2e && tx.type === 'income');
    if (!credit) {
      // Extrato importado (CSV/PDF) não traz o id do Pix: crédito com mesmo valor e data vira sugestão.
      const nearby = nearbyCredits(db, amount, proof.date || options.today).filter(
        (tx) => !tx.externalId || !/^E\d{20}/.test(tx.externalId),
      );
      if (amount > 0 && nearby.length === 1) {
        return {
          status: 'review',
          creditId: nearby[0].id,
          reason: 'Crédito com mesmo valor e data no extrato importado (sem id do Pix); falta confirmar',
          memberNames: memberNames(db, options.memberIds),
        };
      }
      return { status: 'waiting', reason: 'Crédito ainda não apareceu no extrato do banco' };
    }
    if (!isUnidentified(db, credit)) return { status: 'already', creditId: credit.id, label: credit.description };
    if (proof.amount > 0 && Math.abs(credit.amount - amount) >= 0.005) {
      return {
        status: 'review',
        creditId: credit.id,
        reason: `Valor do comprovante (${brl(amount)}) diferente do extrato (${brl(credit.amount)})`,
      };
    }
    return settle(db, credit, options);
  }

  if (!(amount > 0)) return { status: 'review', reason: 'Não foi possível ler o valor do comprovante' };
  const candidates = nearbyCredits(db, amount, proof.date || options.today);
  const names = memberNames(db, options.memberIds);
  if (candidates.length === 1) {
    return {
      status: 'review',
      creditId: candidates[0].id,
      reason: 'Comprovante sem id do Pix: crédito provável encontrado, falta confirmar',
      memberNames: names,
    };
  }
  return {
    status: 'review',
    reason: candidates.length
      ? `${candidates.length} créditos de ${brl(amount)} perto dessa data; escolha o certo`
      : 'Nenhum crédito com esse valor e data no extrato',
    memberNames: names.filter(Boolean),
  };
}

/** Crédito sem tipo + id do Pix conferido: decide a mensalidade e dá baixa. */
function settle(
  db: DatabaseShape,
  credit: Transaction,
  options: { memberIds: string[]; userId: string; today: string },
): ProofOutcome {
  let memberIds = options.memberIds;
  const known = memberIds.length > 0;
  if (!known) {
    const catalog = catalogFromDb(db);
    const match = matchMember(
      credit.description,
      catalog.members.filter((item) => item.status !== 'inactive'),
    );
    memberIds = match ? [match.member.id] : [];
  }
  const amount = roundMoney(credit.amount);
  // A mais antiga em aberto com o valor exato (mesma regra das sugestões de conciliação).
  const choices = memberIds.flatMap((memberId) => {
    const pending = listOpenMensalidades(db, memberId, options.today).find(
      (item) => item.onTimeAmount === amount || item.lateAmount === amount,
    );
    return pending ? [{ memberId, pending }] : [];
  });
  const names = memberIds
    .map((memberId) => db.members.find((item) => item.id === memberId)?.name ?? '')
    .filter(Boolean);

  if (!known) {
    return {
      status: 'review',
      creditId: credit.id,
      reason: choices.length
        ? `Telefone não cadastrado; pagador parece ${names[0]}`
        : 'Telefone não cadastrado e pagador não reconhecido',
      memberNames: names,
    };
  }
  if (choices.length === 1) {
    const [{ memberId, pending }] = choices;
    const updated = confirmReconciliation(db, credit.id, pending.transactionId, options.userId);
    learnPayerAccount(db, { ...updated, description: lastPixLine(updated) }, options.userId);
    const member = db.members.find((item) => item.id === memberId);
    return {
      status: 'matched',
      creditId: credit.id,
      memberId,
      label: `Mensalidade de ${MONTHS[pending.month]}/${pending.year} de ${firstName(member?.name ?? '')}`,
    };
  }
  if (choices.length > 1) {
    return {
      status: 'review',
      creditId: credit.id,
      reason: `Valor serve para mais de um associado (${names.join(', ')})`,
      memberNames: names,
    };
  }
  return {
    status: 'review',
    creditId: credit.id,
    reason: `Nenhuma mensalidade em aberto de ${brl(amount)} para ${names.join(', ')}`,
    memberNames: names,
  };
}

/** `confirmReconciliation` guarda a descrição original do Pix nas notas ("Pix: ..."); o CPF do pagador está nela. */
function lastPixLine(tx: Transaction) {
  const line = (tx.notes ?? '')
    .split('\n')
    .reverse()
    .find((item) => item.startsWith('Pix: '));
  return line ? line.slice(5) : tx.description;
}

export function proofReply(outcome: ProofOutcome, proof: ProofData) {
  const what = `${brl(roundMoney(proof.amount))}${proof.date ? ` de ${formatDate(proof.date)}` : ''}`;
  switch (outcome.status) {
    case 'matched':
      return `Recebemos o comprovante de ${what}. ${outcome.label} baixada ✅ Obrigado!`;
    case 'already':
      return `Recebemos o comprovante de ${what}. Esse pagamento já estava registrado: ${outcome.label}. Obrigado!`;
    case 'waiting':
      return `Recebemos o comprovante de ${what}. Assim que o valor aparecer no extrato do banco, damos baixa e avisamos aqui.`;
    case 'rejected':
      return `Esse comprovante parece ser de um pagamento para outra conta (${proof.payeeName || proof.payeeDocument}). Confira se enviou o arquivo certo.`;
    case 'review': {
      const many = (outcome.memberNames?.length ?? 0) > 1;
      const ask = many
        ? ` Se puder, responda dizendo de qual associado é o pagamento (${outcome.memberNames!.join(' ou ')}).`
        : '';
      return `Recebemos o comprovante de ${what}. A tesouraria vai conferir e dar baixa.${ask}`;
    }
  }
}

/** Créditos pagos ainda "A identificar" com o mesmo valor, perto da data do comprovante. */
function nearbyCredits(db: DatabaseShape, amount: number, date: string) {
  const target = dayNumber(date);
  return db.transactions.filter(
    (tx) =>
      tx.type === 'income' &&
      tx.paymentStatus === 'paid' &&
      isUnidentified(db, tx) &&
      Math.abs(tx.amount - amount) < 0.005 &&
      Math.abs(dayNumber(tx.paidAt ?? tx.date) - target) <= MATCH_WINDOW_DAYS,
  );
}

function memberNames(db: DatabaseShape, memberIds: string[]) {
  return memberIds.map((memberId) => db.members.find((item) => item.id === memberId)?.name ?? '').filter(Boolean);
}

function isUnidentified(db: DatabaseShape, tx: Transaction) {
  const type = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return !type || isUnidentifiedName(type.name);
}

function firstName(name: string) {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first ? first[0] + first.slice(1).toLowerCase() : '';
}

function dayNumber(iso: string) {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) / 86_400_000);
}
