import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';
import { issueToken } from './token';

function httpContext(headers: Record<string, string>, handlerMeta?: Record<string, unknown>): ExecutionContext {
  const request: { headers: Record<string, string>; auth?: unknown } = {
    headers,
  };
  return {
    getHandler: () => handlerMeta ?? {},
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new JwtAuthGuard(reflector);

  beforeEach(() => {
    (reflector.getAllAndOverride as jest.Mock).mockReset();
  });

  it('allows public routes without a token', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) => key === IS_PUBLIC_KEY);
    expect(guard.canActivate(httpContext({}))).toBe(true);
  });

  it('rejects missing or invalid tokens', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    expect(() => guard.canActivate(httpContext({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(httpContext({ authorization: 'Bearer x.y' }))).toThrow(UnauthorizedException);
  });

  it('attaches the payload when the token is valid', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const token = issueToken('admin', 'u1', 'admin');
    const ctx = httpContext({ authorization: `Bearer ${token}` });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx.switchToHttp().getRequest().auth).toMatchObject({
      user: 'admin',
      userId: 'u1',
      role: 'admin',
    });
  });
});

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  beforeEach(() => {
    (reflector.getAllAndOverride as jest.Mock).mockReset();
  });

  it('allows when no role is required', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const ctx = httpContext({});
    ctx.switchToHttp().getRequest().auth = {
      user: 't',
      userId: '1',
      role: 'tesoureiro',
      exp: 1,
    };
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks tesoureiro from admin routes', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
      key === ROLES_KEY ? ['admin'] : undefined,
    );
    const ctx = httpContext({});
    ctx.switchToHttp().getRequest().auth = {
      user: 't',
      userId: '1',
      role: 'tesoureiro',
      exp: 1,
    };
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
