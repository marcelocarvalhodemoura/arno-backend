import { prisma } from '../shared/db';

export type AuditEventInput = {
  userId?: string | null;
  kind: 'page' | 'action' | 'login';
  method?: string | null;
  path: string;
  status?: number | null;
  durationMs?: number | null;
};

/** Registra sem atrasar a resposta; falha de auditoria nunca derruba a operação. */
export function recordAuditEvent(event: AuditEventInput): void {
  void prisma.auditEvent
    .create({
      data: {
        userId: event.userId ?? null,
        kind: event.kind,
        method: event.method ?? null,
        path: event.path.slice(0, 300),
        status: event.status ?? null,
        durationMs: event.durationMs ?? null,
      },
    })
    .catch(() => undefined);
}
