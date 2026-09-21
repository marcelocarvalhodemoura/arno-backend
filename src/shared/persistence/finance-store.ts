import { randomBytes } from 'node:crypto';
import { pool } from '../db';
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

export async function loadDb(): Promise<DatabaseShape> {
  if (cache) return cache;
  cache = await readFinance(pool);
  return cache;
}

export function invalidateCache(): void {
  cache = null;
}

export async function persist(db: DatabaseShape): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [FINANCE_LOCK]);
    await writeFinance(client, db);
    await client.query('COMMIT');
    cache = db;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function writeFinance(client: typeof pool | import('pg').PoolClient, db: DatabaseShape): Promise<void> {
  await client.query(
    'TRUNCATE transactions, member_guardians, member_accounts, project_items, projects, members, movement_types, fees, settings RESTART IDENTITY CASCADE',
  );

  for (const type of db.movementTypes) {
    await client.query(
      `INSERT INTO movement_types (id, name, direction, description, pix_key, branch, active, origin, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        type.id,
        type.name,
        type.direction,
        type.description,
        type.pixKey ?? '',
        type.branch ?? 'grupo',
        type.active,
        type.origin === 'manual' ? 'manual' : 'integration',
        type.createdAt,
        type.createdBy ?? null,
        type.updatedAt ?? null,
        type.updatedBy ?? null,
      ],
    );
  }

  for (const fee of db.fees ?? []) {
    await client.query(
      `INSERT INTO fees (id, name, amount, origin, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        fee.id,
        fee.name,
        fee.amount,
        fee.origin === 'manual' ? 'manual' : 'integration',
        fee.createdAt,
        fee.createdBy ?? null,
        fee.updatedAt ?? null,
        fee.updatedBy ?? null,
      ],
    );
  }

  for (const member of db.members) {
    await client.query(
      `INSERT INTO members (id, name, email, phone, branch, role, monthly_fee, status, joined_at, clube_ltc, origin, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        member.id,
        member.name,
        member.email,
        member.phone,
        member.branch,
        member.role,
        member.monthlyFee,
        member.status,
        member.joinedAt,
        member.clubeLtc,
        member.origin === 'manual' ? 'manual' : 'integration',
        member.createdAt,
        member.createdBy ?? null,
        member.updatedAt ?? null,
        member.updatedBy ?? null,
      ],
    );
  }

  for (const guardian of db.memberGuardians ?? []) {
    await client.query(
      `INSERT INTO member_guardians (
           id, member_id, name, relationship, phone, email, origin, created_at, created_by, updated_at, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        guardian.id,
        guardian.memberId,
        guardian.name,
        guardian.relationship,
        guardian.phone,
        guardian.email,
        guardian.origin === 'manual' ? 'manual' : 'integration',
        guardian.createdAt,
        guardian.createdBy ?? null,
        guardian.updatedAt ?? null,
        guardian.updatedBy ?? null,
      ],
    );
  }

  for (const account of db.memberAccounts) {
    await client.query(
      `INSERT INTO member_accounts (
           id, member_id, holder_name, holder_kind, relationship, pix_key, bank, agency,
           account_number, document, notes, is_primary, active, origin, created_at, created_by, updated_at, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        account.id,
        account.memberId,
        account.holderName,
        account.holderKind,
        account.relationship,
        account.pixKey,
        account.bank,
        account.agency,
        account.accountNumber,
        account.document,
        account.notes ?? null,
        account.isPrimary,
        account.active,
        account.origin === 'manual' ? 'manual' : 'integration',
        account.createdAt,
        account.createdBy ?? null,
        account.updatedAt ?? null,
        account.updatedBy ?? null,
      ],
    );
  }

  for (const project of db.projects) {
    await client.query(
      `INSERT INTO projects (id, branch, year, name, description, origin, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        project.id,
        project.branch,
        project.year,
        project.name,
        project.description,
        project.origin === 'manual' ? 'manual' : 'integration',
        project.createdAt,
        project.createdBy ?? null,
        project.updatedAt ?? null,
        project.updatedBy ?? null,
      ],
    );
    for (const item of project.items) {
      await client.query(
        `INSERT INTO project_items (id, project_id, category, description, planned, movement_type_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.id, project.id, item.category, item.description, item.planned, item.movementTypeId ?? null],
      );
    }
  }

  for (const tx of db.transactions) {
    await client.query(
      `INSERT INTO transactions (
           id, date, type, nature, movement_type_id, description, amount, branch, method, payment_status, paid_at,
           member_id, member_account_id, member_guardian_id, project_id, notes, external_id, created_by, created_at, updated_at, updated_by, origin
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        tx.id,
        tx.date,
        tx.type,
        tx.nature,
        tx.movementTypeId,
        tx.description,
        tx.amount,
        tx.branch,
        tx.method,
        tx.paymentStatus === 'pending' ? 'pending' : 'paid',
        tx.paidAt ?? null,
        tx.memberId ?? null,
        tx.memberAccountId ?? null,
        tx.memberGuardianId ?? null,
        tx.projectId ?? null,
        tx.notes ?? null,
        tx.externalId ?? null,
        tx.createdBy ?? null,
        tx.createdAt ?? new Date().toISOString(),
        tx.updatedAt ?? null,
        tx.updatedBy ?? null,
        tx.origin === 'manual' ? 'manual' : tx.origin === 'sicredi' ? 'sicredi' : 'integration',
      ],
    );
  }

  await client.query(
    `INSERT INTO settings (opening_balance, group_name, mensalidade_due_day)
       VALUES ($1, $2, $3)`,
    [db.settings.openingBalance, db.settings.groupName, db.settings.mensalidadeDueDay],
  );
}

export async function mutate<T>(fn: (db: DatabaseShape) => T): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [FINANCE_LOCK]);
    const db = await readFinance(client);
    const result = fn(db);
    await writeFinance(client, db);
    await client.query('COMMIT');
    cache = db;
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resetDb(): Promise<DatabaseShape> {
  await persist(emptyFinance());
  await pool.query('TRUNCATE bank_movements, bank_sync_state, message_outbox');
  return emptyFinance();
}

