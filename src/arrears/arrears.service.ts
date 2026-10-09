import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  applyArrearsCashPayment,
  cancelArrearsPlan,
  createArrearsPlan,
  generateArrearsDue,
  generateArrearsMonth,
  listArrears,
  listArrearsPayments,
  repairActiveEmbedSplits,
  settleArrearsPlan,
} from './arrears';
import { fail } from '../shared/http/api';
import { mutate } from '../shared/persistence/finance-store';

const createBody = z.object({
  memberId: z.string().min(1),
  amount: z.number().positive(),
  installments: z.number().int().min(2).max(12),
  startYearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  chargeMode: z.enum(['embed', 'separate']),
  note: z.string().max(500).optional(),
});

const yearMonthBody = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

const dueBody = z.object({
  monthLimit: z.string().regex(/^\d{4}-\d{2}$/),
});

const paymentBody = z.object({
  amount: z.number().positive(),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  method: z.enum(['pix', 'cash', 'transfer', 'card', 'other']).optional(),
  note: z.string().max(500).optional(),
});

const settleBody = z
  .object({
    recordPayment: z.boolean().optional(),
    paidAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    method: z.enum(['pix', 'cash', 'transfer', 'card', 'other']).optional(),
    note: z.string().max(500).optional(),
  })
  .optional();

@Injectable()
export class ArrearsService {
  async list(userId: string) {
    return mutate((db) => {
      // Corrige mensalidades legadas (valor somado sem rateio) ao abrir a tela de dívidas.
      repairActiveEmbedSplits(db, userId);
      return listArrears(db);
    });
  }

  async get(id: string) {
    return mutate((db) => listArrearsPayments(db, id));
  }

  async create(body: unknown, userId: string) {
    const parsed = createBody.safeParse(body);
    if (!parsed.success) {
      fail('Informe associado, valor, parcelas (2–12), competência inicial e modo de cobrança', HttpStatus.BAD_REQUEST);
    }
    return mutate((db) => createArrearsPlan(db, parsed.data, userId));
  }

  async cancel(id: string, userId: string) {
    return mutate((db) => cancelArrearsPlan(db, id, userId));
  }

  async settle(id: string, body: unknown, userId: string) {
    const parsed = settleBody.safeParse(body ?? {});
    if (!parsed.success) fail('Dados de quitação inválidos', HttpStatus.BAD_REQUEST);
    return mutate((db) => settleArrearsPlan(db, id, userId, parsed.data));
  }

  async pay(id: string, body: unknown, userId: string) {
    const parsed = paymentBody.safeParse(body);
    if (!parsed.success) fail('Informe o valor do pagamento', HttpStatus.BAD_REQUEST);
    return mutate((db) => applyArrearsCashPayment(db, id, parsed.data, userId));
  }

  async generateMonth(id: string, body: unknown, userId: string) {
    const parsed = yearMonthBody.safeParse(body);
    if (!parsed.success) fail('Informe a competência (YYYY-MM)', HttpStatus.BAD_REQUEST);
    return mutate((db) => generateArrearsMonth(db, id, parsed.data.yearMonth, userId));
  }

  async generateDue(id: string, body: unknown, userId: string) {
    const parsed = dueBody.safeParse(body);
    if (!parsed.success) fail('Informe o mês limite (YYYY-MM)', HttpStatus.BAD_REQUEST);
    return mutate((db) => {
      const created = generateArrearsDue(db, id, parsed.data.monthLimit, userId);
      return { created: created.length, items: created };
    });
  }
}
