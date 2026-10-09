import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { hashPassword } from '../auth/password';
import { id } from '../id';
import type {
  DatabaseShape,
  Fee,
  FeeComposition,
  FeeSchedulePeriod,
  FinancialProject,
  Member,
  MemberAccount,
  MemberArrears,
  MemberGuardian,
  MovementType,
  Settings,
} from '../types';
import { countUsers } from '../../identity/users';
import { assertClosedMonthsUntouched, diffTransactions, purgeTrash, type HistoryEntry } from '../../ledger/governance';
import { DEFAULT_MENSALIDADE_DUE_DAY, resolveMensalidadeDueDay } from '../types';
import { DEFAULT_FEE_SCHEDULE } from '../../mensalidades/fee-table';
import { asDate, asTimestamp, dateOnly, mapAudit, storedOrigin } from './row-mapping';
import { takeFinanceLock } from './lock';
import {
  toMonthClosing,
  toTransaction,
  toTransactionRow,
  toTrashed,
  toTrashRow,
} from '../../ledger/infra/transaction.mapper';
import { appConfig } from '../config';

let cache: DatabaseShape | null = null;
/**
 * Muda a cada gravação. Uma leitura que começou antes de uma gravação não pode guardar o resultado no cache
 * depois dela: sem isto, uma leitura lenta devolvia ao cache um financeiro já desatualizado.
 */
let cacheVersion = 0;

function setCache(db: DatabaseShape | null) {
  cacheVersion += 1;
  cache = db;
}

const WRITE_TIMEOUT_MS = 120_000;

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadDb(): Promise<DatabaseShape> {
  if (cache) return cache;
  const version = cacheVersion;
  const db = await readFinance(prisma);
  if (version === cacheVersion) cache = db;
  return db;
}

export function invalidateCache(): void {
  setCache(null);
}

export async function persist(db: DatabaseShape): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await takeFinanceLock(tx);
      await writeFinance(tx, db);
    },
    { timeout: WRITE_TIMEOUT_MS },
  );
  setCache(db);
}

