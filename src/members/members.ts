import { fold } from '../shared/csv';
import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import { upperCaseName } from '../shared/name';
import { isMensalidadeName } from '../statement/statement';
import type {
  DatabaseShape,
  DepartureKind,
  Member,
  MemberAccount,
  MemberGuardian,
  MemberSibling,
  MemberStatus,
  MemberStatusHistory,
  RecordOrigin,
} from '../shared/types';
import {
  optionalContactEmail,
  type AccountInput,
  type CreateMemberInput,
  type GuardianInput,
  type MemberImportRow,
  type PatchMemberInput,
} from '../shared/http/schemas';
import {
  isSpecialFamilyFeeAmount,
  onTimeMonthlyFee,
  paysMensalidade,
  resolveFeeOverride,
  scheduleOf,
  specialFamilyFee,
} from '../mensalidades/fee-table';
import {
  assignOfficialFee,
  cancelUnpaidMensalidades,
  isMensalidadeYearGenerated,
  paidMensalidadesInAbsence,
  refreshPendingMensalidadeSchedule,
  statusEffectiveDate,
  syncMensalidades,
  todayISO,
  trashMensalidadesInAbsence,
} from '../mensalidades/mensalidades';

function normalizeFeeOverride(db: DatabaseShape, value: number | null | undefined, clubeLtc?: boolean): number | null {
  return resolveFeeOverride({ feeOverride: value == null ? null : value, clubeLtc }, scheduleOf(db));
}

export function siblingIdsOf(db: DatabaseShape, memberId: string): string[] {
  return (db.memberSiblings ?? []).filter((link) => link.memberId === memberId).map((link) => link.siblingId);
}

export function assertFamilyDiscountXor(chiefChild: boolean, siblingIds: string[]) {
  if (chiefChild && siblingIds.length > 0) {
    throw new Error('Escolha só uma opção: filho de chefe ou irmão(s) no grupo');
  }
}

function refreshFamilyFee(db: DatabaseShape, memberId: string) {
  const member = db.members.find((item) => item.id === memberId);
  if (!member) return;
  if (member.chiefChild) {
    member.feeOverride = specialFamilyFee(member.clubeLtc, scheduleOf(db));
    assignOfficialFee(member, undefined, scheduleOf(db));
    return;
  }
  if (siblingIdsOf(db, memberId).length > 0) {
    member.feeOverride = specialFamilyFee(member.clubeLtc, scheduleOf(db));
    assignOfficialFee(member, undefined, scheduleOf(db));
    return;
  }
  if (member.feeOverride != null && isSpecialFamilyFeeAmount(member.feeOverride, scheduleOf(db))) {
    member.feeOverride = null;
  }
  assignOfficialFee(member, undefined, scheduleOf(db));
}

/** Substitui os irmãos do associado e mantém o vínculo bidirecional. */
export function replaceSiblings(db: DatabaseShape, memberId: string, siblingIds: string[], userId: string) {
  const unique = [...new Set(siblingIds.map((item) => item.trim()).filter(Boolean))].filter(
    (item) => item !== memberId,
  );
  for (const siblingId of unique) {
    const sibling = db.members.find((item) => item.id === siblingId);
    if (!sibling) throw new Error('Irmão vinculado não encontrado');
    if (sibling.chiefChild) {
      throw new Error(`Não é possível vincular ${sibling.name}: já marcado como filho de chefe`);
    }
  }

  const previous = siblingIdsOf(db, memberId);
  const nextSet = new Set(unique);

  db.memberSiblings = (db.memberSiblings ?? []).filter((link) => {
    if (link.memberId === memberId) return nextSet.has(link.siblingId);
    if (link.siblingId === memberId) return nextSet.has(link.memberId);
    return true;
  });

  const now = new Date().toISOString();
  for (const siblingId of unique) {
    const hasForward = (db.memberSiblings ?? []).some(
      (link) => link.memberId === memberId && link.siblingId === siblingId,
    );
    if (!hasForward) {
      const forward: MemberSibling = {
        id: id(),
        memberId,
        siblingId,
        createdAt: now,
        createdBy: userId,
      };
      db.memberSiblings.push(forward);
    }
    const hasBack = (db.memberSiblings ?? []).some(
      (link) => link.memberId === siblingId && link.siblingId === memberId,
    );
    if (!hasBack) {
      const back: MemberSibling = {
        id: id(),
        memberId: siblingId,
        siblingId: memberId,
        createdAt: now,
        createdBy: userId,
      };
      db.memberSiblings.push(back);
    }
  }

  const affected = new Set<string>([memberId, ...previous, ...unique]);
  for (const affectedId of affected) {
    refreshFamilyFee(db, affectedId);
  }
}

