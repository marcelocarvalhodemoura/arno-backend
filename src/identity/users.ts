import type { User } from '@prisma/client';
import { prisma } from '../shared/db';
import { hashPassword, isLegacyHash, verifyPassword } from '../shared/auth/password';
import { id } from '../shared/id';
import type { AppUser, RecordOrigin, UserRole } from '../shared/types';

function toUser(row: User): AppUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    origin: row.origin === 'manual' ? 'manual' : 'integration',
    createdBy: row.createdById ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedById ?? undefined,
  };
}

function foldedLogin(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function findUserByUsername(username: string): Promise<(AppUser & { passwordHash: string }) | null> {
  const row = await prisma.user.findUnique({ where: { username } });
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.passwordHash };
}

export async function findUserByLogin(login: string): Promise<(AppUser & { passwordHash: string }) | null> {
  const key = foldedLogin(login);
  if (!key) return null;
  const users = await prisma.user.findMany();
  const match = users
    .filter((user) => foldedLogin(user.username) === key || user.email.trim().toLowerCase() === key)
    .sort((a, b) => Number(foldedLogin(a.username) !== key) - Number(foldedLogin(b.username) !== key));
  const row = match[0];
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.passwordHash };
}

export async function findUserById(userId: string): Promise<(AppUser & { passwordHash: string }) | null> {
  const row = await prisma.user.findUnique({ where: { id: userId } });
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.passwordHash };
}

export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const found = await findUserById(userId);
  if (!found || !found.active) return false;
  return verifyPassword(password, found.passwordHash);
}

export async function listUsers(): Promise<AppUser[]> {
  const rows = await prisma.user.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toUser);
}

export async function createUser(input: {
  username: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  createdBy?: string;
  origin?: RecordOrigin;
}): Promise<AppUser> {
  const row = await prisma.user.create({
    data: {
      id: id(),
      username: input.username,
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      origin: input.origin ?? 'manual',
      createdById: input.createdBy ?? null,
    },
  });
  return toUser(row);
}

export async function updateUser(
  userId: string,
  input: {
    name?: string;
    email?: string;
    role?: UserRole;
    active?: boolean;
    password?: string;
    updatedBy?: string;
  },
): Promise<AppUser | null> {
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) return null;
  const row = await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name ?? current.name,
      email: input.email ?? current.email,
      role: input.role ?? current.role,
      active: input.active ?? current.active,
      passwordHash: input.password ? await hashPassword(input.password) : current.passwordHash,
      updatedAt: new Date(),
      updatedById: input.updatedBy ?? current.updatedById,
    },
  });
  return toUser(row);
}

/**
 * Regrava só o hash, sem mexer em updated_at nem updated_by: quem migra o
 * formato da senha é o login, não uma edição do cadastro.
 */
export async function replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}

/**
 * Regrava em bcrypt as senhas do seed que ainda estão no formato antigo
 * (`salt:hash` do scrypt), quando ADMIN_PASSWORD coincide com o que está no banco.
 * Os demais usuários são migrados no próprio login, porque só então a senha
 * em texto entra de novo no processo.
 */
export async function rehashLegacySeedUsers(): Promise<number> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return 0;
  const usernames = [...new Set(['admin', process.env.ADMIN_USER ?? 'tesouraria'])];
  let upgraded = 0;
  for (const username of usernames) {
    const found = await findUserByUsername(username);
    if (!found || !isLegacyHash(found.passwordHash)) continue;
    if (!(await verifyPassword(password, found.passwordHash))) continue;
    await replacePasswordHash(found.id, await hashPassword(password));
    upgraded += 1;
  }
  return upgraded;
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}