async function writeFinance(client: Db, db: DatabaseShape): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE transactions, member_arrears, member_siblings, member_guardians, member_accounts, project_items, projects, members, movement_types, fees, settings, transaction_trash, month_closings, fee_schedule_periods RESTART IDENTITY',
  );

  if (db.movementTypes.length) {
    await client.movementType.createMany({
      data: db.movementTypes.map((type) => ({
        id: type.id,
        name: type.name,
        direction: type.direction,
        audience: type.audience ?? 'general',
        description: type.description,
        pixKey: type.pixKey ?? '',
        branch: type.branch ?? 'grupo',
        active: type.active,
        origin: storedOrigin(type.origin),
        createdAt: new Date(type.createdAt),
        createdById: type.createdBy ?? null,
        updatedAt: asTimestamp(type.updatedAt),
        updatedById: type.updatedBy ?? null,
      })),
    });
  }

  if (db.fees?.length) {
    await client.fee.createMany({
      data: db.fees.map((fee) => ({
        id: fee.id,
        name: fee.name,
        amount: fee.amount,
        origin: storedOrigin(fee.origin),
        createdAt: new Date(fee.createdAt),
        createdById: fee.createdBy ?? null,
        updatedAt: asTimestamp(fee.updatedAt),
        updatedById: fee.updatedBy ?? null,
      })),
    });
  }

  if (db.members.length) {
    await client.member.createMany({
      data: db.members.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        branch: member.branch,
        role: member.role,
        monthlyFee: member.monthlyFee,
        feeOverride: member.feeOverride ?? null,
        chiefChild: Boolean(member.chiefChild),
        status: member.status,
        joinedAt: asDate(member.joinedAt),
        clubeLtc: member.clubeLtc,
        origin: storedOrigin(member.origin),
        createdAt: new Date(member.createdAt),
        createdById: member.createdBy ?? null,
        updatedAt: asTimestamp(member.updatedAt),
        updatedById: member.updatedBy ?? null,
      })),
    });
  }

  if (db.memberSiblings?.length) {
    await client.memberSibling.createMany({
      data: db.memberSiblings.map((link) => ({
        id: link.id,
        memberId: link.memberId,
        siblingId: link.siblingId,
        createdAt: new Date(link.createdAt),
        createdById: link.createdBy ?? null,
      })),
    });
  }

  if (db.memberGuardians?.length) {
    await client.memberGuardian.createMany({
      data: db.memberGuardians.map((guardian) => ({
        id: guardian.id,
        memberId: guardian.memberId,
        name: guardian.name,
        relationship: guardian.relationship,
        phone: guardian.phone,
        email: guardian.email,
        origin: storedOrigin(guardian.origin),
        createdAt: new Date(guardian.createdAt),
        createdById: guardian.createdBy ?? null,
        updatedAt: asTimestamp(guardian.updatedAt),
        updatedById: guardian.updatedBy ?? null,
      })),
    });
  }

  if (db.memberAccounts.length) {
    await client.memberAccount.createMany({
      data: db.memberAccounts.map((account) => ({
        id: account.id,
        memberId: account.memberId,
        holderName: account.holderName,
        holderKind: account.holderKind,
        relationship: account.relationship,
        pixKey: account.pixKey,
        bank: account.bank,
        agency: account.agency,
        accountNumber: account.accountNumber,
        document: account.document,
        notes: account.notes ?? null,
        isPrimary: account.isPrimary,
        active: account.active,
        origin: storedOrigin(account.origin),
        createdAt: new Date(account.createdAt),
        createdById: account.createdBy ?? null,
        updatedAt: asTimestamp(account.updatedAt),
        updatedById: account.updatedBy ?? null,
      })),
    });
  }

  if (db.memberArrears?.length) {
    await client.memberArrears.createMany({
      data: db.memberArrears.map((plan) => ({
        id: plan.id,
        memberId: plan.memberId,
        originalAmount: plan.originalAmount,
        balance: plan.balance,
        installmentAmount: plan.installmentAmount,
        totalCount: plan.totalCount,
        remainingCount: plan.remainingCount,
        startYearMonth: plan.startYearMonth,
        chargeMode: plan.chargeMode,
        note: plan.note ?? '',
        status: plan.status,
        origin: storedOrigin(plan.origin),
        createdAt: new Date(plan.createdAt),
        createdById: plan.createdBy ?? null,
        updatedAt: asTimestamp(plan.updatedAt),
        updatedById: plan.updatedBy ?? null,
      })),
    });
  }

  if (db.projects.length) {
    await client.project.createMany({
      data: db.projects.map((project) => ({
        id: project.id,
        branch: project.branch,
        year: project.year,
        name: project.name,
        description: project.description,
        origin: storedOrigin(project.origin),
        createdAt: new Date(project.createdAt),
        createdById: project.createdBy ?? null,
        updatedAt: asTimestamp(project.updatedAt),
        updatedById: project.updatedBy ?? null,
      })),
    });
    const items = db.projects.flatMap((project) =>
      project.items.map((item) => ({
        id: item.id,
        projectId: project.id,
        category: item.category,
        description: item.description,
        planned: item.planned,
        movementTypeId: item.movementTypeId ?? null,
      })),
    );
    if (items.length) await client.projectItem.createMany({ data: items });
  }

  if (db.transactions.length) {
    await client.transaction.createMany({
      data: db.transactions.map(toTransactionRow),
    });
  }

  if (db.trash?.length) {
    await client.transactionTrash.createMany({
      data: db.trash.map(toTrashRow),
    });
  }

  if (db.monthClosings?.length) {
    await client.monthClosing.createMany({
      data: db.monthClosings.map((item) => ({
        yearMonth: item.yearMonth,
        closedAt: new Date(item.closedAt),
        closedById: item.closedBy ?? null,
        income: item.income,
        expense: item.expense,
        balance: item.balance,
      })),
    });
  }

  if (db.feeSchedule?.length) {
    await client.feeSchedulePeriod.createMany({
      data: db.feeSchedule.map((period) => ({
        id: period.id,
        startMonth: period.startMonth,
        endMonth: period.endMonth ?? null,
        note: period.note ?? '',
        regular: period.regular as unknown as Prisma.InputJsonValue,
        pioneer: period.pioneer as unknown as Prisma.InputJsonValue,
        familyNonMember: (period.familyNonMember as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        familyMember: (period.familyMember as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        origin: storedOrigin(period.origin),
        createdAt: new Date(period.createdAt),
        createdById: period.createdBy ?? null,
        updatedAt: asTimestamp(period.updatedAt),
        updatedById: period.updatedBy ?? null,
      })),
    });
  }

  await client.settings.create({
    data: {
      openingBalance: db.settings.openingBalance,
      groupName: db.settings.groupName,
      mensalidadeDueDay: db.settings.mensalidadeDueDay ?? DEFAULT_MENSALIDADE_DUE_DAY,
    },
  });
}

/**
 * Lê o financeiro, aplica `fn` e regrava tudo numa transação.
 * Antes de gravar: protege meses fechados e tira da lixeira o que passou de 30 dias.
 * Depois: registra o histórico de cada lançamento alterado.
 */
export async function mutate<T>(fn: (db: DatabaseShape) => T, options: { restoredIds?: Set<string> } = {}): Promise<T> {
  const result = await prisma.$transaction(
    async (tx) => {
      await takeFinanceLock(tx);
      const db = await readFinance(tx);
      const before = new Map(db.transactions.map((item) => [item.id, structuredClone(item)]));
      const value = fn(db);
      assertClosedMonthsUntouched(before, db);
      purgeTrash(db);
      await writeFinance(tx, db);
      await recordHistory(tx, diffTransactions(before, db, options.restoredIds));
      return { db, value };
    },
    { timeout: WRITE_TIMEOUT_MS },
  );
  setCache(result.db);
  return result.value;
}

export async function recordHistory(client: Db, entries: HistoryEntry[]) {
  if (!entries.length) return;
  await client.transactionHistory.createMany({
    data: entries.map((entry) => ({
      transactionId: entry.transactionId,
      kind: entry.kind,
      byId: entry.byId,
      changes: entry.changes as unknown as Prisma.InputJsonValue,
    })),
  });
}

export async function readTransactionHistory(transactionId: string) {
  const rows = await prisma.transactionHistory.findMany({ where: { transactionId }, orderBy: { at: 'desc' } });
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    byId: row.byId,
    kind: row.kind,
    changes: row.changes as unknown as HistoryEntry['changes'],
  }));
}

