import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createTransaction, listTransactions, updateTransaction } from './transactions';
import { closeMonth, monthLabel, purgeTrash, reopenMonth, restoreTransaction, trashTransaction } from './governance';
import { fail, parseDto } from '../shared/http/api';
import { NotFound } from '../shared/domain/errors';
import { errorMessage } from '../shared/http/errors';
import { usersById, withAuthors } from '../shared/http/presenters';
import { createTransactionBody, patchTransactionBody } from '../shared/http/schemas';
import { NotificationDispatcher } from '../notifications/notification-dispatcher';
import { summarizeDeliveries } from '../notifications/types';
import {
  dismissReview,
  loadDb,
  mutate,
  readDismissals,
  readTransactionHistory,
} from '../shared/persistence/finance-store';
import { prisma } from '../shared/db';
import { duplicateKey, findDuplicateGroups, resolveDuplicate } from './duplicates';
import { authorOf } from '../shared/http/presenters';
import type { BranchId } from '../shared/types';
import { updatedAudit } from '../shared/audit';
import { resolveArrearsTxMarker } from '../arrears/arrears';
import { splitTransactionWithMensalidades } from '../mensalidades/mensalidades';
import {
  assertNotaFile,
  buildNotaKey,
  FILE_STORAGE,
  SIGNED_URL_TTL_SECONDS,
  type FileStorage,
} from '../storage/file-storage';

const splitBody = z.object({
  parts: z
    .array(
      z.object({
        amount: z.number().positive(),
        movementTypeId: z.string().min(1),
        description: z.string().min(2),
        projectId: z.string().nullable().optional(),
        memberId: z.string().nullable().optional(),
        /** Competência AAAA-MM — obrigatória em partes do tipo Mensalidade. */
        competence: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .nullable()
          .optional(),
      }),
    )
    .min(2),
});

