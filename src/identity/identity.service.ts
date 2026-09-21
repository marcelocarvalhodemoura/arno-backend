import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hashPassword, isLegacyHash, verifyPassword } from '../shared/auth/password';
import { issueToken, type AuthPayload } from '../shared/auth/token';
import { fail, parseDto } from '../shared/http/api';
import { errorMessage, isUniqueUserConflict } from '../shared/http/errors';
import { usersById, withAuthors } from '../shared/http/presenters';
import { userRole } from '../shared/http/schemas';
import { loadDb, resetDb } from '../shared/persistence/finance-store';
import type { UserRole } from '../shared/types';
import { createUser, findUserByLogin, listUsers, replacePasswordHash, updateUser, verifyUserPassword } from './users';

const loginBody = z.object({
  user: z.string().trim().min(1),
  password: z.string().min(1),
});

const createUserBody = z
  .object({
    username: z.string().trim().min(2),
    name: z.string().trim().min(2),
    email: z.string().trim().email(),
    password: z.string().min(6),
    passwordConfirm: z.string().min(6),
    role: userRole,
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'As senhas não coincidem',
    path: ['passwordConfirm'],
  });

const patchUserBody = z
  .object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    role: userRole.optional(),
    active: z.boolean().optional(),
    password: z.string().min(6).optional(),
    passwordConfirm: z.string().optional(),
    currentPassword: z.string().min(1),
  })
  .refine((data) => !data.password || data.password === data.passwordConfirm, {
    message: 'As senhas não coincidem',
    path: ['passwordConfirm'],
  });

@Injectable()
export class IdentityService {
  async login(body: unknown) {
    const parsed = loginBody.safeParse(body);
    if (!parsed.success) fail('Informe usuário e senha', HttpStatus.BAD_REQUEST);
    const { user, password } = parsed.data;
    const found = await findUserByLogin(user);
    if (!found || !found.active || !(await verifyPassword(password, found.passwordHash))) {
      fail('Credenciais inválidas', HttpStatus.UNAUTHORIZED);
    }
    if (isLegacyHash(found.passwordHash)) {
      await replacePasswordHash(found.id, await hashPassword(password));
    }
    const db = await loadDb();
    return {
      token: issueToken(found.username, found.id, found.role),
      user: found.username,
      role: found.role,
      name: found.name,
      group: db.settings.groupName,
    };
  }

  me(auth: AuthPayload) {
    return { user: auth.user, role: auth.role, userId: auth.userId };
  }

  async list() {
    const users = await usersById();
    return (await listUsers()).map((user) => withAuthors(user, users));
  }

  async create(body: unknown, createdBy: string) {
    const data = parseDto(createUserBody, body);
    try {
      const { passwordConfirm: _passwordConfirm, ...input } = data;
      return await createUser({
        ...input,
        role: input.role as UserRole,
        createdBy,
        origin: 'manual',
      });
    } catch (error) {
      this.rethrowUserConflict(error, 'Erro ao criar usuário');
    }
  }

  async update(id: string, body: unknown, actorId: string) {
    const data = parseDto(patchUserBody, body);
    if (!(await verifyUserPassword(actorId, data.currentPassword))) {
      fail('Senha de confirmação inválida', HttpStatus.FORBIDDEN);
    }
    try {
      const { currentPassword: _currentPassword, passwordConfirm: _passwordConfirm, ...input } = data;
      const updated = await updateUser(id, { ...input, updatedBy: actorId });
      if (!updated) fail('Usuário não encontrado', HttpStatus.NOT_FOUND);
      return updated;
    } catch (error) {
      this.rethrowUserConflict(error, 'Erro ao atualizar usuário');
    }
  }

  async reset() {
    return resetDb();
  }

  private rethrowUserConflict(error: unknown, fallback: string): never {
    const message = errorMessage(error, fallback);
    if (isUniqueUserConflict(message)) {
      fail('Usuário ou e-mail já existe', HttpStatus.CONFLICT);
    }
    fail(message, HttpStatus.BAD_REQUEST);
  }
}