export async function readDismissals(prefix: string): Promise<Set<string>> {
  const rows = await prisma.reviewDismissal.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } });
  return new Set(rows.map((row) => row.key));
}

export async function dismissReview(key: string, userId: string) {
  await prisma.reviewDismissal.upsert({ where: { key }, create: { key, byId: userId }, update: {} });
}

export async function resetDb(): Promise<DatabaseShape> {
  await persist(emptyFinance());
  await prisma.$executeRawUnsafe('TRUNCATE bank_movements, bank_sync_state, message_outbox');
  return emptyFinance();
}

export async function seedIfEmpty(): Promise<void> {
  setCache(null);
  if ((await countUsers()) === 0) {
    const password = appConfig.admin.password || randomBytes(12).toString('base64url');
    const hash = await hashPassword(password);
    await prisma.user.create({
      data: {
        id: id(),
        username: 'admin',
        name: 'Administração do Grupo',
        email: 'admin@arnofriedrich.org.br',
        passwordHash: hash,
        role: 'admin',
        origin: 'manual',
      },
    });
    await prisma.user.create({
      data: {
        id: id(),
        username: appConfig.admin.user,
        name: 'Tesouraria do Grupo',
        email: 'tesouraria@arnofriedrich.org.br',
        passwordHash: hash,
        role: 'tesoureiro',
        origin: 'manual',
      },
    });
    if (appConfig.admin.password) {
      console.log('Usuários iniciais criados: admin e tesouraria (senha de ADMIN_PASSWORD)');
    } else {
      console.log(
        `Usuários iniciais criados: admin e tesouraria\n` +
          `Senha gerada agora: ${password}\n` +
          `Anote-a e troque no primeiro acesso, ou defina ADMIN_PASSWORD no .env antes do primeiro start.`,
      );
    }
  }

  const settings = await prisma.settings.findFirst({ select: { id: true } });
  if (!settings) {
    await prisma.settings.create({
      data: {
        openingBalance: 0,
        groupName: 'Grupo Escoteiro Arno Friedrich',
        mensalidadeDueDay: DEFAULT_MENSALIDADE_DUE_DAY,
      },
    });
  }

  setCache(await readFinance(prisma));
}

