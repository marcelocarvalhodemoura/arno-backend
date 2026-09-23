import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { hashPassword } from '../auth/password';
import { id } from '../id';
import type {
  DatabaseShape,
  Fee,
  FinancialProject,
  Member,
  MemberAccount,
  MemberGuardian,
  MovementType,
  RecordOrigin,
  Settings,
  Transaction,
} from '../types';
import { countUsers } from '../../identity/users';
import { DEFAULT_MENSALIDADE_DUE_DAY, resolveMensalidadeDueDay } from '../types';

let cache: DatabaseShape | null = null;

const FINANCE_LOCK = 87123001;
const WRITE_TIMEOUT_MS = 120_000;

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadDb(): Promise<DatabaseShape> {
  if (cache) return cache;
  cache = await readFinance(prisma);
  return cache;
}

export function invalidateCache(): void {
  cache = null;
}

export async function persist(db: DatabaseShape): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${FINANCE_LOCK} AS bigint))`;
      await writeFinance(tx, db);
    },
    { timeout: WRITE_TIMEOUT_MS },
  );
  cache = db;
}

function storedOrigin(origin: string | undefined, allowSicredi = false): string {
  if (origin === 'manual') return 'manual';
  if (allowSicredi && origin === 'sicredi') return 'sicredi';
  return 'integration';
}

function asDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function asTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}

async function writeFinance(client: Db, db: DatabaseShape): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE transactions, member_siblings, member_guardians, member_accounts, project_items, projects, members, movement_types, fees, settings RESTART IDENTITY CASCADE',
  );

  if (db.movementTypes.length) {
    await client.movementType.createMany({
      data: db.movementTypes.map((type) => ({
        id: type.id,
        name: type.name,
        direction: type.direction,
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
      data: db.transactions.map((tx) => ({
        id: tx.id,
        date: asDate(tx.date),
        type: tx.type,
        nature: tx.nature,
        movementTypeId: tx.movementTypeId,
        description: tx.description,
        amount: tx.amount,
        branch: tx.branch,
        method: tx.method,
        paymentStatus: tx.paymentStatus === 'pending' ? 'pending' : 'paid',
        paidAt: tx.paidAt ? asDate(tx.paidAt) : null,
        memberId: tx.memberId ?? null,
        memberAccountId: tx.memberAccountId ?? null,
        memberGuardianId: tx.memberGuardianId ?? null,
        projectId: tx.projectId ?? null,
        notes: tx.notes ?? null,
        externalId: tx.externalId ?? null,
        clubFeeIncluded: tx.clubFeeIncluded ?? null,
        createdById: tx.createdBy ?? null,
        createdAt: tx.createdAt ? new Date(tx.createdAt) : new Date(),
        updatedAt: asTimestamp(tx.updatedAt),
        updatedById: tx.updatedBy ?? null,
        origin: storedOrigin(tx.origin, true),
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

export async function mutate<T>(fn: (db: DatabaseShape) => T): Promise<T> {
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${FINANCE_LOCK} AS bigint))`;
      const db = await readFinance(tx);
      const value = fn(db);
      await writeFinance(tx, db);
      return { db, value };
    },
    { timeout: WRITE_TIMEOUT_MS },
  );
  cache = result.db;
  return result.value;
}

export async function resetDb(): Promise<DatabaseShape> {
  await persist(emptyFinance());
  await prisma.$executeRawUnsafe('TRUNCATE bank_movements, bank_sync_state, message_outbox');
  return emptyFinance();
}

export async function seedIfEmpty(): Promise<void> {
  cache = null;
  if ((await countUsers()) === 0) {
    const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
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
        username: process.env.ADMIN_USER ?? 'tesouraria',
        name: 'Tesouraria do Grupo',
        email: 'tesouraria@arnofriedrich.org.br',
        passwordHash: hash,
        role: 'tesoureiro',
        origin: 'manual',
      },
    });
    if (process.env.ADMIN_PASSWORD) {
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

  cache = await readFinance(prisma);
}

function emptyFinance(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
    memberSiblings: [],
    memberAccounts: [],
    movementTypes: [],
    fees: [],
    projects: [],
    transactions: [],
    settings: {
      openingBalance: 0,
      groupName: 'Grupo Escoteiro Arno Friedrich',
      mensalidadeDueDay: DEFAULT_MENSALIDADE_DUE_DAY,
    },
  };
}

async function readFinance(sql: Db): Promise<DatabaseShape> {
  const [members, guardians, siblings, accounts, types, fees, projects, items, transactions, settings] =
    await Promise.all([
      sql.member.findMany({ orderBy: { name: 'asc' } }),
      sql.memberGuardian.findMany({ orderBy: { name: 'asc' } }),
      sql.memberSibling.findMany(),
      sql.memberAccount.findMany({ orderBy: { holderName: 'asc' } }),
      sql.movementType.findMany({ orderBy: { name: 'asc' } }),
      sql.fee.findMany({ orderBy: { name: 'asc' } }),
      sql.project.findMany({ orderBy: [{ year: 'asc' }, { branch: 'asc' }] }),
      sql.projectItem.findMany(),
      sql.transaction.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
      sql.settings.findFirst(),
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
    transactions: transactions.map(mapTransaction),
    settings: settings
      ? {
          openingBalance: Number(settings.openingBalance),
          groupName: settings.groupName,
          mensalidadeDueDay: resolveMensalidadeDueDay(settings.mensalidadeDueDay),
        }
      : defaultSettings,
  };
}

function mapAudit(row: {
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}) {
  return {
    origin: (row.origin === 'manual' ? 'manual' : row.origin === 'sicredi' ? 'sicredi' : 'integration') as RecordOrigin,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdById ?? undefined,
    updatedAt: row.updatedAt?.toISOString(),
    updatedBy: row.updatedById ?? undefined,
  };
}

function mapMember(row: {
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

function mapGuardian(row: {
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

function mapAccount(row: {
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

function mapMovementType(row: {
  id: string;
  name: string;
  direction: string;
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

function mapTransaction(row: {
  id: string;
  date: Date;
  type: string;
  nature: string;
  movementTypeId: string;
  description: string;
  amount: Prisma.Decimal;
  branch: string;
  method: string;
  paymentStatus: string;
  paidAt: Date | null;
  memberId: string | null;
  memberAccountId: string | null;
  memberGuardianId: string | null;
  projectId: string | null;
  notes: string | null;
  externalId: string | null;
  clubFeeIncluded: boolean | null;
  origin: string;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
}): Transaction {
  return {
    id: row.id,
    date: dateOnly(row.date),
    type: row.type as Transaction['type'],
    nature: row.nature as Transaction['nature'],
    movementTypeId: row.movementTypeId,
    description: row.description,
    amount: Number(row.amount),
    branch: row.branch as Transaction['branch'],
    method: row.method as Transaction['method'],
    paymentStatus: row.paymentStatus === 'pending' ? 'pending' : 'paid',
    paidAt: row.paidAt ? dateOnly(row.paidAt) : undefined,
    memberId: row.memberId ?? undefined,
    memberAccountId: row.memberAccountId ?? undefined,
    memberGuardianId: row.memberGuardianId ?? undefined,
    projectId: row.projectId ?? undefined,
    notes: row.notes ?? undefined,
    externalId: row.externalId ?? undefined,
    clubFeeIncluded: row.clubFeeIncluded ?? undefined,
    ...mapAudit(row),
  };
}
