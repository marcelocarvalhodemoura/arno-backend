import { Test } from '@nestjs/testing';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

describe('IdentityController', () => {
  const identity = {
    login: jest.fn(),
    me: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    reset: jest.fn(),
  };
  let controller: IdentityController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [{ provide: IdentityService, useValue: identity }],
    }).compile();
    controller = moduleRef.get(IdentityController);
  });

  it('delegates login, me, users and reset', async () => {
    identity.login.mockResolvedValue({ token: 't' });
    identity.me.mockReturnValue({ user: 'admin', role: 'admin', userId: '1' });
    identity.list.mockResolvedValue([]);
    identity.create.mockResolvedValue({ id: '1' });
    identity.update.mockResolvedValue({ id: '1', name: 'X' });
    identity.reset.mockResolvedValue({ members: [] });
    const auth = { user: 'admin', userId: '1', role: 'admin' as const, exp: 1 };

    await expect(controller.login({ user: 'admin', password: 'x' })).resolves.toEqual({ token: 't' });
    expect(controller.me(auth)).toEqual({
      user: 'admin',
      role: 'admin',
      userId: '1',
    });
    await expect(controller.list()).resolves.toEqual([]);
    await expect(controller.create({ username: 'a' }, auth)).resolves.toEqual({
      id: '1',
    });
    await expect(controller.update('1', { name: 'X' }, auth)).resolves.toEqual({
      id: '1',
      name: 'X',
    });
    await expect(controller.reset()).resolves.toEqual({ members: [] });
  });
});