export function emptyFinance(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    memberArrears: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    trash: [],
    monthClosings: [],
    feeSchedule: [],
    settings: {
      openingBalance: 0,
      groupName: 'Grupo Escoteiro Arno Friedrich',
      mensalidadeDueDay: DEFAULT_MENSALIDADE_DUE_DAY,
    },
  };
}

async function readFinance(sql: Db): Promise<DatabaseShape> {
  const [
    members,
    guardians,
    siblings,
    accounts,
    arrears,
    types,
    fees,
    projects,
    items,
    transactions,
    settings,
    trash,
    closings,
    feePeriods,
  ] = await Promise.all([
    sql.member.findMany({ orderBy: { name: 'asc' } }),
    sql.memberGuardian.findMany({ orderBy: { name: 'asc' } }),
    sql.memberSibling.findMany(),
    sql.memberAccount.findMany({ orderBy: { holderName: 'asc' } }),
    sql.memberArrears.findMany({ orderBy: { createdAt: 'desc' } }),
    sql.movementType.findMany({ orderBy: { name: 'asc' } }),
    sql.fee.findMany({ orderBy: { name: 'asc' } }),
    sql.project.findMany({ orderBy: [{ year: 'asc' }, { branch: 'asc' }] }),
    sql.projectItem.findMany(),
    sql.transaction.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    sql.settings.findFirst(),
    sql.transactionTrash.findMany({ orderBy: { deletedAt: 'desc' } }),
    sql.monthClosing.findMany({ orderBy: { yearMonth: 'asc' } }),
    sql.feeSchedulePeriod.findMany({ orderBy: { startMonth: 'asc' } }),
  ]);

  const itemsByProject = new Map<string, FinancialProject['items']>();
  for (const row of items) {
    const list = itemsByProject.get(row.projectId) ?? [];
    list.push({
      id: row.id,
      category: row.category,
      description: row.description,
      planned: Number(row.planned),
      movementTypeId: row.movementTypeId ?? undefined,
    });
    itemsByProject.set(row.projectId, list);
  }

  const defaultSettings: Settings = {
    openingBalance: 0,
    groupName: 'Grupo Escoteiro Arno Friedrich',
    mensalidadeDueDay: DEFAULT_MENSALIDADE_DUE_DAY,
  };

  return {
    members: members.map(mapMember),
    memberGuardians: guardians.map(mapGuardian),
    memberSiblings: siblings.map(mapSibling),
    memberAccounts: accounts.map(mapAccount),
    memberArrears: arrears.map(mapArrears),
    movementTypes: types.map(mapMovementType),
    fees: fees.map(mapFee),
    projects: projects.map((row) => ({
      id: row.id,
      branch: row.branch as FinancialProject['branch'],
      year: row.year,
      name: row.name,
      description: row.description,
      items: itemsByProject.get(row.id) ?? [],
      ...mapAudit(row),
    })),
    transactions: transactions.map(toTransaction),
    trash: trash.map(toTrashed),
    monthClosings: closings.map(toMonthClosing),
    // Sem períodos gravados: a tabela padrão passa a ser gravada na próxima alteração.
    feeSchedule: feePeriods.length ? feePeriods.map(mapFeePeriod) : structuredClone(DEFAULT_FEE_SCHEDULE),
    settings: settings
      ? {
          openingBalance: Number(settings.openingBalance),
          groupName: settings.groupName,
          mensalidadeDueDay: resolveMensalidadeDueDay(settings.mensalidadeDueDay),
        }
      : defaultSettings,
  };
}

export function mapMember(row: {
  id: string;
  name: string;
  email: string;
  phone: string;
  branch: string;
  role: string;
  monthlyFee: Prisma.Decimal;
  feeOverride: Prisma.Decimal | null;
  chiefChild: boolean;
  status: string;
  joinedAt: Date;
  clubeLtc: boolean;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    branch: row.branch as Member['branch'],
    role: row.role as Member['role'],
    monthlyFee: Number(row.monthlyFee),
    feeOverride: row.feeOverride == null ? null : Number(row.feeOverride),
    chiefChild: row.chiefChild,
    status: row.status as Member['status'],
    joinedAt: dateOnly(row.joinedAt),
    clubeLtc: row.clubeLtc,
    ...mapAudit(row),
  };
}

