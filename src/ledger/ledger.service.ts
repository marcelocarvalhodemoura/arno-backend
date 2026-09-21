import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from './transactions';
import { splitTransaction } from './split';
import { fail, parseDto } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';
import { usersById, withAuthors } from '../shared/http/presenters';
import { createTransactionBody, patchTransactionBody } from '../shared/http/schemas';
import { configuredNotifyChannels, notifyTransaction, summarizeDeliveries } from '../notifications/notify';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import type { BranchId } from '../shared/types';

const splitBody = z.object({
  parts: z
    .array(
      z.object({
        amount: z.number().positive(),
        movementTypeId: z.string().min(1),
        description: z.string().min(2),
        projectId: z.string().nullable().optional(),
        memberId: z.string().nullable().optional(),
      }),
    )
    .min(2),
});

@Injectable()
export class LedgerService {
  async list(query: { from?: string; to?: string; branch?: string; type?: string; nature?: string }) {
    const db = await loadDb();
    const users = await usersById();
    const list = listTransactions(db, {
      from: query.from ?? '2000-01-01',
      to: query.to ?? '2100-12-31',
      branch: query.branch as BranchId | undefined,
      type: query.type as 'income' | 'expense' | undefined,
      nature: query.nature as 'fixed' | 'variable' | undefined,
    });
    return list.map((tx) => ({
      ...withAuthors(tx, users),
      movementType: db.movementTypes.find((item) => item.id === tx.movementTypeId) ?? null,
      member: tx.memberId ? (db.members.find((member) => member.id === tx.memberId) ?? null) : null,
      account: tx.memberAccountId
        ? (db.memberAccounts.find((account) => account.id === tx.memberAccountId) ?? null)
        : null,
      guardian: tx.memberGuardianId
        ? ((db.memberGuardians ?? []).find((item) => item.id === tx.memberGuardianId) ?? null)
        : null,
    }));
  }

  async create(body: unknown, userId: string) {
    const data = parseDto(createTransactionBody, body);
    try {
      return await mutate((db) => createTransaction(db, data, userId));
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível lançar'), HttpStatus.BAD_REQUEST);
    }
  }

  async update(id: string, body: unknown, userId: string) {
    const data = parseDto(patchTransactionBody, body);
    try {
      const updated = await mutate((db) => updateTransaction(db, id, data, userId));
      if (!updated) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);
      if (updated.shouldNotify && updated.tx.memberId) {
        const channels = configuredNotifyChannels();
        if (channels.length) {
          const db = await loadDb();
          const notify = summarizeDeliveries(await notifyTransaction(db, updated.tx, 'receipt', channels, userId));
          return { ...updated.tx, notify };
        }
      }
      return updated.tx;
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível alterar'), HttpStatus.BAD_REQUEST);
    }
  }

  async remove(id: string) {
    const ok = await mutate((db) => deleteTransaction(db, id));
    if (!ok) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);
  }

  async split(id: string, body: unknown, userId: string) {
    const parsed = splitBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe pelo menos duas partes com valor, tipo e descrição', HttpStatus.BAD_REQUEST);
    }
    try {
      return await mutate((db) => splitTransaction(db, id, parsed.data.parts, userId));
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível ratear o lançamento'), HttpStatus.BAD_REQUEST);
    }
  }
}
