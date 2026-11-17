import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fail } from '../shared/http/api';
import { loadDb } from '../shared/persistence/finance-store';
import { allocationIndex, buildConference, computeAllocation, describeAllocation, groupCashOf } from './allocations';

const yearQuery = z.coerce.number().int().min(2000).max(2100);

@Injectable()
export class AllocationsService {
  async conference(year: string | undefined) {
    const parsed = yearQuery.safeParse(year ?? String(new Date().getFullYear()));
    if (!parsed.success) fail('Informe um ano válido', HttpStatus.BAD_REQUEST);
    return buildConference(await loadDb(), parsed.data);
  }

  async ofTransaction(transactionId: string) {
    const db = await loadDb();
    const tx = db.transactions.find((item) => item.id === transactionId);
    if (!tx) fail('Lançamento não encontrado', HttpStatus.NOT_FOUND);
    const allocation = allocationIndex(db).get(transactionId);
    if (!allocation) fail('Este lançamento não é uma mensalidade paga de associado', HttpStatus.NOT_FOUND);
    const current = computeAllocation(db, tx, allocation.computedAt);
    return {
      allocation,
      description: describeAllocation(allocation),
      groupCash: groupCashOf(allocation),
      current,
      currentDescription: current ? describeAllocation(current) : null,
    };
  }
}
