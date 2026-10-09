import type { FeeComposition, FeeSchedulePeriod, MensalidadeFormula } from './types';

/**
 * Regras da mensalidade compartilhadas com o frontend (cálculo, período vigente, valores especiais).
 * O frontend recebe uma cópia gerada; altere aqui e rode `yarn sync:contract` no frontend.
 */

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Composição oficial da mensalidade, por período de vigência.
 * A tabela fica no banco (tela "Composição da mensalidade"); este é o padrão enquanto ninguém alterou.
 *
 * Março–abril/2026 (antes da AGE): R$ 60 = 35 operacional + 5 caixinha + 20 lanche, sem clube.
 *   Pioneiro R$ 15 no prazo · R$ 20 após o vencimento (divisão a confirmar).
 * Maio/2026 em diante (cartaz atual): R$ 75 = 43 operacional + 8 caixinha + 24 lanche
 *   + clube (R$ 10 até o vencimento · R$ 20 após) + diluição dez/jan/fev R$ 4,50 para não sócios.
 *   Pioneiro R$ 25 = 20 operacional + 5 caixinha.
 *   Irmãos / filho de chefe: R$ 82 não sócio · R$ 67,50 sócio Lindóia (divisão a confirmar).
 */

const ZERO: FeeComposition = { group: 0, branch: 0, snack: 0, clubOnTime: 0, clubLate: 0, dilution: 0, lateFee: 0 };

export function composition(parts: Partial<FeeComposition>): FeeComposition {
  return { ...ZERO, ...parts };
}

const DEFAULT_CREATED_AT = '2026-10-04T00:00:00.000Z';

export const DEFAULT_FEE_SCHEDULE: FeeSchedulePeriod[] = [
  {
    id: '0199b0a0-0000-7000-8000-000000000301',
    startMonth: '2026-03',
    endMonth: '2026-04',
    note: 'Tabela anterior à AGE',
    regular: composition({ group: 35, branch: 5, snack: 20 }),
    pioneer: composition({ group: 10, branch: 5, lateFee: 5, pendingSplit: true }),
    familyNonMember: null,
    familyMember: null,
    origin: 'manual',
    createdAt: DEFAULT_CREATED_AT,
  },
  {
    id: '0199b0a0-0000-7000-8000-000000000305',
    startMonth: '2026-05',
    endMonth: null,
    note: 'Cartaz atual (taxa do clube + diluição dez/jan/fev)',
    regular: composition({ group: 43, branch: 8, snack: 24, clubOnTime: 10, clubLate: 20, dilution: 4.5 }),
    pioneer: composition({ group: 20, branch: 5, clubOnTime: 10, clubLate: 20, dilution: 4.5 }),
    familyNonMember: composition({ group: 74, branch: 8, pendingSplit: true }),
    familyMember: composition({ group: 59.5, branch: 8, pendingSplit: true }),
    origin: 'manual',
    createdAt: DEFAULT_CREATED_AT,
  },
];

/** Valores especiais antigos gravados no cadastro (antes da tabela por período). */
export const LEGACY_FAMILY_FEES = { nonMember: 82, member: 67.5 };

export type FeeSchedule = FeeSchedulePeriod[];