/**
 * Aplica filho de chefe XOR irmãos e sincroniza feeOverride com o valor especial da composição (não sócio / sócio).
 * Se nenhum dos campos de família vier no payload, preserva feeOverride manual.
 */
export function applyFamilyDiscount(
  db: DatabaseShape,
  member: Member,
  input: { chiefChild?: boolean; siblingIds?: string[]; feeOverride?: number | null },
  userId: string,
) {
  const touchesFamily = input.chiefChild !== undefined || input.siblingIds !== undefined;
  if (!touchesFamily) {
    if (input.feeOverride !== undefined) {
      member.feeOverride =
        input.feeOverride === null ? null : normalizeFeeOverride(db, input.feeOverride, member.clubeLtc);
    } else if (member.chiefChild || siblingIdsOf(db, member.id).length > 0) {
      // Sócio Lindóia alterado: recalcula 82 ↔ 67,50.
      member.feeOverride = specialFamilyFee(member.clubeLtc, scheduleOf(db));
    }
    return;
  }

  if (input.chiefChild === true && input.siblingIds !== undefined && input.siblingIds.length > 0) {
    throw new Error('Escolha só uma opção: filho de chefe ou irmão(s) no grupo');
  }

  let chiefChild = input.chiefChild ?? Boolean(member.chiefChild);
  let siblingIds = input.siblingIds !== undefined ? input.siblingIds : siblingIdsOf(db, member.id);

  if (input.chiefChild === true) {
    chiefChild = true;
    siblingIds = [];
  } else if (input.siblingIds !== undefined && input.siblingIds.length > 0) {
    chiefChild = false;
  }

  assertFamilyDiscountXor(chiefChild, siblingIds);
  member.chiefChild = chiefChild;
  replaceSiblings(db, member.id, chiefChild ? [] : siblingIds, userId);

  if (chiefChild) {
    member.feeOverride = specialFamilyFee(member.clubeLtc, scheduleOf(db));
  } else if (siblingIdsOf(db, member.id).length > 0) {
    member.feeOverride = specialFamilyFee(member.clubeLtc, scheduleOf(db));
  } else {
    member.feeOverride = null;
  }
}

export function cleanedGuardians(list: GuardianInput[]) {
  return list
    .map((item) => ({
      id: item.id,
      name: upperCaseName(item.name),
      relationship: item.relationship.trim(),
      phone: (item.phone ?? '').trim(),
      email: optionalContactEmail(item.email),
    }))
    .filter((item) => item.name.length >= 2);
}

/** Pioneiros e adultos usam o próprio e-mail; os ramos abaixo usam o do responsável. */
export function ownsContactEmail(member: { branch: string; role: string }) {
  return member.role !== 'jovem' || member.branch === 'pioneiro';
}

export function memberContactEmail(
  member: { branch: string; role: string },
  ownEmail: string,
  guardians: { email: string }[],
) {
  const own = optionalContactEmail(ownEmail).toLowerCase();
  if (ownsContactEmail(member)) return own;
  const guardian = guardians.map((item) => optionalContactEmail(item.email)).find(Boolean);
  return (guardian ?? own).toLowerCase();
}

function guardiansOf(db: DatabaseShape, memberId: string) {
  return (db.memberGuardians ?? []).filter((item) => item.memberId === memberId);
}