function mapSibling(row: {
  id: string;
  memberId: string;
  siblingId: string;
  createdAt: Date;
  createdById: string | null;
}) {
  return {
    id: row.id,
    memberId: row.memberId,
    siblingId: row.siblingId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdById ?? undefined,
  };
}

export function mapGuardian(row: {
  id: string;
  memberId: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): MemberGuardian {
  return {
    id: row.id,
    memberId: row.memberId,
    name: row.name,
    relationship: row.relationship ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    ...mapAudit(row),
  };
}

export function mapAccount(row: {
  id: string;
  memberId: string;
  holderName: string;
  holderKind: string;
  relationship: string;
  pixKey: string;
  bank: string;
  agency: string;
  accountNumber: string;
  document: string;
  notes: string | null;
  isPrimary: boolean;
  active: boolean;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): MemberAccount {
  return {
    id: row.id,
    memberId: row.memberId,
    holderName: row.holderName,
    holderKind: row.holderKind as MemberAccount['holderKind'],
    relationship: row.relationship ?? '',
    pixKey: row.pixKey ?? '',
    bank: row.bank ?? '',
    agency: row.agency ?? '',
    accountNumber: row.accountNumber ?? '',
    document: row.document ?? '',
    notes: row.notes ?? undefined,
    isPrimary: row.isPrimary,
    active: row.active,
    ...mapAudit(row),
  };
}

export function mapMovementType(row: {
  id: string;
  name: string;
  direction: string;
  audience: string;
  description: string;
  pixKey: string;
  branch: string;
  active: boolean;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): MovementType {
  return {
    id: row.id,
    name: row.name,
    direction: row.direction as MovementType['direction'],
    audience: (row.audience as MovementType['audience']) || 'general',
    description: row.description ?? '',
    pixKey: row.pixKey ?? '',
    branch: (row.branch as MovementType['branch']) || 'grupo',
    active: row.active,
    ...mapAudit(row),
  };
}

function mapFee(row: {
  id: string;
  name: string;
  amount: Prisma.Decimal;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): Fee {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    ...mapAudit(row),
  };
}

function mapComposition(value: Prisma.JsonValue): FeeComposition {
  const raw = (value ?? {}) as Record<string, unknown>;
  const num = (key: string) => {
    const n = Number(raw[key]);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    group: num('group'),
    branch: num('branch'),
    snack: num('snack'),
    clubOnTime: num('clubOnTime'),
    clubLate: num('clubLate'),
    dilution: num('dilution'),
    lateFee: num('lateFee'),
    pendingSplit: raw.pendingSplit === true,
  };
}

function mapFeePeriod(row: {
  id: string;
  startMonth: string;
  endMonth: string | null;
  note: string;
  regular: Prisma.JsonValue;
  pioneer: Prisma.JsonValue;
  familyNonMember: Prisma.JsonValue | null;
  familyMember: Prisma.JsonValue | null;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): FeeSchedulePeriod {
  return {
    id: row.id,
    startMonth: row.startMonth,
    endMonth: row.endMonth,
    note: row.note ?? '',
    regular: mapComposition(row.regular),
    pioneer: mapComposition(row.pioneer),
    familyNonMember: row.familyNonMember == null ? null : mapComposition(row.familyNonMember),
    familyMember: row.familyMember == null ? null : mapComposition(row.familyMember),
    ...mapAudit(row),
  };
}

function mapArrears(row: {
  id: string;
  memberId: string;
  originalAmount: Prisma.Decimal;
  balance: Prisma.Decimal;
  installmentAmount: Prisma.Decimal;
  totalCount: number;
  remainingCount: number;
  startYearMonth: string;
  chargeMode: string;
  note: string;
  status: string;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): MemberArrears {
  return {
    id: row.id,
    memberId: row.memberId,
    originalAmount: Number(row.originalAmount),
    balance: Number(row.balance),
    installmentAmount: Number(row.installmentAmount),
    totalCount: row.totalCount,
    remainingCount: row.remainingCount,
    startYearMonth: row.startYearMonth,
    chargeMode: row.chargeMode === 'separate' ? 'separate' : 'embed',
    note: row.note ?? '',
    status: row.status === 'settled' ? 'settled' : row.status === 'cancelled' ? 'cancelled' : 'active',
    ...mapAudit(row),
  };
}
