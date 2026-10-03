import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { prisma } from '../shared/db';
import { fail } from '../shared/http/api';
import { listUsers } from '../identity/users';
import { recordAuditEvent } from './audit-store';
import { actionLabel, screenLabel } from './audit-labels';

const RETENTION_DAYS = 400;

@Injectable()
export class AuditService {
  page(body: unknown, userId: string) {
    const parsed = z.object({ path: z.string().min(1).max(200) }).safeParse(body);
    if (!parsed.success) fail('Informe a tela', HttpStatus.BAD_REQUEST);
    recordAuditEvent({ userId, kind: 'page', path: parsed.data.path });
    return { ok: true };
  }

  /** Visão de alto nível do uso do sistema no período (super admin). */
  async overview(daysQuery?: string) {
    const days = Math.min(365, Math.max(1, Number(daysQuery) || 30));
    const since = new Date(Date.now() - days * 86_400_000);
    await prisma.auditEvent.deleteMany({ where: { at: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } } });

    const [users, byUserKind, lastByUser, screens, actions, errors, daily, recent] = await Promise.all([
      listUsers(),
      prisma.auditEvent.groupBy({ by: ['userId', 'kind'], where: { at: { gte: since } }, _count: { _all: true } }),
      prisma.auditEvent.groupBy({ by: ['userId'], where: { at: { gte: since } }, _max: { at: true } }),
      prisma.auditEvent.groupBy({
        by: ['path'],
        where: { at: { gte: since }, kind: 'page' },
        _count: { _all: true },
      }),
      prisma.auditEvent.groupBy({
        by: ['method', 'path'],
        where: { at: { gte: since }, kind: 'action' },
        _count: { _all: true },
      }),
      prisma.auditEvent.count({ where: { at: { gte: since }, kind: 'action', status: { gte: 400 } } }),
      prisma.$queryRaw<{ day: Date; kind: string; total: bigint }[]>`
        SELECT date_trunc('day', "at" AT TIME ZONE 'America/Sao_Paulo') AS day, kind, count(*) AS total
        FROM audit_events WHERE "at" >= ${since}
        GROUP BY 1, 2 ORDER BY 1`,
      prisma.auditEvent.findMany({ where: { at: { gte: since } }, orderBy: { at: 'desc' }, take: 40 }),
    ]);

    const userName = new Map(users.map((user) => [user.id, user]));
    const perUser = new Map<string, { pages: number; actions: number; logins: number }>();
    for (const row of byUserKind) {
      if (!row.userId) continue;
      const entry = perUser.get(row.userId) ?? { pages: 0, actions: 0, logins: 0 };
      if (row.kind === 'page') entry.pages += row._count._all;
      else if (row.kind === 'action') entry.actions += row._count._all;
      else if (row.kind === 'login') entry.logins += row._count._all;
      perUser.set(row.userId, entry);
    }
    const lastSeen = new Map(lastByUser.map((row) => [row.userId, row._max.at]));

    const usage = users
      .map((user) => {
        const counts = perUser.get(user.id) ?? { pages: 0, actions: 0, logins: 0 };
        return {
          userId: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          ...counts,
          total: counts.pages + counts.actions,
          lastSeen: lastSeen.get(user.id)?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.total - a.total);

    const actionTotals = new Map<string, number>();
    for (const row of actions) {
      const label = actionLabel(row.method ?? '', row.path);
      actionTotals.set(label, (actionTotals.get(label) ?? 0) + row._count._all);
    }

    const series = new Map<string, { day: string; pages: number; actions: number; logins: number }>();
    for (const row of daily) {
      const day = new Date(row.day).toISOString().slice(0, 10);
      const entry = series.get(day) ?? { day, pages: 0, actions: 0, logins: 0 };
      const total = Number(row.total);
      if (row.kind === 'page') entry.pages += total;
      else if (row.kind === 'action') entry.actions += total;
      else entry.logins += total;
      series.set(day, entry);
    }

    const totals = usage.reduce(
      (acc, row) => ({
        pages: acc.pages + row.pages,
        actions: acc.actions + row.actions,
        logins: acc.logins + row.logins,
      }),
      { pages: 0, actions: 0, logins: 0 },
    );

    return {
      days,
      since: since.toISOString(),
      totals: { ...totals, activeUsers: usage.filter((row) => row.total > 0 || row.logins > 0).length, errors },
      users: usage,
      screens: screens
        .map((row) => ({ path: row.path, label: screenLabel(row.path), count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      actions: [...actionTotals.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      daily: [...series.values()],
      recent: recent.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        user: row.userId ? (userName.get(row.userId)?.name ?? 'Usuário removido') : 'Sem login',
        kind: row.kind,
        label:
          row.kind === 'page'
            ? `Abriu ${screenLabel(row.path)}`
            : row.kind === 'login'
              ? 'Entrou no sistema'
              : actionLabel(row.method ?? '', row.path),
        status: row.status,
      })),
    };
  }
}
