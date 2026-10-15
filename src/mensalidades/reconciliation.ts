import { domainEvents } from '../shared/domain/domain-events';
import { transactionPaid } from '../ledger/domain/events';
import { updatedAudit } from '../shared/audit';
import type { DatabaseShape, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';
import { catalogFromDb } from '../statement/interpret-upload';
import { isMensalidadeName, isUnidentifiedName, matchMember } from '../statement/statement';
import { yearMonthKey } from '../arrears/arrears';
import { ensureMensalidadeType, listOpenMensalidades } from './mensalidades';
import { todayISO } from '../shared/dates';
import { NotFound } from '../shared/domain/errors';

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

export function reconciliationKey(creditId: string, pendingId: string) {
  return `recon:${creditId}:${pendingId}`;
}

function needsReview(db: DatabaseShape, tx: Transaction) {
  if (tx.type !== 'income' || tx.paymentStatus === 'pending' || tx.splitGroupId) return false;
  const type = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return isUnidentifiedName(type?.name ?? '');
}

function reasonFor(score: number, guardian?: { name: string }) {
  if (score >= 95) return 'CPF ou chave Pix cadastrada no associado';
  if (guardian) return `nome do responsável (${guardian.name})`;
  if (score >= 73) return 'nome do titular da conta cadastrada';
  return 'nome do associado no histórico do Pix';
}

/**
 * Para cada crédito pago ainda sem tipo, sugere a mensalidade pendente que ele provavelmente quita:
 * pagador reconhecido (CPF, chave Pix, responsável ou nome) e valor igual ao da tabela daquele mês.
 */
export function reconciliationSuggestions(
  db: DatabaseShape,
  range: { from: string; to: string },
  dismissed: Set<string>,
  today = todayISO(),
) {
  const catalog = catalogFromDb(db);
  const activeMembers = catalog.members.filter((member) => member.status !== 'inactive');
  return db.transactions
    .filter((tx) => needsReview(db, tx) && tx.date >= range.from && tx.date <= range.to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((credit) => {
      const base = {
        creditId: credit.id,
        date: credit.paidAt ?? credit.date,
        amount: credit.amount,
        description: credit.description,
      };
      const match = matchMember(credit.description, activeMembers);
      if (!match) return { ...base, suggestion: null, reason: 'Pagador não reconhecido no cadastro' };
      const open = listOpenMensalidades(db, match.member.id, today);
      const amount = roundMoney(credit.amount);
      const pending = open.find(
        (item) =>
          !dismissed.has(reconciliationKey(credit.id, item.transactionId)) &&
          (item.onTimeAmount === amount || item.lateAmount === amount),
      );
      if (!pending) {
        return {
          ...base,
          suggestion: null,
          reason: `Pagador parece ${match.member.name}, mas nenhuma mensalidade em aberto tem este valor`,
        };
      }
      const timing = pending.onTimeAmount === amount ? 'no prazo' : 'com atraso';
      return {
        ...base,
        suggestion: {
          pendingId: pending.transactionId,
          memberId: match.member.id,
          memberName: match.member.name,
          yearMonth: pending.yearMonth,
          label: `Mensalidade de ${MONTHS[pending.month]}/${pending.year} de ${match.member.name}`,
        },
        reason: `${reasonFor(match.score, match.guardian)}; valor igual à tabela ${timing}`,
      };
    });
}

/** Confirma a sugestão: o crédito pago vira a mensalidade daquele mês e a cobrança pendente sai. */
export function confirmReconciliation(db: DatabaseShape, creditId: string, pendingId: string, userId: string) {
  const credit = db.transactions.find((tx) => tx.id === creditId);
  if (!credit || !needsReview(db, credit)) throw new NotFound('Crédito não encontrado ou já identificado');
  const pending = db.transactions.find((tx) => tx.id === pendingId);
  const pendingType = db.movementTypes.find((item) => item.id === pending?.movementTypeId);
  if (
    !pending ||
    pending.paymentStatus !== 'pending' ||
    !isMensalidadeName(pendingType?.name ?? '') ||
    !pending.memberId
  ) {
    throw new NotFound('Mensalidade pendente não encontrada');
  }
  const member = db.members.find((item) => item.id === pending.memberId)!;
  const movement = ensureMensalidadeType(db, userId);
  const year = Number(pending.date.slice(0, 4));
  const month = Number(pending.date.slice(5, 7));
  const paidAt = (credit.paidAt ?? credit.date).slice(0, 10);

  const drop = new Set(
    pending.splitGroupId
      ? db.transactions.filter((tx) => tx.splitGroupId === pending.splitGroupId).map((tx) => tx.id)
      : [pending.id],
  );
  db.transactions = db.transactions.filter((tx) => !drop.has(tx.id));

  Object.assign(credit, {
    movementTypeId: movement.id,
    memberId: member.id,
    date: pending.date,
    paidAt,
    paymentStatus: 'paid',
    nature: 'fixed',
    branch: member.branch,
    clubFeeIncluded: pending.clubFeeIncluded,
    description: `Mensalidade ${MONTHS[month]} ${year} — ${member.name}`,
    notes: [credit.notes, `Pix: ${credit.description}`].filter(Boolean).join('\n'),
    ...updatedAudit(userId),
  });
  if (pending.memberGuardianId) credit.memberGuardianId = pending.memberGuardianId;
  // Mensalidade com parcela de acordo embutida: a parcela também é dada como paga.
  if (pending.arrearsId && !pending.arrearsYearMonth) {
    credit.arrearsId = pending.arrearsId;
    domainEvents.publish(
      transactionPaid({
        transactionId: credit.id,
        method: credit.method,
        paidAt,
        userId,
        arrears: { planId: pending.arrearsId, yearMonth: yearMonthKey(year, month), source: 'mensalidade' },
      }),
      db,
    );
  }
  return credit;
}
