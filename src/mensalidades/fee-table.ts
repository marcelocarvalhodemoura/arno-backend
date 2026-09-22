import { createdAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { DatabaseShape, Member } from '../shared/types';
import { roundMoney } from '../shared/types';

/**
 * Tabela oficial da mensalidade (cartaz do grupo).
 * Março–abril: valores anteriores à AGE.
 * Maio–novembro: cartaz atual (taxa do clube + diluição dez/jan/fev).
 * O dia de vencimento fica em Configurações.
 */

export const MENSALIDADE_TABLE = {
  earlyRegular: 60,
  earlyPioneer: 15,
  baseRegular: 75,
  basePioneer: 25,
  /** Diluição de dez/jan/fev — só em maio–novembro. */
  extra: 4.5,
  punctual: 10,
  late: 20,
  /** Parcela do clube embutida na mensalidade (não pioneiros, a partir de maio). */
  clubShare: 20,
} as const;

/** Meses com a tabela antiga (valor total fixo). */
export function isEarlyMensalidadeMonth(month: number): boolean {
  return month === 3 || month === 4;
}

/** Meses em que a diluição R$ 4,50 e a taxa do clube entram na conta. */
export function isCurrentMensalidadeMonth(month: number): boolean {
  return month >= 5 && month <= 11;
}

export function monthFromDate(date: string): number {
  return Number(date.slice(5, 7));
}

export type MensalidadeProfile = {
  branch: string;
  role?: string;
  clubeLtc?: boolean;
  monthlyFee?: number;
  feeOverride?: number | null;
};

/** Dirigente, escotista e Clube da Flor de Lis não pagam mensalidade. */
export function paysMensalidade(profile: { role?: string; branch?: string }): boolean {
  if (profile.branch === 'flor-de-lis') return false;
  if (profile.role === 'escotista' || profile.role === 'dirigente' || profile.role === 'clube') return false;
  return true;
}

/** Valor especial cadastrado (filho de chefe / irmão no grupo). Null = usa a tabela. */
export function resolveFeeOverride(profile: { feeOverride?: number | null }): number | null {
  if (profile.feeOverride == null) return null;
  const n = Number(profile.feeOverride);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

export const OFFICIAL_MENSALIDADE_FEES: { name: string; amount: number }[] = [
  {
    name: 'Mensalidade março/abril — não pioneiro',
    amount: MENSALIDADE_TABLE.earlyRegular,
  },
  {
    name: 'Mensalidade março/abril — pioneiro',
    amount: MENSALIDADE_TABLE.earlyPioneer,
  },
  {
    name: 'Mensalidade base — não pioneiro',
    amount: MENSALIDADE_TABLE.baseRegular,
  },
  {
    name: 'Mensalidade base — pioneiro',
    amount: MENSALIDADE_TABLE.basePioneer,
  },
  { name: 'Valor especial — filho de chefe / irmão', amount: 82 },
  { name: 'Taxa extra — não sócios (maio–nov)', amount: MENSALIDADE_TABLE.extra },
  { name: 'Taxa até o dia 10', amount: MENSALIDADE_TABLE.punctual },
  { name: 'Taxa após o dia 10', amount: MENSALIDADE_TABLE.late },
  {
    name: 'Não sócios até o dia 10',
    amount: roundMoney(MENSALIDADE_TABLE.baseRegular + MENSALIDADE_TABLE.punctual + MENSALIDADE_TABLE.extra),
  },
  {
    name: 'Não sócios após o dia 10',
    amount: roundMoney(MENSALIDADE_TABLE.baseRegular + MENSALIDADE_TABLE.late + MENSALIDADE_TABLE.extra),
  },
  {
    name: 'Jovens pioneiros até o dia 10',
    amount: roundMoney(MENSALIDADE_TABLE.basePioneer + MENSALIDADE_TABLE.punctual + MENSALIDADE_TABLE.extra),
  },
  {
    name: 'Jovens pioneiros após o dia 10',
    amount: roundMoney(MENSALIDADE_TABLE.basePioneer + MENSALIDADE_TABLE.late + MENSALIDADE_TABLE.extra),
  },
  { name: 'Sócios do Lindóia', amount: MENSALIDADE_TABLE.baseRegular },
  { name: 'Jovens pioneiros sócios', amount: MENSALIDADE_TABLE.basePioneer },
];

export function amountsNear(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.05;
}

/** Sem mês → tabela vigente (maio–novembro). */
export function mensalidadeBase(branch: string, month = 5): number {
  if (isEarlyMensalidadeMonth(month)) {
    return branch === 'pioneiro' ? MENSALIDADE_TABLE.earlyPioneer : MENSALIDADE_TABLE.earlyRegular;
  }
  return branch === 'pioneiro' ? MENSALIDADE_TABLE.basePioneer : MENSALIDADE_TABLE.baseRegular;
}

export function onTimeMonthlyFee(profile: MensalidadeProfile, month = 5): number {
  if (!paysMensalidade(profile)) return 0;
  if (isEarlyMensalidadeMonth(month)) return mensalidadeBase(profile.branch, month);
  const override = resolveFeeOverride(profile);
  if (override != null) return override;
  const base = mensalidadeBase(profile.branch, month);
  if (profile.clubeLtc) return base;
  return roundMoney(base + MENSALIDADE_TABLE.punctual + MENSALIDADE_TABLE.extra);
}

export function lateMonthlyFee(profile: MensalidadeProfile, month = 5): number {
  if (!paysMensalidade(profile)) return 0;
  if (isEarlyMensalidadeMonth(month)) return mensalidadeBase(profile.branch, month);
  const override = resolveFeeOverride(profile);
  if (override != null) return override;
  const base = mensalidadeBase(profile.branch, month);
  if (profile.clubeLtc) return base;
  return roundMoney(base + MENSALIDADE_TABLE.late + MENSALIDADE_TABLE.extra);
}

export function expectedMonthlyFee(profile: MensalidadeProfile, dueDate: string, today: string): number {
  const month = monthFromDate(dueDate);
  return dueDate < today ? lateMonthlyFee(profile, month) : onTimeMonthlyFee(profile, month);
}

/** Parcela do clube na mensalidade: R$ 20 a partir de maio (exceto pioneiros e override). */
export function clubFeeShare(branch: string, month = 5, profile?: MensalidadeProfile): number {
  if (!isCurrentMensalidadeMonth(month)) return 0;
  if (profile && resolveFeeOverride(profile) != null) return 0;
  return branch === 'pioneiro' ? 0 : MENSALIDADE_TABLE.clubShare;
}

/**
 * Valor do mês com ou sem a parcela do clube.
 * Não sócio: tabela oficial já inclui o clube → remover abate clubFeeShare.
 * Sócio Lindóia: tabela oficial já exclui → incluir soma clubFeeShare.
 * Março/abril ou feeOverride: valor fixo; clubFeeIncluded não altera o total.
 */
export function expectedMensalidadeAmount(
  profile: MensalidadeProfile,
  dueDate: string,
  today: string,
  clubFeeIncluded: boolean,
): number {
  const month = monthFromDate(dueDate);
  const standard = expectedMonthlyFee(profile, dueDate, today);
  const share = clubFeeShare(profile.branch, month, profile);
  if (!share) return standard;
  if (profile.clubeLtc) {
    return clubFeeIncluded ? roundMoney(standard + share) : standard;
  }
  return clubFeeIncluded ? standard : roundMoney(Math.max(0, standard - share));
}

/** Padrão do mês: não sócio inclui clube; sócio Lindóia não. */
export function defaultClubFeeIncluded(profile: { clubeLtc?: boolean }): boolean {
  return !profile.clubeLtc;
}

export function effectiveClubFeeIncluded(
  profile: { clubeLtc?: boolean },
  clubFeeIncluded: boolean | null | undefined,
): boolean {
  return clubFeeIncluded ?? defaultClubFeeIncluded(profile);
}

export function isOfficialMensalidadeAmount(profile: MensalidadeProfile, amount: number): boolean {
  const override = resolveFeeOverride(profile);
  if (override != null && amountsNear(amount, override)) return true;
  for (const month of [3, 5] as const) {
    const onTime = onTimeMonthlyFee(profile, month);
    const late = lateMonthlyFee(profile, month);
    if (amountsNear(amount, onTime) || amountsNear(amount, late)) return true;
    const share = clubFeeShare(profile.branch, month, profile);
    if (!share) continue;
    if (profile.clubeLtc) {
      if (amountsNear(amount, roundMoney(onTime + share)) || amountsNear(amount, roundMoney(late + share))) {
        return true;
      }
      continue;
    }
    if (
      amountsNear(amount, roundMoney(Math.max(0, onTime - share))) ||
      amountsNear(amount, roundMoney(Math.max(0, late - share)))
    ) {
      return true;
    }
  }
  return false;
}

export function matchesMensalidadeAmount(profile: MensalidadeProfile, amount: number): boolean {
  if (profile.monthlyFee !== undefined && amountsNear(amount, profile.monthlyFee)) return true;
  return isOfficialMensalidadeAmount(profile, amount);
}

export function applyOfficialFee(member: Member) {
  member.monthlyFee = onTimeMonthlyFee(member);
}

export function ensureOfficialMensalidadeFees(db: DatabaseShape, userId: string) {
  let created = 0;
  for (const item of OFFICIAL_MENSALIDADE_FEES) {
    const exists = db.fees.some((fee) => fee.name.toLowerCase() === item.name.toLowerCase());
    if (exists) continue;
    db.fees.push({
      id: id(),
      name: item.name,
      amount: roundMoney(item.amount),
      ...createdAudit(userId),
    });
    created += 1;
  }
  return created;
}
