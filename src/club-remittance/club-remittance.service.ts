import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail, parseDto } from '../shared/http/api';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import { buildClubRemittancePreview, buildClubRemittanceYearSummary, registerClubRemittance } from './club-remittance';

const previewQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

const registerBody = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  method: z.enum(['pix', 'cash', 'transfer', 'card', 'other']).optional(),
  notes: z.string().max(2000).optional(),
});

@Injectable()
export class ClubRemittanceService {
  async preview(yearQuery: string | undefined, monthQuery: string | undefined) {
    const yearRaw = yearQuery ?? String(new Date().getFullYear());
    const parsed = previewQuery.safeParse({
      year: yearRaw,
      month: monthQuery || undefined,
    });
    if (!parsed.success) {
      fail('Informe um ano válido e, se quiser detalhe, um mês de 1 a 12', HttpStatus.BAD_REQUEST);
    }
    const db = await loadDb();
    if (parsed.data.month == null) {
      return buildClubRemittanceYearSummary(db, parsed.data.year);
    }
    return buildClubRemittancePreview(db, parsed.data.year, parsed.data.month);
  }

  async register(body: unknown, userId: string) {
    const data = parseDto(registerBody, body, 'Informe ano, mês e opcionalmente a data do repasse');
    return mutate((db) => registerClubRemittance(db, data, userId));
  }
}
