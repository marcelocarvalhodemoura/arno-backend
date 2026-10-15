import { createdAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { DatabaseShape, Member } from '../shared/types';
import { roundMoney } from '../shared/types';
import {
  baseOf,
  DEFAULT_FEE_SCHEDULE,
  LEGACY_FAMILY_FEES,
  onTimeMonthlyFee,
  type FeeSchedule,
} from '../contract/fee-rules';

export * from '../contract/fee-rules';

export function scheduleOf(db?: Pick<DatabaseShape, 'feeSchedule'> | null): FeeSchedule {
  return db?.feeSchedule?.length ? db.feeSchedule : DEFAULT_FEE_SCHEDULE;
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
