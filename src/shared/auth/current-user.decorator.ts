import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthPayload } from './token';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthPayload => {
  const request = ctx.switchToHttp().getRequest<{ auth: AuthPayload }>();
  return request.auth;
});
