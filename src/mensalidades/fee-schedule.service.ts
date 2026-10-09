import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { parseDto } from '../shared/http/api';
import { NotFound } from '../shared/domain/errors';
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
    await mutate((db) => createFeePeriod(db, data, userId));
    return this.list();
  }

  async update(id: string, body: unknown, userId: string) {
    const data = parseDto(periodBody, body, 'Composição inválida');
    const updated = await mutate((db) => updateFeePeriod(db, id, data, userId));
    if (!updated) throw new NotFound('Período não encontrado');
    return this.list();
  }

  async remove(id: string, userId: string) {
    const removed = await mutate((db) => deleteFeePeriod(db, id, userId));
    if (!removed) throw new NotFound('Período não encontrado');
    return this.list();
  }
}
