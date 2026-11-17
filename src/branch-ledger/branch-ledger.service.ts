import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail } from '../shared/http/api';
import { loadDb } from '../shared/persistence/finance-store';
import type { YouthBranchId } from '../shared/types';
import { buildBranchLines, buildBranchStatement, buildMoneyMap, YOUTH_LEDGER_BRANCHES } from './branch-ledger';

const branchSchema = z.enum(YOUTH_LEDGER_BRANCHES as [YouthBranchId, ...YouthBranchId[]]);
const yearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function parseBranch(value: string | undefined): YouthBranchId {
  const parsed = branchSchema.safeParse(value);
  if (!parsed.success) fail('Informe um ramo válido', HttpStatus.BAD_REQUEST);
  return parsed.data;
}

@Injectable()
export class BranchLedgerService {
  async statement(branch: string | undefined) {
    return buildBranchStatement(await loadDb(), parseBranch(branch));
  }

  async lines(branch: string | undefined, month: string | undefined) {
    const yearMonth = yearMonthSchema.safeParse(month);
    if (!yearMonth.success) fail('Informe o mês no formato AAAA-MM', HttpStatus.BAD_REQUEST);
    return buildBranchLines(await loadDb(), parseBranch(branch), yearMonth.data);
  }

  async moneyMap(until: string | undefined) {
    if (until !== undefined && !dateSchema.safeParse(until).success) {
      fail('Informe a data no formato AAAA-MM-DD', HttpStatus.BAD_REQUEST);
    }
    return buildMoneyMap(await loadDb(), until);
  }
}
