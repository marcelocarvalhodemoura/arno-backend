import { createdAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { DatabaseShape, Member } from '../shared/types';
import { roundMoney } from '../shared/types';

/**
 * Tabela oficial da mensalidade (cartaz do grupo).
 * Março–abril: valores anteriores à AGE.
 *   — demais ramos: R$ 60 (sem diferença pontual/atraso).
 *   — pioneiro: R$ 15 no prazo · R$ 20 após o vencimento.
 * Maio–novembro: cartaz atual (taxa do clube + diluição dez/jan/fev).
 * O dia de vencimento fica em Configurações.
 *
 * Não sócio até o dia 10: 75 + 10 + 4,50 = 89,50
 * Não sócio após o dia 10: 75 + 20 + 4,50 = 99,50
 * Filho de chefe / irmãos não sócio: 82 · sócio Lindóia: 67,50
 */

export const MENSALIDADE_TABLE = {
  earlyRegular: 60,
  earlyPioneer: 15,
  /** Pioneiro março/abril após o dia de vencimento. */
  earlyPioneerLate: 20,
  baseRegular: 75,
  basePioneer: 25,
  /** Diluição de dez/jan/fev — só em maio–novembro (taxa do clube cobre 12 meses). */
  extra: 4.5,
  /** Taxa Lindóia com pagamento até o dia 10. */
  punctual: 10,
  /** Taxa Lindóia após o dia 10. */
  late: 20,
  /**
   * Composição da mensalidade do grupo (R$ 75):
   * R$ 43 operacionais + R$ 8 caixinhas dos ramos + R$ 24 lanche.
   */
  branchShare: 8,
  operationalShare: 43,
  snackShare: 24,
  /** Filho de chefe / irmão(s) — não sócio (maio–novembro). */
  specialFamily: 82,
  /** Filho de chefe / irmão(s) — sócio Lindóia (maio–novembro). */
  specialFamilyMember: 67.5,
} as const;

/** Parcela da mensalidade destinada à caixinha do ramo. */
export const MENSALIDADE_BRANCH_SHARE = MENSALIDADE_TABLE.branchShare;

/** Valor especial — filho de chefe / irmão não sócio. */
export const SPECIAL_FAMILY_FEE = MENSALIDADE_TABLE.specialFamily;

/** Valor especial — filho de chefe / irmão sócio Lindóia. */
export const SPECIAL_FAMILY_FEE_MEMBER = MENSALIDADE_TABLE.specialFamilyMember;

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

export function specialFamilyFee(clubeLtc?: boolean): number {
  return clubeLtc ? SPECIAL_FAMILY_FEE_MEMBER : SPECIAL_FAMILY_FEE;
}

export function isSpecialFamilyFeeAmount(amount: number): boolean {
  return amountsNear(amount, SPECIAL_FAMILY_FEE) || amountsNear(amount, SPECIAL_FAMILY_FEE_MEMBER);
}

/** Valor especial cadastrado (filho de chefe / irmão no grupo). Null = usa a tabela. */
export function resolveFeeOverride(profile: { feeOverride?: number | null; clubeLtc?: boolean }): number | null {
  if (profile.feeOverride == null) return null;
  const n = Number(profile.feeOverride);
  if (!Number.isFinite(n) || n < 0) return null;
  // 82 ou 67,50 no cadastro → valor vigente conforme sócio Lindóia.
  if (isSpecialFamilyFeeAmount(n)) return specialFamilyFee(profile.clubeLtc);
  return roundMoney(n);
}

export const OFFICIAL_MENSALIDADE_FEES: { name: string; amount: number }[] = [
  {
    name: 'Mensalidade março/abril — não pioneiro',
    amount: MENSALIDADE_TABLE.earlyRegular,
  },
  {
    name: 'Mensalidade março/abril — pioneiro (pontual)',
    amount: MENSALIDADE_TABLE.earlyPioneer,
  },
  {
    name: 'Mensalidade março/abril — pioneiro (atraso)',
    amount: MENSALIDADE_TABLE.earlyPioneerLate,
  },
  {
    name: 'Mensalidade base — não pioneiro',
    amount: MENSALIDADE_TABLE.baseRegular,
  },
  {
    name: 'Mensalidade base — pioneiro',
    amount: MENSALIDADE_TABLE.basePioneer,
  },
  { name: 'Valor especial — filho de chefe / irmão (não sócio)', amount: SPECIAL_FAMILY_FEE },
  { name: 'Valor especial — filho de chefe / irmão (sócio)', amount: SPECIAL_FAMILY_FEE_MEMBER },
  { name: 'Taxa extra — diluição dez/jan/fev (maio–nov)', amount: MENSALIDADE_TABLE.extra },
  { name: 'Taxa Lindóia até o dia 10', amount: MENSALIDADE_TABLE.punctual },
  { name: 'Taxa Lindóia após o dia 10', amount: MENSALIDADE_TABLE.late },
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

/** Taxa Lindóia + diluição (maio–nov). */
export function clubFeeAddon(month: number, late: boolean): number {
  if (!isCurrentMensalidadeMonth(month)) return 0;
  const club = late ? MENSALIDADE_TABLE.late : MENSALIDADE_TABLE.punctual;
  return roundMoney(club + MENSALIDADE_TABLE.extra);
}

/**
 * Parcela do clube no vencimento pontual (compat / UI).
 * Valor especial familiar não tem parcela destacável.
 */
export function clubFeeShare(branch: string, month = 5, profile?: MensalidadeProfile): number {
  if (!isCurrentMensalidadeMonth(month)) return 0;
  if (profile && resolveFeeOverride(profile) != null) return 0;
  void branch;
  return clubFeeAddon(month, false);
}

export function onTimeMonthlyFee(profile: MensalidadeProfile, month = 5): number {
  if (!paysMensalidade(profile)) return 0;
  if (isEarlyMensalidadeMonth(month)) return mensalidadeBase(profile.branch, month);
  const override = resolveFeeOverride(profile);
  if (override != null) return override;
  const base = mensalidadeBase(profile.branch, month);
  if (profile.clubeLtc) return base;
  return roundMoney(base + clubFeeAddon(month, false));
}

export function lateMonthlyFee(profile: MensalidadeProfile, month = 5): number {
  if (!paysMensalidade(profile)) return 0;
  if (isEarlyMensalidadeMonth(month)) {
    if (profile.branch === 'pioneiro') return MENSALIDADE_TABLE.earlyPioneerLate;
    return mensalidadeBase(profile.branch, month);
  }
  const override = resolveFeeOverride(profile);
  if (override != null) return override;
  const base = mensalidadeBase(profile.branch, month);
  if (profile.clubeLtc) return base;
  return roundMoney(base + clubFeeAddon(month, true));
}

export function expectedMonthlyFee(profile: MensalidadeProfile, dueDate: string, today: string): number {
  const month = monthFromDate(dueDate);
  return dueDate < today ? lateMonthlyFee(profile, month) : onTimeMonthlyFee(profile, month);
}

/**
 * Valor do mês com ou sem a taxa do Lindóia (+ diluição).
 * Sem taxa → só a base do grupo (R$ 75 / R$ 25 pioneiro).
 * Com taxa → base + (R$ 10 ou R$ 20) + R$ 4,50.
 * Valor especial familiar (82 / 67,50): fixo; clubFeeIncluded não altera.
 */
export function expectedMensalidadeAmount(
  profile: MensalidadeProfile,
  dueDate: string,
  today: string,
  clubFeeIncluded: boolean,
): number {
  if (!paysMensalidade(profile)) return 0;
  const month = monthFromDate(dueDate);
  if (isEarlyMensalidadeMonth(month)) {
    const late = dueDate < today;
    if (profile.branch === 'pioneiro' && late) return MENSALIDADE_TABLE.earlyPioneerLate;
    return mensalidadeBase(profile.branch, month);
  }

  const override = resolveFeeOverride(profile);
  if (override != null) return override;

  const base = mensalidadeBase(profile.branch, month);
  if (!clubFeeIncluded) return base;

  const late = dueDate < today;
  return roundMoney(base + clubFeeAddon(month, late));
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
    const due = `2026-${String(month).padStart(2, '0')}-10`;
    const onTimeToday = due;
    const lateToday = `2026-${String(month).padStart(2, '0')}-11`;
    for (const club of [true, false]) {
      if (amountsNear(amount, expectedMensalidadeAmount(profile, due, onTimeToday, club))) return true;
      if (amountsNear(amount, expectedMensalidadeAmount(profile, due, lateToday, club))) return true;
    }
  }
  return false;
}

export function matchesMensalidadeAmount(profile: MensalidadeProfile, amount: number): boolean {
  // Clube da Flor de Lis, escotistas e dirigentes não pagam: nenhum valor é "mensalidade" deles.
  if (!paysMensalidade(profile)) return false;
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