function assertContactEmail(member: { branch: string; role: string; email: string }) {
  if (member.email) return;
  throw new Error(
    ownsContactEmail(member) ? 'Informe o e-mail do associado' : 'Informe o e-mail de pelo menos um responsável',
  );
}

export function assertYouthGuardians(role: string, count: number) {
  if (role === 'jovem' && count < 1) {
    throw new Error('Informe pelo menos um responsável do jovem');
  }
}

export function replaceGuardians(
  db: DatabaseShape,
  memberId: string,
  list: Array<{
    id?: string;
    name: string;
    relationship: string;
    phone: string;
    email: string;
  }>,
  userId: string,
  origin: RecordOrigin = 'manual',
) {
  const existing = (db.memberGuardians ?? []).filter((item) => item.memberId === memberId);
  const others = (db.memberGuardians ?? []).filter((item) => item.memberId !== memberId);
  const kept: MemberGuardian[] = [];
  const usedIds = new Set<string>();
  for (const item of list) {
    const current = item.id ? existing.find((guardian) => guardian.id === item.id) : undefined;
    if (current) {
      kept.push({
        ...current,
        name: item.name,
        relationship: item.relationship,
        phone: item.phone,
        email: item.email,
        ...updatedAudit(userId),
      });
      usedIds.add(current.id);
      continue;
    }
    kept.push({
      id: id(),
      memberId,
      name: item.name,
      relationship: item.relationship,
      phone: item.phone,
      email: item.email,
      ...createdAudit(userId, origin),
    });
  }
  const removed = new Set(existing.filter((item) => !usedIds.has(item.id)).map((item) => item.id));
  for (const tx of db.transactions) {
    if (tx.memberGuardianId && removed.has(tx.memberGuardianId)) {
      delete tx.memberGuardianId;
    }
  }
  db.memberGuardians = [...others, ...kept];
}

export function resolveGuardianId(db: DatabaseShape, memberId: string | undefined, guardianId: string | undefined) {
  if (!guardianId) return undefined;
  if (!memberId) throw new Error('Informe o associado do responsável');
  const guardian = (db.memberGuardians ?? []).find((item) => item.id === guardianId && item.memberId === memberId);
  if (!guardian) throw new Error('Responsável não pertence a este associado');
  return guardian.id;
}

/**
 * refreshOfficialFees mudaria algo? Mesma regra, sem copiar o banco: valor oficial diferente do gravado,
 * ou cobrança em aberto de quem não paga mensalidade.
 */
export function officialFeesStale(db: DatabaseShape): boolean {
  const schedule = scheduleOf(db);
  const nonPaying = new Set<string>();
  for (const member of db.members) {
    if (member.monthlyFee !== onTimeMonthlyFee(member, undefined, schedule)) return true;
    if (!paysMensalidade(member)) nonPaying.add(member.id);
  }
  if (!nonPaying.size) return false;
  const mensalidadeTypes = new Set(
    db.movementTypes.filter((item) => isMensalidadeName(item.name)).map((item) => item.id),
  );
  return db.transactions.some(
    (tx) =>
      tx.type === 'income' &&
      tx.paymentStatus !== 'paid' &&
      Boolean(tx.memberId && nonPaying.has(tx.memberId)) &&
      mensalidadeTypes.has(tx.movementTypeId),
  );
}

export function refreshOfficialFees(db: DatabaseShape) {
  for (const member of db.members) {
    assignOfficialFee(member, undefined, scheduleOf(db));
    if (!paysMensalidade(member)) cancelUnpaidMensalidades(db, member.id);
  }
  return db;
}

