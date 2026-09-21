import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../types';
import { ROLES_KEY } from './roles.decorator';
import type { AuthPayload } from './token';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest<{ auth?: AuthPayload }>();
    const auth = request.auth;
    if (!auth || !roles.includes(auth.role)) {
      throw new ForbiddenException({ error: 'Acesso restrito a este perfil' });
    }
    return true;
  }
}
