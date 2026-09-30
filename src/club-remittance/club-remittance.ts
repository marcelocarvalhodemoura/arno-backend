import { createdAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { DatabaseShape, Member, PaymentMethod, Transaction } from '../shared/types';
import { roundMoney } from '../shared/types';
import { createTransaction } from '../ledger/transactions';
import {
  effectiveClubFeeIncluded,
  isCurrentMensalidadeMonth,
  MENSALIDADE_TABLE,
  monthFromDate,
  paysMensalidade,
  resolveFeeOverride,
} from '../mensalidades/fee-table';
import { todayISO } from '../mensalidades/mensalidades';
import { isMensalidadeName } from '../statement/statement';

export const CLUB_REMITTANCE_MOVEMENT_NAME = 'Repasse Lindóia Tênis Clube';

export type ClubRemittanceLine = {
  transactionId: string;
  memberId: string;
  memberName: string;
  branch: string;
  dueDate: string;
  paidAt: string;
  amountPaid: number;
  clubShare: number;
  late: boolean;
  competenceMonth: number;
};

export type ClubRemittanceRecord = {
  transactionId: string;
  date: string;
  amount: number;
  description: string;
  method: PaymentMethod;
  notes?: string;
};

export type ClubRemittancePreview = {
  year: number;
  month: number;
  clubShareOnTime: number;
  clubShareLate: number;
  lines: ClubRemittanceLine[];
  total: number;
  count: number;
  remittance: ClubRemittanceRecord | null;
};

export type ClubRemittanceMonthSummary = {
  month: number;
  count: number;
  total: number;
  remitted: boolean;
  remittanceAmount: number | null;
};

export type ClubRemittanceYearSummary = {
  year: number;
  clubShareOnTime: number;
  clubShareLate: number;
  months: ClubRemittanceMonthSummary[];
  totalDue: number;
  totalRemitted: number;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function clubRemittanceExternalId(year: number, month: number) {
  return `club-remittance:${year}-${pad2(month)}`;
}

function isMensalidadeTx(db: DatabaseShape, tx: Transaction) {
  if (tx.type !== 'income') return false;
  const movement = db.movementTypes.find((item) => item.id === tx.movementTypeId);
  return Boolean(movement && isMensalidadeName(movement.name));
}

/** Parcela Lindóia a repassar (sem a diluição R$ 4,50 do grupo). */
export function remittanceClubShare(
  profile: Pick<Member, 'branch' | 'role' | 'clubeLtc' | 'feeOverride' | 'monthlyFee'>,
  dueDate: string,
  paidAt: string,
): number {
  if (!paysMensalidade(profile)) return 0;
  const month = monthFromDate(dueDate);
  if (!isCurrentMensalidadeMonth(month)) return 0;
  if (resolveFeeOverride(profile) != null) return 0;
  const late = paidAt > dueDate;
  return late ? MENSALIDADE_TABLE.late : MENSALIDADE_TABLE.punctual;
}

export function ensureClubRemittanceType(db: DatabaseShape, userId: string) {
  const existing = db.movementTypes.find(
    (item) => item.active && item.name.toLowerCase() === CLUB_REMITTANCE_MOVEMENT_NAME.toLowerCase(),
  );
  if (existing) return existing;
  const created = {
    id: id(),
    name: CLUB_REMITTANCE_MOVEMENT_NAME,
    direction: 'expense' as const,
    description: 'Repasse mensal da taxa Lindóia embutida nas mensalidades',
    pixKey: '',
    branch: 'grupo' as const,
    active: true,
    ...createdAudit(userId),
  };
  db.movementTypes.push(created);
  return created;
}

function findRemittanceRecord(db: DatabaseShape, year: number, month: number): ClubRemittanceRecord | null {
  const externalId = clubRemittanceExternalId(year, month);
  const tx = db.transactions.find((item) => item.externalId === externalId);
  if (!tx) return null;
  return {
    transactionId: tx.id,
    date: tx.date,
    amount: tx.amount,
    description: tx.description,
    method: tx.method,
    notes: tx.notes,
  };
}

function collectLines(db: DatabaseShape, year: number, month: number): ClubRemittanceLine[] {
  const prefix = `${year}-${pad2(month)}`;
  const lines: ClubRemittanceLine[] = [];
  for (const tx of db.transactions) {
    if (!isMensalidadeTx(db, tx)) continue;
    if (tx.paymentStatus !== 'paid') continue;
    if (!tx.paidAt) continue;
    if (!tx.paidAt.startsWith(prefix)) continue;
    if (!tx.memberId) continue;
    const member = db.members.find((item) => item.id === tx.memberId);
    if (!member) continue;
    if (!effectiveClubFeeIncluded(member, tx.clubFeeIncluded)) continue;
    const clubShare = remittanceClubShare(member, tx.date, tx.paidAt);
    if (clubShare <= 0) continue;
    lines.push({
      transactionId: tx.id,
      memberId: member.id,
      memberName: member.name,
      branch: member.branch,
      dueDate: tx.date.slice(0, 10),
      paidAt: tx.paidAt.slice(0, 10),
      amountPaid: tx.amount,
      clubShare,
      late: tx.paidAt > tx.date,
      competenceMonth: monthFromDate(tx.date),
    });
  }
  lines.sort((a, b) => {
    const byPaid = a.paidAt.localeCompare(b.paidAt);
    if (byPaid) return byPaid;
    return a.memberName.localeCompare(b.memberName, 'pt-BR');
  });
  return lines;
}

export function buildClubRemittancePreview(db: DatabaseShape, year: number, month: number): ClubRemittancePreview {
  const lines = collectLines(db, year, month);
  const total = roundMoney(lines.reduce((sum, line) => sum + line.clubShare, 0));
  return {
    year,
    month,
    clubShareOnTime: MENSALIDADE_TABLE.punctual,
    clubShareLate: MENSALIDADE_TABLE.late,
    lines,
    total,
    count: lines.length,
    remittance: findRemittanceRecord(db, year, month),
  };
}

export function buildClubRemittanceYearSummary(db: DatabaseShape, year: number): ClubRemittanceYearSummary {
  const months: ClubRemittanceMonthSummary[] = [];
  let totalDue = 0;
  let totalRemitted = 0;
  for (let month = 1; month <= 12; month += 1) {
    const preview = buildClubRemittancePreview(db, year, month);
    if (!preview.count && !preview.remittance) continue;
    months.push({
      month,
      count: preview.count,
      total: preview.total,
      remitted: Boolean(preview.remittance),
      remittanceAmount: preview.remittance?.amount ?? null,
    });
    totalDue = roundMoney(totalDue + preview.total);
    if (preview.remittance) totalRemitted = roundMoney(totalRemitted + preview.remittance.amount);
  }
  return {
    year,
    clubShareOnTime: MENSALIDADE_TABLE.punctual,
    clubShareLate: MENSALIDADE_TABLE.late,
    months,
    totalDue,
    totalRemitted,
  };
}

export function registerClubRemittance(
  db: DatabaseShape,
  input: {
    year: number;
    month: number;
    date?: string;
    method?: PaymentMethod;
    notes?: string;
  },
  userId: string,
): { remittance: Transaction; preview: ClubRemittancePreview } {
  const preview = buildClubRemittancePreview(db, input.year, input.month);
  if (preview.remittance) {
    throw new Error(`O repasse de ${pad2(input.month)}/${input.year} já foi registrado`);
  }
  if (preview.total <= 0) {
    throw new Error('Não há taxa do clube a repassar neste mês (nenhuma mensalidade paga com a taxa incluída)');
  }

  const movement = ensureClubRemittanceType(db, userId);
  const remittanceDate = input.date?.slice(0, 10) || todayISO();
  const method = input.method ?? 'transfer';
  const description = `Repasse Lindóia · ${pad2(input.month)}/${input.year} · ${preview.count} mensalidade(s)`;
  const notes =
    input.notes?.trim() ||
    `Taxa Lindóia arrecadada em pagamentos de ${pad2(input.month)}/${input.year} (pontual R$ ${MENSALIDADE_TABLE.punctual.toFixed(2).replace('.', ',')} / atraso R$ ${MENSALIDADE_TABLE.late.toFixed(2).replace('.', ',')}). Diluição do grupo não entra no repasse.`;

  const tx = createTransaction(
    db,
    {
      date: remittanceDate,
      type: 'expense',
      nature: 'fixed',
      movementTypeId: movement.id,
      description,
      amount: preview.total,
      branch: 'grupo',
      method,
      paymentStatus: 'paid',
      paidAt: remittanceDate,
      notes,
    },
    userId,
  );
  tx.externalId = clubRemittanceExternalId(input.year, input.month);

  return {
    remittance: tx,
    preview: buildClubRemittancePreview(db, input.year, input.month),
  };
}
