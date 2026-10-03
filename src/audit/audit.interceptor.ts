import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import type { AuthPayload } from '../shared/auth/token';
import { recordAuditEvent } from './audit-store';

type Req = { method: string; path: string; baseUrl?: string; route?: { path?: string }; auth?: AuthPayload };

/** Registra toda ação que grava (POST/PATCH/PUT/DELETE) de usuário autenticado. Leituras não entram. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Req>();
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || !req.auth) return next.handle();
    const route = `${req.baseUrl ?? ''}${req.route?.path ?? ''}` || req.path;
    if (route.startsWith('/api/audit')) return next.handle();
    const started = Date.now();
    const log = (status: number) =>
      recordAuditEvent({
        userId: req.auth?.userId,
        kind: 'action',
        method: req.method,
        path: route,
        status,
        durationMs: Date.now() - started,
      });
    return next.handle().pipe(
      tap(() => log(res.statusCode)),
      catchError((error: { status?: number; getStatus?: () => number }) => {
        log(error?.getStatus?.() ?? error?.status ?? 500);
        return throwError(() => error);
      }),
    );
  }
}