export function createMember(db: DatabaseShape, input: CreateMemberInput, userId: string): Member {
  const {
    guardians,
    feeOverride: feeOverrideInput,
    chiefChild: chiefChildInput,
    siblingIds: siblingIdsInput,
    ...data
  } = input;
  const list = cleanedGuardians(guardians ?? []);
  assertYouthGuardians(data.role, list.length);
  const email = memberContactEmail(data, data.email, list);
  assertContactEmail({ ...data, email });
  const created: Member = {
    id: id(),
    status: 'active',
    ...data,
    email,
    name: upperCaseName(data.name),
    chiefChild: false,
    feeOverride: null,
    monthlyFee: 0,
    ...createdAudit(userId),
  };
  db.members.push(created);
  replaceGuardians(db, created.id, list, userId);
  if (chiefChildInput !== undefined || siblingIdsInput !== undefined) {
    applyFamilyDiscount(
      db,
      created,
      {
        chiefChild: chiefChildInput ?? false,
        siblingIds: siblingIdsInput ?? [],
      },
      userId,
    );
  } else {
    created.feeOverride = normalizeFeeOverride(db, feeOverrideInput, created.clubeLtc);
  }
  assignOfficialFee(created, undefined, scheduleOf(db));
  return created;
}

export function updateMember(
  db: DatabaseShape,
  memberId: string,
  input: PatchMemberInput,
  userId: string,
): Member | null {
  const member = db.members.find((item) => item.id === memberId);
  if (!member) return null;
  const {
    guardians,
    feeOverride: feeOverrideInput,
    chiefChild: chiefChildInput,
    siblingIds: siblingIdsInput,
    ...data
  } = input;
  const nextRole = data.role ?? member.role;
  if (nextRole !== 'jovem') {
    replaceGuardians(db, member.id, [], userId);
  } else if (guardians) {
    const list = cleanedGuardians(guardians);
    assertYouthGuardians(nextRole, list.length);
    replaceGuardians(db, member.id, list, userId);
  } else if (data.role === 'jovem' && member.role !== 'jovem') {
    const count = (db.memberGuardians ?? []).filter((item) => item.memberId === member.id).length;
    assertYouthGuardians(nextRole, count);
  }
  const nextEmail = memberContactEmail(
    { branch: data.branch ?? member.branch, role: nextRole },
    data.email ?? member.email,
    guardiansOf(db, member.id),
  );
  assertContactEmail({ branch: data.branch ?? member.branch, role: nextRole, email: nextEmail });
  Object.assign(member, data);
  member.email = nextEmail;
  if (data.name !== undefined) member.name = upperCaseName(data.name);
  applyFamilyDiscount(
    db,
    member,
    {
      chiefChild: chiefChildInput,
      siblingIds: siblingIdsInput,
      feeOverride: feeOverrideInput,
    },
    userId,
  );
  if (nextRole !== 'jovem' && (member.chiefChild || siblingIdsOf(db, member.id).length)) {
    member.chiefChild = false;
    replaceSiblings(db, member.id, [], userId);
    member.feeOverride = null;
  }
  assignOfficialFee(member, userId, scheduleOf(db));
  if (!paysMensalidade(member)) {
    cancelUnpaidMensalidades(db, member.id);
  } else {
    refreshPendingMensalidadeSchedule(db, undefined, userId);
  }
  return member;
}

/** Acordo de atraso ainda em aberto (saldo > 0). Bloqueia a inativação do associado. */
export function memberHasOpenDebt(db: DatabaseShape, memberId: string): boolean {
  return (db.memberArrears ?? []).some(
    (plan) => plan.memberId === memberId && plan.status === 'active' && plan.balance > 0,
  );
}

export interface StatusChangeOptions {
  /** Quando a saída/retorno aconteceu de fato (YYYY-MM-DD). Padrão: hoje. */
  effectiveDate?: string;
  /** Obrigatório ao inativar pela API; informal exige `confirmedBy`. */
  kind?: DepartureKind;
  confirmedBy?: string;
  today?: string;
  now?: Date;
}

export interface StatusChangeResult {
  member: Member;
  /** Pendentes de meses de ausência que foram para a lixeira. */
  trashedIds: string[];
  /** Pagas em meses de ausência: ficam como estão, para a tesouraria decidir. */
  paidDuringAbsence: ReturnType<typeof paidMensalidadesInAbsence>;
}