function todayYearMonth(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

/** 'YYYY-MM' a partir de uma data ISO ou de 'YYYY-MM'; sem valor = mês atual. */
export function yearMonthOf(when?: string | null): string {
  return when ? when.slice(0, 7) : todayYearMonth();
}

export function periodCovers(period: Pick<FeeSchedulePeriod, 'startMonth' | 'endMonth'>, yearMonth: string): boolean {
  return period.startMonth <= yearMonth && (!period.endMonth || period.endMonth >= yearMonth);
}

/**
 * Período que vale no mês. Se mais de um cobre o mês, vence o que começou depois
 * (um ajuste de poucos meses dentro de um período aberto).
 */
export function periodFor(schedule: FeeSchedule, when?: string | null): FeeSchedulePeriod {
  const ym = yearMonthOf(when);
  const list = schedule.length ? schedule : DEFAULT_FEE_SCHEDULE;
  const byStartDesc = [...list].sort((a, b) => b.startMonth.localeCompare(a.startMonth));
  return (
    byStartDesc.find((period) => periodCovers(period, ym)) ??
    byStartDesc.find((period) => period.startMonth <= ym) ??
    byStartDesc[byStartDesc.length - 1]
  );
}

export function baseOf(parts: FeeComposition): number {
  return roundMoney(parts.group + parts.branch + parts.snack);
}

/** Valor fixo do perfil especial de família (sem atraso, sem alternar clube). */
export function familyTotalOf(parts: FeeComposition): number {
  return roundMoney(parts.group + parts.branch + parts.snack + parts.clubOnTime + parts.dilution);
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

export function amountsNear(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.05;
}

function familyTotals(schedule: FeeSchedule): number[] {
  const totals = [LEGACY_FAMILY_FEES.nonMember, LEGACY_FAMILY_FEES.member];
  for (const period of schedule) {
    if (period.familyNonMember) totals.push(familyTotalOf(period.familyNonMember));
    if (period.familyMember) totals.push(familyTotalOf(period.familyMember));
  }
  return totals;
}

/** O valor gravado no cadastro é um valor especial de família (de qualquer período)? */
export function isSpecialFamilyFeeAmount(amount: number, schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE): boolean {
  return familyTotals(schedule).some((total) => amountsNear(amount, total));
}

function familyCompositionFor(period: FeeSchedulePeriod, clubeLtc?: boolean): FeeComposition | null {
  return clubeLtc ? period.familyMember : period.familyNonMember;
}

/**
 * Valor especial de família a gravar no cadastro: o do mês informado (ou atual).
 * Se o período não tiver valor especial, usa o último período que tenha.
 */
export function specialFamilyFee(
  clubeLtc?: boolean,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
  when?: string,
): number {
  const current = familyCompositionFor(periodFor(schedule, when), clubeLtc);
  if (current) return familyTotalOf(current);
  const latest = [...schedule]
    .sort((a, b) => b.startMonth.localeCompare(a.startMonth))
    .map((period) => familyCompositionFor(period, clubeLtc))
    .find((item): item is FeeComposition => item != null);
  if (latest) return familyTotalOf(latest);
  return clubeLtc ? LEGACY_FAMILY_FEES.member : LEGACY_FAMILY_FEES.nonMember;
}

/** Valor especial cadastrado (filho de chefe / irmão no grupo). Null = usa a tabela. */
export function resolveFeeOverride(
  profile: { feeOverride?: number | null; clubeLtc?: boolean },
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
  when?: string,
): number | null {
  if (profile.feeOverride == null) return null;
  const n = Number(profile.feeOverride);
  if (!Number.isFinite(n) || n < 0) return null;
  // Valor especial no cadastro → valor vigente conforme sócio Lindóia.
  if (isSpecialFamilyFeeAmount(n, schedule)) return specialFamilyFee(profile.clubeLtc, schedule, when);
  return roundMoney(n);
}

export type ResolvedFee =
  | { kind: 'table'; parts: FeeComposition }
  | { kind: 'fixed'; special: 'family' | 'custom'; parts: FeeComposition; total: number };

/**
 * Composição que vale para o associado no mês.
 * Período sem valor especial de família ignora o valor especial/personalizado do cadastro (tabela normal).
 */
export function resolveFee(profile: MensalidadeProfile, when: string | undefined, schedule: FeeSchedule): ResolvedFee {
  const period = periodFor(schedule, when);
  const table = profile.branch === 'pioneiro' ? period.pioneer : period.regular;
  const hasFamily = period.familyNonMember != null || period.familyMember != null;
  if (!hasFamily || profile.feeOverride == null) return { kind: 'table', parts: table };
  const override = Number(profile.feeOverride);
  if (!Number.isFinite(override) || override < 0) return { kind: 'table', parts: table };

  if (isSpecialFamilyFeeAmount(override, schedule)) {
    const family = familyCompositionFor(period, profile.clubeLtc);
    if (family) return { kind: 'fixed', special: 'family', parts: family, total: familyTotalOf(family) };
    return { kind: 'table', parts: table };
  }

  // Valor personalizado: a caixinha do ramo sai primeiro, o resto vai para o grupo.
  const total = roundMoney(override);
  const branch = Math.min(table.branch, total);
  return {
    kind: 'fixed',
    special: 'custom',
    parts: composition({ group: roundMoney(total - branch), branch }),
    total,
  };
}

/** Fórmula da mensalidade do mês, parcela por parcela (diluição e acréscimo por atraso separados). */
export function mensalidadeFormula(
  profile: MensalidadeProfile,
  dueDate: string,
  opts: { late: boolean; clubFeeIncluded: boolean },
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): MensalidadeFormula {
  if (!paysMensalidade(profile)) {
    return {
      source: 'table',
      group: 0,
      branch: 0,
      snack: 0,
      club: 0,
      dilution: 0,
      lateFee: 0,
      total: 0,
      pendingSplit: false,
    };
  }
  const resolved = resolveFee(profile, dueDate, schedule);
  const parts = resolved.parts;
  if (resolved.kind === 'fixed') {
    return {
      source: resolved.special,
      group: parts.group,
      branch: parts.branch,
      snack: parts.snack,
      club: parts.clubOnTime,
      dilution: parts.dilution,
      lateFee: 0,
      total: resolved.total,
      pendingSplit: Boolean(parts.pendingSplit),
    };
  }
  const lateFee = opts.late ? parts.lateFee : 0;
  const club = opts.clubFeeIncluded ? (opts.late ? parts.clubLate : parts.clubOnTime) : 0;
  const dilution = opts.clubFeeIncluded ? parts.dilution : 0;
  return {
    source: 'table',
    group: parts.group,
    branch: parts.branch,
    snack: parts.snack,
    club,
    dilution,
    lateFee,
    total: roundMoney(parts.group + lateFee + dilution + parts.branch + parts.snack + club),
    pendingSplit: Boolean(parts.pendingSplit),
  };
}

export type MensalidadeShares = {
  group: number;
  branch: number;
  snack: number;
  club: number;
  total: number;
  pendingSplit: boolean;
};

/**
 * Para onde vai cada real da mensalidade.
 * `late`: pago após o vencimento. `clubFeeIncluded`: taxa do clube cobrada neste mês.
 * Diluição e acréscimo por atraso vão para o caixa do grupo.
 */
export function mensalidadeShares(
  profile: MensalidadeProfile,
  dueDate: string,
  opts: { late: boolean; clubFeeIncluded: boolean },
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): MensalidadeShares {
  const formula = mensalidadeFormula(profile, dueDate, opts, schedule);
  return {
    group: roundMoney(formula.group + formula.dilution + formula.lateFee),
    branch: formula.branch,
    snack: formula.snack,
    club: formula.club,
    total: formula.total,
    pendingSplit: formula.pendingSplit,
  };
}

/**
 * Valor do mês com ou sem a taxa do clube (+ diluição).
 * Sem taxa → só a base do grupo. Com taxa → base + clube (no prazo ou atraso) + diluição.
 * Valor especial de família: fixo; clubFeeIncluded não altera.
 */
export function expectedMensalidadeAmount(
  profile: MensalidadeProfile,
  dueDate: string,
  today: string,
  clubFeeIncluded: boolean,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): number {
  return mensalidadeShares(profile, dueDate, { late: dueDate < today, clubFeeIncluded }, schedule).total;
}

/** Valor no prazo. `when` = mês (YYYY-MM ou data); sem valor = mês atual. */
export function onTimeMonthlyFee(
  profile: MensalidadeProfile,
  when?: string,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): number {
  const ym = yearMonthOf(when);
  return mensalidadeShares(profile, `${ym}-01`, { late: false, clubFeeIncluded: !profile.clubeLtc }, schedule).total;
}

export function lateMonthlyFee(
  profile: MensalidadeProfile,
  when?: string,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): number {
  const ym = yearMonthOf(when);
  return mensalidadeShares(profile, `${ym}-01`, { late: true, clubFeeIncluded: !profile.clubeLtc }, schedule).total;
}

export function expectedMonthlyFee(
  profile: MensalidadeProfile,
  dueDate: string,
  today: string,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): number {
  return dueDate < today ? lateMonthlyFee(profile, dueDate, schedule) : onTimeMonthlyFee(profile, dueDate, schedule);
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

/** O valor bate com alguma combinação oficial (qualquer período, no prazo/atraso, com/sem clube)? */
export function isOfficialMensalidadeAmount(
  profile: MensalidadeProfile,
  amount: number,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): boolean {
  const override = resolveFeeOverride(profile, schedule);
  if (override != null && amountsNear(amount, override)) return true;
  for (const period of schedule.length ? schedule : DEFAULT_FEE_SCHEDULE) {
    const due = `${period.startMonth}-10`;
    for (const late of [false, true]) {
      for (const clubFeeIncluded of [true, false]) {
        const { total } = mensalidadeShares(profile, due, { late, clubFeeIncluded }, schedule);
        if (amountsNear(amount, total)) return true;
      }
    }
  }
  return false;
}

export function matchesMensalidadeAmount(
  profile: MensalidadeProfile,
  amount: number,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): boolean {
  // Clube da Flor de Lis, escotistas e dirigentes não pagam: nenhum valor é "mensalidade" deles.
  if (!paysMensalidade(profile)) return false;
  if (profile.monthlyFee !== undefined && amountsNear(amount, profile.monthlyFee)) return true;
  return isOfficialMensalidadeAmount(profile, amount, schedule);
}

/** Total no prazo / após o vencimento de um perfil da tabela (não sócio). */
export function compositionTotals(parts: FeeComposition, fixed = false) {
  if (fixed) {
    const total = familyTotalOf(parts);
    return { base: baseOf(parts), onTime: total, late: total };
  }
  const base = baseOf(parts);
  return {
    base,
    onTime: roundMoney(base + parts.clubOnTime + parts.dilution),
    late: roundMoney(base + parts.lateFee + parts.clubLate + parts.dilution),
  };
}

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function shortMonthLabel(yearMonth: string) {
  return `${MONTH_SHORT[Number(yearMonth.slice(5, 7)) - 1] ?? '?'}/${yearMonth.slice(0, 4)}`;
}

/** "A partir de mai/2026", "mar/2026 a abr/2026" ou "nov/2026". */
export function periodRangeLabel(period: Pick<FeeSchedulePeriod, 'startMonth' | 'endMonth'>): string {
  if (!period.endMonth) return `A partir de ${shortMonthLabel(period.startMonth)}`;
  if (period.endMonth === period.startMonth) return shortMonthLabel(period.startMonth);
  return `${shortMonthLabel(period.startMonth)} a ${shortMonthLabel(period.endMonth)}`;
}
