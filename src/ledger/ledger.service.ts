import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from './transactions';
import { fail, parseDto } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';
import { usersById, withAuthors } from '../shared/http/presenters';
import { createTransactionBody, patchTransactionBody } from '../shared/http/schemas';
import { configuredNotifyChannels, notifyTransaction, summarizeDeliveries } from '../notifications/notify';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import type { BranchId } from '../shared/types';
import { updatedAudit } from '../shared/audit';
import { resolveArrearsTxMarker } from '../arrears/arrears';
import { splitTransactionWithMensalidades } from '../mensalidades/mensalidades';
import {
  assertNotaFile,
  buildNotaKey,
  deleteNotaObject,
  s3Configured,
  signedNotaUrl,
  uploadNotaObject,
} from '../storage/s3';

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
    const db = await loadDb();
    const tx = db.transactions.find((item) => item.id === id);
    const notaKey = tx?.notaKey;
    const ok = await mutate((store) => deleteTransaction(store, id));
    if (!ok) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);
    if (notaKey && s3Configured()) {
      try {
        await deleteNotaObject(notaKey);
      } catch {
        // não bloqueia a exclusão do lançamento se o S3 falhar
      }
    }
  }

  async uploadNota(id: string, file: Express.Multer.File | undefined, userId: string) {
    if (!s3Configured()) fail('Armazenamento de notas não configurado (AWS_S3_BUCKET)', HttpStatus.SERVICE_UNAVAILABLE);
    if (!file) fail('Envie o arquivo da nota no campo file', HttpStatus.BAD_REQUEST);
    try {
      assertNotaFile(file);
    } catch (error) {
      fail(errorMessage(error, 'Arquivo inválido'), HttpStatus.BAD_REQUEST);
    }

    const db = await loadDb();
    const tx = db.transactions.find((item) => item.id === id);
    if (!tx) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);

    const previousKey = tx.notaKey;
    const fileName = file.originalname?.trim() || 'nota';
    const contentType = file.mimetype;
    const key = buildNotaKey(id, fileName, contentType);

    try {
      await uploadNotaObject({
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
        await deleteNotaObject(previousKey);
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
    if (!s3Configured()) fail('Armazenamento de notas não configurado (AWS_S3_BUCKET)', HttpStatus.SERVICE_UNAVAILABLE);
    const db = await loadDb();
    const tx = db.transactions.find((item) => item.id === id);
    if (!tx) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);
    if (!tx.notaKey) fail('Este lançamento não tem nota anexada', HttpStatus.NOT_FOUND);

    try {
      const url = await signedNotaUrl(tx.notaKey, tx.notaFileName);
      return {
        url,
        fileName: tx.notaFileName ?? 'nota',
        contentType: tx.notaContentType ?? 'application/octet-stream',
        expiresInSeconds: 15 * 60,
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

    if (s3Configured()) {
      try {
        await deleteNotaObject(key);
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
    try {
      return await mutate((db) => splitTransactionWithMensalidades(db, id, parsed.data.parts, userId));
    } catch (error) {
      fail(errorMessage(error, 'Não foi possível ratear o lançamento'), HttpStatus.BAD_REQUEST);
    }
  }
}
