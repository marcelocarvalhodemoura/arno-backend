import { createdAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { DatabaseShape, FeeComposition, FeeSchedulePeriod, Member } from '../shared/types';
import { roundMoney } from '../shared/types';

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

function composition(parts: Partial<FeeComposition>): FeeComposition {
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
const LEGACY_FAMILY_FEES = { nonMember: 82, member: 67.5 };

export type FeeSchedule = FeeSchedulePeriod[];

export function scheduleOf(db?: Pick<DatabaseShape, 'feeSchedule'> | null): FeeSchedule {
  return db?.feeSchedule?.length ? db.feeSchedule : DEFAULT_FEE_SCHEDULE;
}

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

type ResolvedFee = { kind: 'table'; parts: FeeComposition } | { kind: 'fixed'; parts: FeeComposition; total: number };

/**
 * Composição que vale para o associado no mês.
 * Período sem valor especial de família ignora o valor especial/personalizado do cadastro (tabela normal).
 */
function resolveFee(profile: MensalidadeProfile, when: string | undefined, schedule: FeeSchedule): ResolvedFee {
  const period = periodFor(schedule, when);
  const table = profile.branch === 'pioneiro' ? period.pioneer : period.regular;
  const hasFamily = period.familyNonMember != null || period.familyMember != null;
  if (!hasFamily || profile.feeOverride == null) return { kind: 'table', parts: table };
  const override = Number(profile.feeOverride);
  if (!Number.isFinite(override) || override < 0) return { kind: 'table', parts: table };

  if (isSpecialFamilyFeeAmount(override, schedule)) {
    const family = familyCompositionFor(period, profile.clubeLtc);
    if (family) return { kind: 'fixed', parts: family, total: familyTotalOf(family) };
    return { kind: 'table', parts: table };
  }

  // Valor personalizado: a caixinha do ramo sai primeiro, o resto vai para o grupo.
  const total = roundMoney(override);
  const branch = Math.min(table.branch, total);
  return { kind: 'fixed', parts: composition({ group: roundMoney(total - branch), branch }), total };
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
 */
export function mensalidadeShares(
  profile: MensalidadeProfile,
  dueDate: string,
  opts: { late: boolean; clubFeeIncluded: boolean },
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): MensalidadeShares {
  if (!paysMensalidade(profile)) {
    return { group: 0, branch: 0, snack: 0, club: 0, total: 0, pendingSplit: false };
  }
  const resolved = resolveFee(profile, dueDate, schedule);
  const parts = resolved.parts;
  if (resolved.kind === 'fixed') {
    return {
      group: roundMoney(parts.group + parts.dilution),
      branch: parts.branch,
      snack: parts.snack,
      club: parts.clubOnTime,
      total: resolved.total,
      pendingSplit: Boolean(parts.pendingSplit),
    };
  }
  const lateFee = opts.late ? parts.lateFee : 0;
  const club = opts.clubFeeIncluded ? (opts.late ? parts.clubLate : parts.clubOnTime) : 0;
  const dilution = opts.clubFeeIncluded ? parts.dilution : 0;
  const group = roundMoney(parts.group + lateFee + dilution);
  return {
    group,
    branch: parts.branch,
    snack: parts.snack,
    club,
    total: roundMoney(group + parts.branch + parts.snack + club),
    pendingSplit: Boolean(parts.pendingSplit),
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

export function applyOfficialFee(member: Member, schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE) {
  member.monthlyFee = onTimeMonthlyFee(member, undefined, schedule);
}

/** Nomes de referência na tela "Taxa" (reconhecimento de Pix no extrato; não alteram o cálculo). */
function officialMensalidadeFees(): { name: string; amount: number }[] {
  const [early, current] = DEFAULT_FEE_SCHEDULE;
  const regular = current.regular;
  const pioneer = current.pioneer;
  const regularBase = baseOf(regular);
  const pioneerBase = baseOf(pioneer);
  return [
    { name: 'Mensalidade março/abril — não pioneiro', amount: baseOf(early.regular) },
    { name: 'Mensalidade março/abril — pioneiro (pontual)', amount: baseOf(early.pioneer) },
    {
      name: 'Mensalidade março/abril — pioneiro (atraso)',
      amount: roundMoney(baseOf(early.pioneer) + early.pioneer.lateFee),
    },
    { name: 'Mensalidade base — não pioneiro', amount: regularBase },
    { name: 'Mensalidade base — pioneiro', amount: pioneerBase },
    { name: 'Valor especial — filho de chefe / irmão (não sócio)', amount: LEGACY_FAMILY_FEES.nonMember },
    { name: 'Valor especial — filho de chefe / irmão (sócio)', amount: LEGACY_FAMILY_FEES.member },
    { name: 'Taxa extra — diluição dez/jan/fev (maio–nov)', amount: regular.dilution },
    { name: 'Taxa Lindóia até o dia 10', amount: regular.clubOnTime },
    { name: 'Taxa Lindóia após o dia 10', amount: regular.clubLate },
    {
      name: 'Não sócios até o dia 10',
      amount: roundMoney(regularBase + regular.clubOnTime + regular.dilution),
    },
    {
      name: 'Não sócios após o dia 10',
      amount: roundMoney(regularBase + regular.clubLate + regular.dilution),
    },
    {
      name: 'Jovens pioneiros até o dia 10',
      amount: roundMoney(pioneerBase + pioneer.clubOnTime + pioneer.dilution),
    },
    {
      name: 'Jovens pioneiros após o dia 10',
      amount: roundMoney(pioneerBase + pioneer.clubLate + pioneer.dilution),
    },
    { name: 'Sócios do Lindóia', amount: regularBase },
    { name: 'Jovens pioneiros sócios', amount: pioneerBase },
  ];
}

export const OFFICIAL_MENSALIDADE_FEES = officialMensalidadeFees();

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
