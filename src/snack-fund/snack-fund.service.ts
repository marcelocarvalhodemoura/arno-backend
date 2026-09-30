import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail } from '../shared/http/api';
import { loadDb } from '../shared/persistence/finance-store';
import { buildSnackFundPreview, buildSnackFundYearSummary } from './snack-fund';

const previewQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

@Injectable()
export class SnackFundService {
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
      return buildSnackFundYearSummary(db, parsed.data.year);
    }
    return buildSnackFundPreview(db, parsed.data.year, parsed.data.month);
  }
}
