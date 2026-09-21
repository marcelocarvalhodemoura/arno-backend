import { createdAudit } from "../shared/audit";
import { id } from "../shared/id";
import type { DatabaseShape, Member } from "../shared/types";
import { roundMoney } from "../shared/types";

/** Tabela oficial da mensalidade (cartaz do grupo). O dia de vencimento fica em Configurações. */

export const MENSALIDADE_TABLE = {
  baseRegular: 75,
  basePioneer: 25,
  extra: 4.5,
  punctual: 10,
  late: 20,
} as const;

export type MensalidadeProfile = { branch: string; clubeLtc?: boolean; monthlyFee?: number };

export const OFFICIAL_MENSALIDADE_FEES: { name: string; amount: number }[] = [
  { name: "Mensalidade base — não pioneiro", amount: MENSALIDADE_TABLE.baseRegular },
  { name: "Mensalidade base — pioneiro", amount: MENSALIDADE_TABLE.basePioneer },
  { name: "Taxa extra — não sócios", amount: MENSALIDADE_TABLE.extra },
  { name: "Taxa até o dia 10", amount: MENSALIDADE_TABLE.punctual },
  { name: "Taxa após o dia 10", amount: MENSALIDADE_TABLE.late },
  {
    name: "Não sócios até o dia 10",
    amount: roundMoney(MENSALIDADE_TABLE.baseRegular + MENSALIDADE_TABLE.punctual + MENSALIDADE_TABLE.extra),
  },
  {
    name: "Não sócios após o dia 10",
    amount: roundMoney(MENSALIDADE_TABLE.baseRegular + MENSALIDADE_TABLE.late + MENSALIDADE_TABLE.extra),
  },
  {
    name: "Jovens pioneiros até o dia 10",
    amount: roundMoney(MENSALIDADE_TABLE.basePioneer + MENSALIDADE_TABLE.punctual + MENSALIDADE_TABLE.extra),
  },
  {
    name: "Jovens pioneiros após o dia 10",
    amount: roundMoney(MENSALIDADE_TABLE.basePioneer + MENSALIDADE_TABLE.late + MENSALIDADE_TABLE.extra),
  },
  { name: "Sócios do Lindóia", amount: MENSALIDADE_TABLE.baseRegular },
  { name: "Jovens pioneiros sócios", amount: MENSALIDADE_TABLE.basePioneer },
];

export function amountsNear(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.05;
}

export function mensalidadeBase(branch: string): number {
  return branch === "pioneiro" ? MENSALIDADE_TABLE.basePioneer : MENSALIDADE_TABLE.baseRegular;
}

export function onTimeMonthlyFee(profile: MensalidadeProfile): number {
  const base = mensalidadeBase(profile.branch);
  if (profile.clubeLtc) return base;
  return roundMoney(base + MENSALIDADE_TABLE.punctual + MENSALIDADE_TABLE.extra);
}

export function lateMonthlyFee(profile: MensalidadeProfile): number {
  const base = mensalidadeBase(profile.branch);
  if (profile.clubeLtc) return base;
  return roundMoney(base + MENSALIDADE_TABLE.late + MENSALIDADE_TABLE.extra);
}

export function expectedMonthlyFee(profile: MensalidadeProfile, dueDate: string, today: string): number {
  return dueDate < today ? lateMonthlyFee(profile) : onTimeMonthlyFee(profile);
}

export function isOfficialMensalidadeAmount(profile: MensalidadeProfile, amount: number): boolean {
  return amountsNear(amount, onTimeMonthlyFee(profile)) || amountsNear(amount, lateMonthlyFee(profile));
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
