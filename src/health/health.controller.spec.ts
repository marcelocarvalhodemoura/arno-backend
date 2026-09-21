import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns service status', () => {
    const controller = new HealthController();
    expect(controller.health()).toEqual({ ok: true, service: 'arno-financeiro' });
  });
});
