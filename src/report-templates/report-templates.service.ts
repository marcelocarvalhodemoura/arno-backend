import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../shared/db';
import { fail, parseDto } from '../shared/http/api';
import { branch, txType } from '../shared/http/schemas';
import { authorOf, usersById } from '../shared/http/presenters';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Período relativo (recalculado ao abrir o modelo) ou datas fixas. */
const period = z.union([
  z.object({ preset: z.enum(['month', 'prev', 'ytd', 's1', 's2', 'lastYear']) }),
  z.object({ from: isoDate, to: isoDate }).refine((value) => value.from <= value.to, 'Período inválido'),
]);

export const templateQuery = z.object({
  period,
  types: z.array(txType).default([]),
  groupBy: z.enum(['movementType', 'month', 'method', 'member', 'none']),
  branches: z.array(branch).default([]),
  movementTypeIds: z.array(z.string()).default([]),
  memberIds: z.array(z.string()).default([]),
  showLedger: z.boolean().default(false),
});

const name = z.string().trim().min(2, 'Dê um nome com pelo menos 2 letras').max(80);
const createBody = z.object({ name, query: templateQuery });
const updateBody = z.object({ name: name.optional(), query: templateQuery.optional() });

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isNotFound(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

async function assertNameFree(name: string, exceptId?: string) {
  const taken = await prisma.reportTemplate.findUnique({ where: { name }, select: { id: true } });
  if (taken && taken.id !== exceptId) fail(`Já existe um modelo chamado “${name}”`, HttpStatus.CONFLICT);
}

@Injectable()
export class ReportTemplatesService {
  async list() {
    const [rows, users] = await Promise.all([
      prisma.reportTemplate.findMany({ orderBy: { name: 'asc' } }),
      usersById(),
    ]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      query: row.query,
      createdAt: row.createdAt.toISOString(),
      createdByUser: authorOf(users, row.createdById ?? undefined),
      updatedAt: row.updatedAt?.toISOString() ?? null,
      updatedByUser: authorOf(users, row.updatedById ?? undefined),
    }));
  }

  async create(body: unknown, userId: string) {
    const data = parseDto(createBody, body);
    await assertNameFree(data.name);
    try {
      return await prisma.reportTemplate.create({
        data: { name: data.name, query: data.query as Prisma.InputJsonValue, createdById: userId },
      });
    } catch (error) {
      if (isUniqueViolation(error)) fail(`Já existe um modelo chamado “${data.name}”`, HttpStatus.CONFLICT);
      throw error;
    }
  }

  async update(id: string, body: unknown, userId: string) {
    const data = parseDto(updateBody, body);
    if (!(await prisma.reportTemplate.findUnique({ where: { id }, select: { id: true } }))) {
      fail('Modelo não encontrado', HttpStatus.NOT_FOUND);
    }
    if (data.name) await assertNameFree(data.name, id);
    try {
      return await prisma.reportTemplate.update({
        where: { id },
        data: {
          ...(data.name ? { name: data.name } : {}),
          ...(data.query ? { query: data.query as Prisma.InputJsonValue } : {}),
          updatedById: userId,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) fail(`Já existe um modelo chamado “${data.name}”`, HttpStatus.CONFLICT);
      if (isNotFound(error)) fail('Modelo não encontrado', HttpStatus.NOT_FOUND);
      throw error;
    }
  }

  async remove(id: string) {
    const { count } = await prisma.reportTemplate.deleteMany({ where: { id } });
    if (!count) fail('Modelo não encontrado', HttpStatus.NOT_FOUND);
    return { ok: true };
  }
}
