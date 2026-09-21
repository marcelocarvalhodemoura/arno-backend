import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { cashFlow, customReport, dashboard } from './finance';
import { parseDto } from '../shared/http/api';
import { branch, nature, txType } from '../shared/http/schemas';
import { authorOf, usersById } from '../shared/http/presenters';
import { loadDb } from '../shared/persistence/finance-store';

const customReportBody = z.object({
  from: z.string(),
  to: z.string(),
  branches: z.array(branch).default([]),
  types: z.array(txType).default([]),
  natures: z.array(nature).default([]),
  movementTypeIds: z.array(z.string()).default([]),
  groupBy: z.enum(['none', 'month', 'branch', 'movementType', 'nature']),
});

@Injectable()
export class ReportsService {
  async dashboard(year?: string, month?: string) {
    const now = new Date();
    const y = Number(year ?? now.getFullYear());
    const m = Number(month ?? now.getMonth() + 1);
    return dashboard(await loadDb(), y, m);
  }

  async cashFlow(from?: string, to?: string) {
    const start = from ?? `${new Date().getFullYear()}-01-01`;
    const end = to ?? new Date().toISOString().slice(0, 10);
    return cashFlow(await loadDb(), start, end);
  }

  async custom(body: unknown) {
    const data = parseDto(customReportBody, body);
    const report = customReport(await loadDb(), data);
    const users = await usersById();
    const txById = new Map(report.transactions.map((tx) => [tx.id, tx]));
    return {
      ...report,
      ledger: report.ledger.map((line) => {
        const tx = txById.get(line.id);
        const created = authorOf(users, tx?.createdBy);
        const updated = authorOf(users, tx?.updatedBy);
        return {
          ...line,
          createdByName: created?.name ?? 'Carga inicial',
          createdAt: tx?.createdAt ?? line.createdAt,
          updatedByName: updated?.name,
          updatedAt: tx?.updatedAt,
          origin: tx?.origin ?? 'integration',
        };
      }),
    };
  }
}