export async function seedIfEmpty(): Promise<void> {
  cache = null;
  if ((await countUsers()) === 0) {
    const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
    const hash = await hashPassword(password);
    await pool.query(
      `INSERT INTO users (id, username, name, email, password_hash, role, origin)
       VALUES ($1, $2, $3, $4, $5, 'admin', 'manual')`,
      [id(), 'admin', 'Administração do Grupo', 'admin@arnofriedrich.org.br', hash],
    );
    await pool.query(
      `INSERT INTO users (id, username, name, email, password_hash, role, origin)
       VALUES ($1, $2, $3, $4, $5, 'tesoureiro', 'manual')`,
      [id(), process.env.ADMIN_USER ?? 'tesouraria', 'Tesouraria do Grupo', 'tesouraria@arnofriedrich.org.br', hash],
    );
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

  const settings = await pool.query('SELECT id FROM settings LIMIT 1');
  if ((settings.rowCount ?? 0) === 0) {
    await pool.query(`INSERT INTO settings (opening_balance, group_name, mensalidade_due_day) VALUES ($1, $2, $3)`, [
      0,
      'Grupo Escoteiro Arno Friedrich',
      DEFAULT_MENSALIDADE_DUE_DAY,
    ]);
  }

  cache = await readFinance(pool);
}

function emptyFinance(): DatabaseShape {
  return {
    members: [],
    memberGuardians: [],
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

async function readFinance(sql: { query: typeof pool.query }): Promise<DatabaseShape> {
  const members = await sql.query('SELECT * FROM members ORDER BY name');
  const guardians = await sql.query('SELECT * FROM member_guardians ORDER BY name');
  const accounts = await sql.query('SELECT * FROM member_accounts ORDER BY holder_name');
  const types = await sql.query('SELECT * FROM movement_types ORDER BY name');
  const fees = await sql.query('SELECT * FROM fees ORDER BY name');
  const projects = await sql.query('SELECT * FROM projects ORDER BY year, branch');
  const items = await sql.query('SELECT * FROM project_items');
  const transactions = await sql.query('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
  const settings = await sql.query('SELECT * FROM settings LIMIT 1');

  const itemsByProject = new Map<string, FinancialProject['items']>();
  for (const row of items.rows) {
    const list = itemsByProject.get(row.project_id) ?? [];
    list.push({
      id: row.id,
      category: row.category,
      description: row.description,
      planned: Number(row.planned),
      movementTypeId: row.movement_type_id ? String(row.movement_type_id) : undefined,
    });
    itemsByProject.set(row.project_id, list);
  }

  const defaultSettings: Settings = {
    openingBalance: 0,
    groupName: 'Grupo Escoteiro Arno Friedrich',
    mensalidadeDueDay: DEFAULT_MENSALIDADE_DUE_DAY,
  };

  const settingsRow = settings.rows[0];

  return {
    members: members.rows.map(mapMember),
    memberGuardians: guardians.rows.map(mapGuardian),
    memberAccounts: accounts.rows.map(mapAccount),
    movementTypes: types.rows.map(mapMovementType),
    fees: fees.rows.map(mapFee),
    projects: projects.rows.map((row) => ({
      id: row.id,
      branch: row.branch,
      year: Number(row.year),
      name: row.name,
      description: row.description,
      items: itemsByProject.get(row.id) ?? [],
      ...mapAudit(row),
    })),
    transactions: transactions.rows.map(mapTransaction),
    settings: settingsRow
      ? {
          openingBalance: Number(settingsRow.opening_balance),
          groupName: settingsRow.group_name,
          mensalidadeDueDay: resolveMensalidadeDueDay(Number(settingsRow.mensalidade_due_day)),
        }
      : defaultSettings,
  };
}

function toIso(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapAudit(row: Record<string, unknown>) {
  return {
    origin: (row.origin === 'manual' ? 'manual' : row.origin === 'sicredi' ? 'sicredi' : 'integration') as RecordOrigin,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by ? String(row.updated_by) : undefined,
  };
}

function mapMember(row: Record<string, unknown>): Member {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: String(row.phone),
    branch: row.branch as Member['branch'],
    role: row.role as Member['role'],
    monthlyFee: Number(row.monthly_fee),
    status: row.status as Member['status'],
    joinedAt: String(row.joined_at).slice(0, 10),
    clubeLtc: Boolean(row.clube_ltc),
    ...mapAudit(row),
  };
}

function mapGuardian(row: Record<string, unknown>): MemberGuardian {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    name: String(row.name),
    relationship: String(row.relationship ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    ...mapAudit(row),
  };
}

function mapAccount(row: Record<string, unknown>): MemberAccount {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    holderName: String(row.holder_name),
    holderKind: row.holder_kind as MemberAccount['holderKind'],
    relationship: String(row.relationship ?? ''),
    pixKey: String(row.pix_key ?? ''),
    bank: String(row.bank ?? ''),
    agency: String(row.agency ?? ''),
    accountNumber: String(row.account_number ?? ''),
    document: String(row.document ?? ''),
    notes: row.notes ? String(row.notes) : undefined,
    isPrimary: Boolean(row.is_primary),
    active: Boolean(row.active),
    ...mapAudit(row),
  };
}

function mapMovementType(row: Record<string, unknown>): MovementType {
  return {
    id: String(row.id),
    name: String(row.name),
    direction: row.direction as MovementType['direction'],
    description: String(row.description ?? ''),
    pixKey: String(row.pix_key ?? ''),
    branch: (row.branch as MovementType['branch']) || 'grupo',
    active: Boolean(row.active),
    ...mapAudit(row),
  };
}

function mapFee(row: Record<string, unknown>): Fee {
  return {
    id: String(row.id),
    name: String(row.name),
    amount: Number(row.amount),
    ...mapAudit(row),
  };
}

function mapTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    date: String(row.date).slice(0, 10),
    type: row.type as Transaction['type'],
    nature: row.nature as Transaction['nature'],
    movementTypeId: String(row.movement_type_id),
    description: String(row.description),
    amount: Number(row.amount),
    branch: row.branch as Transaction['branch'],
    method: row.method as Transaction['method'],
    paymentStatus: row.payment_status === 'pending' ? 'pending' : 'paid',
    paidAt: row.paid_at ? String(row.paid_at).slice(0, 10) : undefined,
    memberId: row.member_id ? String(row.member_id) : undefined,
    memberAccountId: row.member_account_id ? String(row.member_account_id) : undefined,
    memberGuardianId: row.member_guardian_id ? String(row.member_guardian_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    externalId: row.external_id ? String(row.external_id) : undefined,
    ...mapAudit(row),
  };
}