function formatDay(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

function memberHistoryInOrder(db: DatabaseShape, memberId: string) {
  return (db.memberStatusHistory ?? [])
    .filter((entry) => entry.memberId === memberId)
    .sort((a, b) => statusEffectiveDate(a).localeCompare(statusEffectiveDate(b)) || a.at.localeCompare(b.at));
}

/** A data efetiva cabe entre a entrada no grupo, a mudança anterior, a seguinte e hoje? */
function assertEffectiveDateInRange(
  member: Member,
  date: string,
  today: string,
  previous: MemberStatusHistory | undefined,
  next: MemberStatusHistory | undefined,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Informe a data efetiva no formato AAAA-MM-DD');
  if (date > today) throw new Error('A data efetiva não pode ser no futuro');
  const joined = member.joinedAt?.slice(0, 10);
  if (joined && date < joined) {
    throw new Error(`A data efetiva não pode ser anterior à entrada no grupo (${formatDay(joined)})`);
  }
  if (previous && date < statusEffectiveDate(previous)) {
    throw new Error(
      `A data efetiva não pode ser anterior à mudança de situação anterior (${formatDay(statusEffectiveDate(previous))})`,
    );
  }
  if (next && date > statusEffectiveDate(next)) {
    throw new Error(
      `A data efetiva não pode ser posterior à mudança de situação seguinte (${formatDay(statusEffectiveDate(next))})`,
    );
  }
}

/**
 * Depois de mudar o histórico: pendentes em meses de ausência vão para a lixeira e, se o associado está ativo,
 * os anos já gerados são completados com os meses que voltaram a ser devidos.
 */
function reconcileMemberCharges(
  db: DatabaseShape,
  member: Member,
  fromDate: string,
  userId: string,
  today: string,
  now: Date,
) {
  if (!paysMensalidade(member)) {
    cancelUnpaidMensalidades(db, member.id);
    return [];
  }
  const trashedIds = trashMensalidadesInAbsence(db, member.id, userId, now);
  if (member.status === 'active') {
    const lastYear = Number(today.slice(0, 4));
    for (let year = Number(fromDate.slice(0, 4)); year <= lastYear; year += 1) {
      if (isMensalidadeYearGenerated(db, year)) syncMensalidades(db, year, userId, today);
    }
    refreshPendingMensalidadeSchedule(db, today, userId);
  }
  return trashedIds;
}

/**
 * Troca a situação do associado (ativo↔inativo) exigindo justificativa e registrando o histórico.
 * A data efetiva diz quando a saída/retorno aconteceu de fato e pode ser retroativa: ao inativar, as
 * mensalidades pendentes a partir do mês seguinte à saída vão para a lixeira; ao reativar, voltam a ser
 * geradas a partir do mês do retorno, sem cobrar o intervalo. Pagas nunca são tocadas.
 * Inativar é bloqueado se houver acordo de atraso em aberto. Nunca apaga o associado nem seu histórico.
 */
export function setMemberStatus(
  db: DatabaseShape,
  memberId: string,
  nextStatus: MemberStatus,
  reason: string,
  userId: string,
  options: StatusChangeOptions = {},
): StatusChangeResult | null {
  const member = db.members.find((item) => item.id === memberId);
  if (!member) return null;
  const justification = reason.trim();
  if (!justification) throw new Error('Informe a justificativa da mudança de situação');
  const fromStatus = member.status;
  if (fromStatus === nextStatus) {
    throw new Error(nextStatus === 'inactive' ? 'O associado já está inativo' : 'O associado já está ativo');
  }
  if (nextStatus === 'inactive' && memberHasOpenDebt(db, memberId)) {
    throw new Error('Não é possível inativar: o associado tem acordo de atraso em aberto. Quite o acordo primeiro.');
  }
  const today = options.today ?? todayISO();
  const now = options.now ?? new Date();
  const effectiveDate = options.effectiveDate ?? today;
  const history = memberHistoryInOrder(db, memberId);
  assertEffectiveDateInRange(member, effectiveDate, today, history[history.length - 1], undefined);
  const kind = nextStatus === 'inactive' ? (options.kind ?? null) : null;
  const confirmedBy = kind === 'informal' ? (options.confirmedBy?.trim() ?? '') : null;
  if (kind === 'informal' && !confirmedBy) {
    throw new Error('Desligamento informal: informe quem confirmou a saída (chefe de seção, responsável…)');
  }

  member.status = nextStatus;
  Object.assign(member, updatedAudit(userId));
  const entries = db.memberStatusHistory ?? (db.memberStatusHistory = []);
  entries.unshift({
    id: id(),
    memberId: member.id,
    at: now.toISOString(),
    byId: userId,
    fromStatus,
    toStatus: nextStatus,
    reason: justification,
    effectiveDate,
    kind,
    confirmedBy,
    corrections: [],
  });
  const trashedIds = reconcileMemberCharges(db, member, effectiveDate, userId, today, now);
  return { member, trashedIds, paidDuringAbsence: paidMensalidadesInAbsence(db, member.id) };
}

/**
 * Corrige a data efetiva de uma saída/retorno já registrada (ex.: desligamento registrado meses depois de o
 * jovem parar de ir). Guarda a correção no próprio registro e realinha as cobranças.
 */
export function correctStatusEffectiveDate(
  db: DatabaseShape,
  memberId: string,
  entryId: string,
  effectiveDate: string,
  reason: string,
  userId: string,
  options: { today?: string; now?: Date } = {},
): StatusChangeResult | null {
  const member = db.members.find((item) => item.id === memberId);
  if (!member) return null;
  const justification = reason.trim();
  if (!justification) throw new Error('Informe a justificativa da correção');
  const history = memberHistoryInOrder(db, memberId);
  const index = history.findIndex((entry) => entry.id === entryId);
  if (index < 0) throw new Error('Registro de situação não encontrado para este associado');
  const entry = history[index];
  const previousDate = statusEffectiveDate(entry);
  if (previousDate === effectiveDate) throw new Error('A data informada é igual à data efetiva atual');
  const today = options.today ?? todayISO();
  const now = options.now ?? new Date();
  assertEffectiveDateInRange(member, effectiveDate, today, history[index - 1], history[index + 1]);
  const movesExitEarlier = entry.toStatus === 'inactive' && effectiveDate < previousDate;
  const movesReturnLater = entry.toStatus === 'active' && effectiveDate > previousDate;
  if ((movesExitEarlier || movesReturnLater) && memberHasOpenDebt(db, memberId)) {
    throw new Error(
      'Não é possível aumentar o período fora do grupo: o associado tem acordo de atraso em aberto. Quite o acordo primeiro.',
    );
  }

  entry.effectiveDate = effectiveDate;
  entry.corrections = [
    ...(entry.corrections ?? []),
    { at: now.toISOString(), byId: userId, from: previousDate, to: effectiveDate, reason: justification },
  ];
  Object.assign(member, updatedAudit(userId));
  const fromDate = previousDate < effectiveDate ? previousDate : effectiveDate;
  const trashedIds = reconcileMemberCharges(db, member, fromDate, userId, today, now);
  return { member, trashedIds, paidDuringAbsence: paidMensalidadesInAbsence(db, member.id) };
}

export function statusHistoryOf(db: DatabaseShape, memberId: string): MemberStatusHistory[] {
  return (db.memberStatusHistory ?? [])
    .filter((entry) => entry.memberId === memberId)
    .sort((a, b) => statusEffectiveDate(b).localeCompare(statusEffectiveDate(a)) || b.at.localeCompare(a.at));
}

export function addMemberAccount(
  db: DatabaseShape,
  memberId: string,
  input: AccountInput,
  userId: string,
): MemberAccount | null {
  const member = db.members.find((item) => item.id === memberId);
  if (!member) return null;
  if (input.isPrimary) {
    for (const account of db.memberAccounts) {
      if (account.memberId === member.id) account.isPrimary = false;
    }
  }
  const account: MemberAccount = {
    id: id(),
    memberId: member.id,
    active: true,
    ...input,
    holderName: upperCaseName(input.holderName),
    ...createdAudit(userId),
  };
  db.memberAccounts.push(account);
  return account;
}

export function updateMemberAccount(
  db: DatabaseShape,
  accountId: string,
  input: Partial<AccountInput> & { active?: boolean },
  userId: string,
): MemberAccount | null {
  const account = db.memberAccounts.find((item) => item.id === accountId);
  if (!account) return null;
  Object.assign(account, input, updatedAudit(userId));
  if (input.holderName !== undefined) account.holderName = upperCaseName(input.holderName);
  if (input.isPrimary) {
    for (const other of db.memberAccounts) {
      if (other.memberId === account.memberId && other.id !== account.id) {
        other.isPrimary = false;
      }
    }
  }
  return account;
}

export function removeMemberAccount(db: DatabaseShape, accountId: string) {
  const before = db.memberAccounts.length;
  db.memberAccounts = db.memberAccounts.filter((item) => item.id !== accountId);
  return db.memberAccounts.length < before;
}

/** Normaliza nomes já gravados (associados, responsáveis e titulares de conta). */
export function normalizeStoredMemberNames(db: DatabaseShape) {
  let members = 0;
  let guardians = 0;
  let accounts = 0;
  for (const member of db.members) {
    const next = upperCaseName(member.name);
    if (next !== member.name) {
      member.name = next;
      members += 1;
    }
  }
  for (const guardian of db.memberGuardians ?? []) {
    const next = upperCaseName(guardian.name);
    if (next !== guardian.name) {
      guardian.name = next;
      guardians += 1;
    }
  }
  for (const account of db.memberAccounts) {
    const next = upperCaseName(account.holderName);
    if (next !== account.holderName) {
      account.holderName = next;
      accounts += 1;
    }
  }
  return { members, guardians, accounts };
}

export function importMembers(db: DatabaseShape, rows: MemberImportRow[], userId: string) {
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: { email: string; reason: string }[] = [];
  for (const row of rows) {
    const incoming = cleanedGuardians(row.guardians ?? []);
    const existing = db.members.find((member) => member.branch === row.branch && fold(member.name) === fold(row.name));
    if (existing) {
      const current = guardiansOf(db, existing.id);
      const merged = mergeGuardianInputs(current, incoming);
      if (merged.length > current.length) {
        replaceGuardians(db, existing.id, merged, userId, 'integration');
        updated.push(existing.id);
        continue;
      }
      skipped.push({ email: row.email || row.name, reason: 'Associado já cadastrado' });
      continue;
    }
    const email = memberContactEmail(row, row.email, incoming);
    if (!email) {
      skipped.push({
        email: row.name,
        reason: ownsContactEmail(row) ? 'Sem e-mail do associado' : 'Sem e-mail de responsável',
      });
      continue;
    }
    const { guardians: _guardians, ...data } = row;
    const member: Member = {
      id: id(),
      status: 'active',
      ...data,
      email,
      name: upperCaseName(data.name),
      chiefChild: false,
      monthlyFee: 0,
      ...createdAudit(userId, 'integration'),
    };
    assignOfficialFee(member, undefined, scheduleOf(db));
    db.members.push(member);
    if (incoming.length) replaceGuardians(db, member.id, incoming, userId, 'integration');
    created.push(member.id);
  }
  return { created: created.length, updated: updated.length, skipped };
}

function mergeGuardianInputs(
  current: {
    id?: string;
    name: string;
    relationship: string;
    phone: string;
    email: string;
  }[],
  incoming: ReturnType<typeof cleanedGuardians>,
) {
  const next = current.map((item) => ({ ...item }));
  for (const item of incoming) {
    const hit = next.find((guardian) => fold(guardian.name) === fold(item.name));
    if (hit) {
      if (!hit.relationship || hit.relationship === 'Outro') hit.relationship = item.relationship;
      if (!hit.phone) hit.phone = item.phone;
      if (!hit.email) hit.email = item.email;
      continue;
    }
    next.push({ ...item });
  }
  return next;
}
