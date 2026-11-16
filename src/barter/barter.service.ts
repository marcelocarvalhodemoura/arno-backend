import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { prisma } from '../shared/db';
import { fail, parseDto } from '../shared/http/api';
import { loadDb, mutate } from '../shared/persistence/finance-store';
import type { DatabaseShape } from '../shared/types';
import { applyBarter, planBarter, type Barter, type BarterApplied, type BarterPlan } from './barter';
import {
  claimPendingBarter,
  createBarter,
  getBarter,
  listBarters,
  markBarterApproved,
  rejectPendingBarter,
  releaseBarter,
} from './barter-store';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

const previewBody = z.object({
  memberId: z.string().min(1).optional(),
  amount: z.number().positive(),
  serviceDate: isoDate,
});

const createBody = previewBody.extend({
  donorName: z.string().trim().min(2, 'Informe quem prestou o serviço'),
  service: z.string().trim().min(3, 'Descreva o serviço'),
  expenseTypeId: z.string().min(1, 'Escolha o tipo da despesa do serviço'),
  donationTypeId: z.string().min(1, 'Escolha o tipo da doação'),
  notes: z.string().trim().optional(),
});

const decisionBody = z.object({ note: z.string().trim().optional() });
const rejectBody = z.object({ note: z.string().trim().min(3, 'Informe o motivo da recusa') });

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Dados inválidos';
}

function assertTypes(db: DatabaseShape, expenseTypeId: string, donationTypeId: string) {
  const expense = db.movementTypes.find((item) => item.id === expenseTypeId);
  if (!expense || !expense.active) fail('Tipo da despesa do serviço inválido', HttpStatus.BAD_REQUEST);
  if (expense.direction === 'income') fail('O tipo da despesa precisa aceitar saída', HttpStatus.BAD_REQUEST);
  const donation = db.movementTypes.find((item) => item.id === donationTypeId);
  if (!donation || !donation.active) fail('Tipo da doação inválido', HttpStatus.BAD_REQUEST);
  if (donation.direction === 'expense') fail('O tipo da doação precisa aceitar entrada', HttpStatus.BAD_REQUEST);
}

function safePlan(db: DatabaseShape, input: { memberId?: string; amount: number; serviceDate: string }) {
  try {
    return planBarter(db, input);
  } catch (err) {
    fail(err instanceof Error ? err.message : 'Não foi possível calcular a permuta', HttpStatus.BAD_REQUEST);
  }
}

@Injectable()
export class BarterService {
  async preview(body: unknown): Promise<BarterPlan> {
    const parsed = previewBody.safeParse(body);
    if (!parsed.success) fail(firstIssue(parsed.error), HttpStatus.BAD_REQUEST);
    return safePlan(await loadDb(), parsed.data);
  }

  async list() {
    const [items, db, users] = await Promise.all([
      listBarters(),
      loadDb(),
      prisma.user.findMany({ select: { id: true, name: true } }),
    ]);
    const userName = new Map(users.map((user) => [user.id, user.name]));
    const memberName = new Map(db.members.map((item) => [item.id, item.name]));
    const typeName = new Map(db.movementTypes.map((item) => [item.id, item.name]));
    return items.map((item) => this.view(db, item, { userName, memberName, typeName }));
  }

  private view(
    db: DatabaseShape,
    item: Barter,
    names: { userName: Map<string, string>; memberName: Map<string, string>; typeName: Map<string, string> },
  ) {
    let plan: BarterPlan | undefined;
    let planError: string | undefined;
    if (item.status === 'pending') {
      try {
        plan = planBarter(db, item);
      } catch (err) {
        planError = err instanceof Error ? err.message : 'Não foi possível calcular a permuta';
      }
    }
    const settled = item.settledIds
      .map((id) => db.transactions.find((tx) => tx.id === id))
      .filter((tx) => tx !== undefined)
      .map((tx) => ({
        transactionId: tx.id,
        memberId: tx.memberId ?? '',
        memberName: names.memberName.get(tx.memberId ?? '') ?? '',
        dueDate: tx.date.slice(0, 10),
        amount: tx.amount,
      }));
    return {
      ...item,
      memberName: item.memberId ? names.memberName.get(item.memberId) : undefined,
      expenseTypeName: names.typeName.get(item.expenseTypeId) ?? '',
      donationTypeName: names.typeName.get(item.donationTypeId) ?? '',
      createdByName: item.createdById ? names.userName.get(item.createdById) : undefined,
      decidedByName: item.decidedById ? names.userName.get(item.decidedById) : undefined,
      plan,
      planError,
      settled,
    };
  }

  async create(body: unknown, userId: string) {
    const parsed = createBody.safeParse(body);
    if (!parsed.success) fail(firstIssue(parsed.error), HttpStatus.BAD_REQUEST);
    const data = parsed.data;
    const db = await loadDb();
    assertTypes(db, data.expenseTypeId, data.donationTypeId);
    const plan = safePlan(db, data);
    const barter = await createBarter(
      {
        memberId: data.memberId,
        donorName: data.donorName,
        service: data.service,
        amount: data.amount,
        serviceDate: data.serviceDate,
        expenseTypeId: data.expenseTypeId,
        donationTypeId: data.donationTypeId,
        notes: data.notes ?? '',
      },
      userId,
    );
    return { barter, plan };
  }

  async approve(id: string, body: unknown, userId: string) {
    const { note } = parseDto(decisionBody, body ?? {});
    const barter = await getBarter(id);
    if (!barter) fail('Permuta não encontrada', HttpStatus.NOT_FOUND);
    if (!(await claimPendingBarter(id))) {
      fail('Esta permuta já foi decidida ou está sendo aprovada', HttpStatus.CONFLICT);
    }
    let applied: BarterApplied;
    try {
      applied = await mutate((db) => {
        assertTypes(db, barter.expenseTypeId, barter.donationTypeId);
        return applyBarter(db, barter, userId);
      });
    } catch (err) {
      await releaseBarter(id);
      if (err instanceof Error && !('getStatus' in err)) fail(err.message, HttpStatus.BAD_REQUEST);
      throw err;
    }
    return markBarterApproved(id, applied, userId, note ?? '');
  }

  async reject(id: string, body: unknown, userId: string) {
    const parsed = rejectBody.safeParse(body ?? {});
    if (!parsed.success) fail(firstIssue(parsed.error), HttpStatus.BAD_REQUEST);
    const barter = await getBarter(id);
    if (!barter) fail('Permuta não encontrada', HttpStatus.NOT_FOUND);
    if (!(await rejectPendingBarter(id, userId, parsed.data.note))) {
      fail('Esta permuta já foi decidida', HttpStatus.CONFLICT);
    }
    return getBarter(id);
  }
}