@Injectable()
export class LedgerService {
  constructor(
    private readonly notifications: NotificationDispatcher,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

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
      hasNota: Boolean(tx.notaKey),
      arrearsMarker: resolveArrearsTxMarker(db, tx),
    }));
  }

  async create(body: unknown, userId: string) {
    const data = parseDto(createTransactionBody, body);
    return mutate((db) => createTransaction(db, data, userId));
  }

  async update(id: string, body: unknown, userId: string) {
    const data = parseDto(patchTransactionBody, body);
    const updated = await mutate((db) => updateTransaction(db, id, data, userId));
    if (!updated) throw new NotFound('Lançamento não encontrado');
    if (updated.shouldNotify && updated.tx.memberId) {
      const channels = this.notifications.configuredChannels();
      if (channels.length) {
        const db = await loadDb();
        const deliveries = await this.notifications.notifyTransaction(db, updated.tx, 'receipt', channels, userId);
        const notify = summarizeDeliveries(deliveries);
        return { ...updated.tx, notify };
      }
    }
    return updated.tx;
  }

  /** Excluir manda para a lixeira (30 dias). A nota no S3 fica até a lixeira ser esvaziada. */
  async remove(id: string, userId: string) {
    const entry = await mutate((store) => trashTransaction(store, id, userId));
    if (!entry) throw new NotFound('Lançamento não encontrado');
    return { trashId: entry.id };
  }

  async listTrash() {
    const db = await loadDb();
    const users = await usersById();
    return (db.trash ?? []).map((entry) => ({
      id: entry.id,
      deletedAt: entry.deletedAt,
      deletedBy: authorOf(users, entry.deletedBy),
      transaction: {
        ...entry.transaction,
        movementTypeName: db.movementTypes.find((item) => item.id === entry.transaction.movementTypeId)?.name ?? null,
        memberName: db.members.find((item) => item.id === entry.transaction.memberId)?.name ?? null,
      },
    }));
  }

  async restore(trashId: string) {
    const db = await loadDb();
    const entry = (db.trash ?? []).find((item) => item.id === trashId);
    if (!entry) throw new NotFound('Item não encontrado na lixeira');
    return mutate((store) => restoreTransaction(store, trashId), {
      restoredIds: new Set([entry.transaction.id]),
    });
  }

  /** Esvazia a lixeira (admin) e apaga as notas anexadas no S3. */
  async emptyTrash() {
    const purged = await mutate((store) => purgeTrash(store, new Date(), 0));
    if (this.storage.isConfigured()) {
      for (const key of purged.map((item) => item.transaction.notaKey).filter(Boolean) as string[]) {
        try {
          await this.storage.remove(key);
        } catch {
          // objeto já removido ou S3 indisponível: o registro sai da lixeira mesmo assim
        }
      }
    }
    return { removed: purged.length };
  }

  async duplicates() {
    return findDuplicateGroups(await loadDb(), await readDismissals('dup:'));
  }

  async dismissDuplicate(body: unknown, userId: string) {
    const parsed = z.object({ ids: z.array(z.string().min(1)).min(2) }).safeParse(body);
    if (!parsed.success) fail('Informe os lançamentos do grupo', HttpStatus.BAD_REQUEST);
    await dismissReview(duplicateKey(parsed.data.ids), userId);
    return { dismissed: true };
  }

  async resolveDuplicate(body: unknown, userId: string) {
    const parsed = z.object({ keepId: z.string().min(1), dropIds: z.array(z.string().min(1)).min(1) }).safeParse(body);
    if (!parsed.success) fail('Informe o lançamento mantido e as cópias', HttpStatus.BAD_REQUEST);
    const trashed = await mutate((store) => resolveDuplicate(store, parsed.data.keepId, parsed.data.dropIds, userId));
    // Linhas do extrato que apontavam para a cópia passam a apontar para o lançamento mantido.
    await prisma.bankMovement.updateMany({
      where: { transactionId: { in: parsed.data.dropIds } },
      data: { transactionId: parsed.data.keepId },
    });
    return { trashed: trashed.map((item) => item.id) };
  }

  async history(id: string) {
    const users = await usersById();
    const rows = await readTransactionHistory(id);
    return rows.map((row) => ({ ...row, by: row.byId ? authorOf(users, row.byId) : null }));
  }

  async listClosings() {
    const db = await loadDb();
    const users = await usersById();
    return (db.monthClosings ?? []).map((item) => ({ ...item, closedByUser: authorOf(users, item.closedBy) }));
  }

  async closeMonth(body: unknown, userId: string) {
    const parsed = z.object({ yearMonth: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(body);
    if (!parsed.success) fail('Informe o mês (AAAA-MM)', HttpStatus.BAD_REQUEST);
    return mutate((store) => closeMonth(store, parsed.data.yearMonth, userId));
  }

  async reopenMonth(yearMonth: string) {
    const ok = await mutate((store) => reopenMonth(store, yearMonth));
    if (!ok) fail(`${monthLabel(yearMonth)} não está fechado`, HttpStatus.NOT_FOUND);
    return { reopened: yearMonth };
  }

  async uploadNota(id: string, file: Express.Multer.File | undefined, userId: string) {
    if (!this.storage.isConfigured())
      fail('Armazenamento de notas não configurado (AWS_S3_BUCKET)', HttpStatus.SERVICE_UNAVAILABLE);
    if (!file) fail('Envie o arquivo da nota no campo file', HttpStatus.BAD_REQUEST);
    assertNotaFile(file);

    const db = await loadDb();
    const tx = db.transactions.find((item) => item.id === id);
    if (!tx) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);

    const previousKey = tx.notaKey;
    const fileName = file.originalname?.trim() || 'nota';
    const contentType = file.mimetype;
    const key = buildNotaKey(id, fileName, contentType);

    try {
      await this.storage.upload({
        key,
        body: file.buffer,
        contentType,
        fileName,
      });
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível enviar a nota ao armazenamento'), HttpStatus.BAD_GATEWAY);
    }

    const updated = await mutate((store) => {
      const current = store.transactions.find((item) => item.id === id);
      if (!current) return null;
      current.notaKey = key;
      current.notaFileName = fileName;
      current.notaContentType = contentType;
      Object.assign(current, updatedAudit(userId));
      return current;
    });
    if (!updated) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);

    if (previousKey && previousKey !== key) {
      try {
        await this.storage.remove(previousKey);
      } catch {
        // ignora falha ao limpar arquivo antigo
      }
    }

    return {
      id: updated.id,
      notaKey: updated.notaKey,
      notaFileName: updated.notaFileName,
      notaContentType: updated.notaContentType,
      hasNota: true,
    };
  }

  async getNota(id: string) {
    if (!this.storage.isConfigured())
      fail('Armazenamento de notas não configurado (AWS_S3_BUCKET)', HttpStatus.SERVICE_UNAVAILABLE);
    const db = await loadDb();
    const tx = db.transactions.find((item) => item.id === id);
    if (!tx) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);
    if (!tx.notaKey) fail('Este lançamento não tem nota anexada', HttpStatus.NOT_FOUND);

    try {
      const url = await this.storage.signedUrl(tx.notaKey, tx.notaFileName);
      return {
        url,
        fileName: tx.notaFileName ?? 'nota',
        contentType: tx.notaContentType ?? 'application/octet-stream',
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      };
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível gerar o link da nota'), HttpStatus.BAD_GATEWAY);
    }
  }

  async removeNota(id: string, userId: string) {
    const db = await loadDb();
    const tx = db.transactions.find((item) => item.id === id);
    if (!tx) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);
    if (!tx.notaKey) fail('Este lançamento não tem nota anexada', HttpStatus.NOT_FOUND);

    const key = tx.notaKey;
    await mutate((store) => {
      const current = store.transactions.find((item) => item.id === id);
      if (!current) return false;
      delete current.notaKey;
      delete current.notaFileName;
      delete current.notaContentType;
      Object.assign(current, updatedAudit(userId));
      return true;
    });

    if (this.storage.isConfigured()) {
      try {
        await this.storage.remove(key);
      } catch {
        // metadados já removidos
      }
    }
  }

  async split(id: string, body: unknown, userId: string) {
    const parsed = splitBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe pelo menos duas partes com valor, tipo e descrição', HttpStatus.BAD_REQUEST);
    }
    return mutate((db) => splitTransactionWithMensalidades(db, id, parsed.data.parts, userId));
  }
}
