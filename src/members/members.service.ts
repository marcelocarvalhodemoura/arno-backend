import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  siblingIdsOf,
  refreshOfficialFees,
  createMember,
  importMembers,
  addMemberAccount,
  removeMemberAccount,
  updateMember,
  updateMemberAccount,
} from './members';
import { fail, parseDto } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';
import { usersById, withAuthors } from '../shared/http/presenters';
import { accountBody, createMemberBody, memberImportRow, patchMemberBody } from '../shared/http/schemas';
import { mutate } from '../shared/persistence/finance-store';
import { IMPORT_CHUNK_SIZE } from '../shared/types';

const importMembersBody = z.object({
  rows: z.array(memberImportRow).min(1).max(IMPORT_CHUNK_SIZE),
});
const patchAccountBody = accountBody.partial().extend({ active: z.boolean().optional() });

@Injectable()
export class MembersService {
  async list(branchFilter?: string, status?: string) {
    const db = await mutate((store) => refreshOfficialFees(store));
    const users = await usersById();
    let list = db.members;
    if (branchFilter) list = list.filter((member) => member.branch === branchFilter);
    if (status) list = list.filter((member) => member.status === status);
    return list.map((member) => ({
      ...withAuthors(member, users),
      siblingIds: siblingIdsOf(db, member.id),
      accounts: db.memberAccounts
        .filter((account) => account.memberId === member.id)
        .map((account) => withAuthors(account, users)),
      guardians: (db.memberGuardians ?? [])
        .filter((guardian) => guardian.memberId === member.id)
        .map((guardian) => withAuthors(guardian, users)),
    }));
  }

  async create(body: unknown, userId: string) {
    const data = parseDto(createMemberBody, body);
    try {
      return await mutate((db) => createMember(db, data, userId));
    } catch (error) {
      const message = errorMessage(error, 'Não foi possível cadastrar');
      fail(message, message === 'E-mail já cadastrado' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    }
  }

  async update(id: string, body: unknown, userId: string) {
    const data = parseDto(patchMemberBody, body);
    try {
      const updated = await mutate((db) => updateMember(db, id, data, userId));
      if (!updated) fail('Associado não encontrado', HttpStatus.NOT_FOUND);
      return updated;
    } catch (error) {
      const message = errorMessage(error, 'Não foi possível alterar');
      fail(message, message === 'E-mail já cadastrado' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    }
  }

  async addAccount(memberId: string, body: unknown, userId: string) {
    const data = parseDto(accountBody, body);
    const created = await mutate((db) => addMemberAccount(db, memberId, data, userId));
    if (!created) fail('Associado não encontrado', HttpStatus.NOT_FOUND);
    return created;
  }

  async updateAccount(id: string, body: unknown, userId: string) {
    const data = parseDto(patchAccountBody, body);
    const updated = await mutate((db) => updateMemberAccount(db, id, data, userId));
    if (!updated) fail('Conta não encontrada', HttpStatus.NOT_FOUND);
    return updated;
  }

  async removeAccount(id: string) {
    const ok = await mutate((db) => removeMemberAccount(db, id));
    if (!ok) fail('Conta não encontrada', HttpStatus.NOT_FOUND);
  }

  async importRows(body: unknown, userId: string) {
    const data = parseDto(importMembersBody, body);
    return mutate((db) => importMembers(db, data.rows, userId));
  }
}
