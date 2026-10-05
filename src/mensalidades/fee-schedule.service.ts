import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail, parseDto } from '../shared/http/api';
import { errorMessage } from '../shared/http/errors';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import { createFeePeriod, deleteFeePeriod, sortedSchedule, updateFeePeriod } from './fee-schedule';

const money = z.number().min(0).max(10_000);

const composition = z.object({
  group: money,
  branch: money,
  snack: money,
  clubOnTime: money,
  clubLate: money,
  dilution: money,
  lateFee: money,
  pendingSplit: z.boolean().optional().default(false),
});

const periodBody = z.object({
  startMonth: z.string().min(7),
  endMonth: z.string().nullable().optional(),
  note: z.string().max(200).optional().default(''),
  regular: composition,
  pioneer: composition,
  familyNonMember: composition.nullable(),
  familyMember: composition.nullable(),
});

@Injectable()
export class FeeScheduleService {
  async list() {
    return sortedSchedule(await loadDb());
  }

  async create(body: unknown, userId: string) {
    const data = parseDto(periodBody, body, 'Composição inválida');
    return this.write(async () => {
      await mutate((db) => createFeePeriod(db, data, userId));
    }, 'Não foi possível criar o período');
  }

  async update(id: string, body: unknown, userId: string) {
    const data = parseDto(periodBody, body, 'Composição inválida');
    return this.write(async () => {
      const updated = await mutate((db) => updateFeePeriod(db, id, data, userId));
      if (!updated) fail('Período não encontrado', HttpStatus.NOT_FOUND);
    }, 'Não foi possível alterar o período');
  }

  async remove(id: string, userId: string) {
    return this.write(async () => {
      const removed = await mutate((db) => deleteFeePeriod(db, id, userId));
      if (!removed) fail('Período não encontrado', HttpStatus.NOT_FOUND);
    }, 'Não foi possível excluir o período');
  }

  /** Grava e devolve a tabela inteira, já ordenada. */
  private async write(fn: () => Promise<void>, fallback: string) {
    try {
      await fn();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      fail(errorMessage(error, fallback), HttpStatus.BAD_REQUEST);
    }
    return this.list();
  }
}
