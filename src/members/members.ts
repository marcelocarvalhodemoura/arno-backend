import { fold } from '../shared/csv';
import { createdAudit, updatedAudit } from '../shared/audit';
import { id } from '../shared/id';
import type {
  DatabaseShape,
  Member,
  MemberAccount,
  MemberGuardian,
  MemberSibling,
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
import { paysMensalidade, resolveFeeOverride, SPECIAL_FAMILY_FEE } from '../mensalidades/fee-table';
import {
  assignOfficialFee,
  cancelSubsequentMensalidades,
  cancelUnpaidMensalidades,
  refreshPendingMensalidadeSchedule,
} from '../mensalidades/mensalidades';

function normalizeFeeOverride(value: number | null | undefined): number | null {
  return resolveFeeOverride({ feeOverride: value == null ? null : value });
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
    member.feeOverride = SPECIAL_FAMILY_FEE;
    assignOfficialFee(member);
    return;
  }
  if (siblingIdsOf(db, memberId).length > 0) {
    member.feeOverride = SPECIAL_FAMILY_FEE;
    assignOfficialFee(member);
    return;
  }
  if (member.feeOverride === SPECIAL_FAMILY_FEE) {
    member.feeOverride = null;
  }
  assignOfficialFee(member);
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
 * Aplica filho de chefe XOR irmãos e sincroniza feeOverride = R$ 82.
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
      member.feeOverride = input.feeOverride === null ? null : normalizeFeeOverride(input.feeOverride);
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
    member.feeOverride = SPECIAL_FAMILY_FEE;
  } else if (siblingIdsOf(db, member.id).length > 0) {
    member.feeOverride = SPECIAL_FAMILY_FEE;
  } else {
    member.feeOverride = null;
  }
}

export function cleanedGuardians(list: GuardianInput[]) {
  return list
    .map((item) => ({
      id: item.id,
      name: item.name.trim(),
      relationship: item.relationship.trim(),
      phone: (item.phone ?? '').trim(),
      email: optionalContactEmail(item.email),
    }))
    .filter((item) => item.name.length >= 2);
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

export function refreshOfficialFees(db: DatabaseShape) {
  for (const member of db.members) {
    assignOfficialFee(member);
    if (!paysMensalidade(member)) cancelUnpaidMensalidades(db, member.id);
  }
  return db;
}

export function createMember(db: DatabaseShape, input: CreateMemberInput, userId: string): Member {
  if (db.members.some((item) => item.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error('E-mail já cadastrado');
  }
  const {
    guardians,
    feeOverride: feeOverrideInput,
    chiefChild: chiefChildInput,
    siblingIds: siblingIdsInput,
    ...data
  } = input;
  const list = cleanedGuardians(guardians ?? []);
  assertYouthGuardians(data.role, list.length);
  const created: Member = {
    id: id(),
    status: 'active',
    ...data,
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
    created.feeOverride = normalizeFeeOverride(feeOverrideInput);
  }
  assignOfficialFee(created);
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
  if (
    input.email &&
    db.members.some((item) => item.id !== member.id && item.email.toLowerCase() === input.email!.toLowerCase())
  ) {
    throw new Error('E-mail já cadastrado');
  }
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
  const becameInactive = input.status === 'inactive' && member.status !== 'inactive';
  Object.assign(member, data);
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
  assignOfficialFee(member, userId);
  if (!paysMensalidade(member)) {
    cancelUnpaidMensalidades(db, member.id);
  } else if (becameInactive) {
    cancelSubsequentMensalidades(db, member.id);
  } else {
    refreshPendingMensalidadeSchedule(db, undefined, userId);
  }
  return member;
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

export function importMembers(db: DatabaseShape, rows: MemberImportRow[], userId: string) {
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: { email: string; reason: string }[] = [];
  for (const row of rows) {
    const incoming = cleanedGuardians(row.guardians ?? []);
    const existing = db.members.find((member) => member.email.toLowerCase() === row.email.toLowerCase());
    if (existing) {
      const current = (db.memberGuardians ?? []).filter((item) => item.memberId === existing.id);
      const merged = mergeGuardianInputs(current, incoming);
      if (merged.length > current.length) {
        replaceGuardians(db, existing.id, merged, userId, 'integration');
        updated.push(existing.id);
        continue;
      }
      skipped.push({ email: row.email, reason: 'E-mail já cadastrado' });
      continue;
    }
    const { guardians: _guardians, ...data } = row;
    const member: Member = {
      id: id(),
      status: 'active',
      ...data,
      chiefChild: false,
      monthlyFee: 0,
      ...createdAudit(userId, 'integration'),
    };
    assignOfficialFee(member);
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
