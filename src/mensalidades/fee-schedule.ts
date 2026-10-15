import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import type { DatabaseShape, FeeComposition, FeeSchedulePeriod } from '../shared/types';
import { roundMoney } from '../shared/types';
import { siblingIdsOf } from '../members/members';
import { baseOf, familyTotalOf, scheduleOf, specialFamilyFee } from './fee-table';
import { applyMensalidadeFee } from './mensalidades';
import { todayISO } from '../shared/dates';
import { BusinessRuleViolation } from '../shared/domain/errors';

export type FeePeriodInput = {
  startMonth: string;
  endMonth?: string | null;
  note?: string;
  regular: FeeComposition;
  pioneer: FeeComposition;
  familyNonMember: FeeComposition | null;
  familyMember: FeeComposition | null;
};

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function cleanComposition(parts: FeeComposition): FeeComposition {
  return {
    group: roundMoney(parts.group),
    branch: roundMoney(parts.branch),
    snack: roundMoney(parts.snack),
    clubOnTime: roundMoney(parts.clubOnTime),
    clubLate: roundMoney(parts.clubLate),
    dilution: roundMoney(parts.dilution),
    lateFee: roundMoney(parts.lateFee),
    pendingSplit: Boolean(parts.pendingSplit),
  };
}

function cleanInput(input: FeePeriodInput) {
  const startMonth = input.startMonth.trim();
  const endMonth = input.endMonth?.trim() || null;
  if (!YEAR_MONTH.test(startMonth)) throw new BusinessRuleViolation('Mês de início inválido (use AAAA-MM)');
  if (endMonth && !YEAR_MONTH.test(endMonth)) throw new BusinessRuleViolation('Mês de fim inválido (use AAAA-MM)');
  if (endMonth && endMonth < startMonth) throw new BusinessRuleViolation('O mês de fim não pode ser antes do início');

  const regular = cleanComposition(input.regular);
  const pioneer = cleanComposition(input.pioneer);
  if (!(baseOf(regular) > 0))
    throw new BusinessRuleViolation('A mensalidade normal precisa de um valor maior que zero');
  if (!(baseOf(pioneer) > 0))
    throw new BusinessRuleViolation('A mensalidade do pioneiro precisa de um valor maior que zero');

  const familyNonMember = input.familyNonMember ? cleanComposition(input.familyNonMember) : null;
  const familyMember = input.familyMember ? cleanComposition(input.familyMember) : null;
  if (Boolean(familyNonMember) !== Boolean(familyMember)) {
    throw new BusinessRuleViolation(
      'Informe o valor especial de família para não sócio e para sócio, ou deixe os dois sem valor',
    );
  }
  for (const family of [familyNonMember, familyMember]) {
    if (family && !(familyTotalOf(family) > 0))
      throw new BusinessRuleViolation('O valor especial de família precisa ser maior que zero');
  }

  return {
    startMonth,
    endMonth,
    note: (input.note ?? '').trim(),
    regular,
    pioneer,
    familyNonMember,
    familyMember,
  };
}

function assertUniqueStart(schedule: FeeSchedulePeriod[], startMonth: string, ignoreId?: string) {
  if (schedule.some((period) => period.id !== ignoreId && period.startMonth === startMonth)) {
    throw new BusinessRuleViolation(`Já existe um período começando em ${startMonth}`);
  }
}

/** Grava a tabela padrão no banco antes da primeira alteração (se ainda não estiver). */
function ensureSchedule(db: DatabaseShape): FeeSchedulePeriod[] {
  if (!db.feeSchedule?.length) db.feeSchedule = structuredClone(scheduleOf(db));
  return db.feeSchedule;
}

export function sortedSchedule(db: DatabaseShape): FeeSchedulePeriod[] {
  return [...scheduleOf(db)].sort((a, b) => a.startMonth.localeCompare(b.startMonth));
}

/**
 * Depois de mudar a tabela: valor especial de família no cadastro, mensalidade de referência
 * do associado e cobranças em aberto passam a seguir a composição nova. Pagas não mudam.
 */
function reapplySchedule(db: DatabaseShape, userId: string, today: string) {
  const schedule = scheduleOf(db);
  for (const member of db.members) {
    if (member.chiefChild || siblingIdsOf(db, member.id).length > 0) {
      member.feeOverride = specialFamilyFee(member.clubeLtc, schedule);
    }
  }
  applyMensalidadeFee(db, 0, 0, userId, today);
}

export function createFeePeriod(db: DatabaseShape, input: FeePeriodInput, userId: string, today = todayISO()) {
  const schedule = ensureSchedule(db);
  const data = cleanInput(input);
  assertUniqueStart(schedule, data.startMonth);
  const period: FeeSchedulePeriod = { id: id(), ...data, ...createdAudit(userId) };
  schedule.push(period);
  reapplySchedule(db, userId, today);
  return period;
}

export function updateFeePeriod(
  db: DatabaseShape,
  periodId: string,
  input: FeePeriodInput,
  userId: string,
  today = todayISO(),
) {
  const schedule = ensureSchedule(db);
  const period = schedule.find((item) => item.id === periodId);
  if (!period) return null;
  const data = cleanInput(input);
  assertUniqueStart(schedule, data.startMonth, periodId);
  Object.assign(period, data, updatedAudit(userId));
  reapplySchedule(db, userId, today);
  return period;
}

export function deleteFeePeriod(db: DatabaseShape, periodId: string, userId: string, today = todayISO()) {
  const schedule = ensureSchedule(db);
  const index = schedule.findIndex((item) => item.id === periodId);
  if (index < 0) return false;
  if (schedule.length === 1) throw new BusinessRuleViolation('A tabela precisa de pelo menos um período');
  schedule.splice(index, 1);
  reapplySchedule(db, userId, today);
  return true;
}
