import { AppConfig, DEFAULT_AUTH_SECRET } from './config';

describe('AppConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('lê o ambiente na hora', () => {
    const config = new AppConfig();
    process.env.MAIL_QUEUE_CONCURRENCY = '7';
    expect(config.outbox.concurrency).toBe(7);
    delete process.env.MAIL_QUEUE_CONCURRENCY;
    expect(config.outbox.concurrency).toBe(3);
  });

  it('liga o mock do WhatsApp com WHATSAPP_MOCK ou MAIL_MOCK', () => {
    const config = new AppConfig();
    delete process.env.WHATSAPP_MOCK;
    process.env.MAIL_MOCK = '1';
    expect(config.whatsapp.mock).toBe(true);
    process.env.MAIL_MOCK = '0';
    expect(config.whatsapp.mock).toBe(false);
  });

  it('separa listas por vírgula e tira barra final das URLs', () => {
    const config = new AppConfig();
    process.env.SUPERADMIN_USERS = ' ana, bruno ,,';
    process.env.PUBLIC_URL = 'https://api.exemplo.org/';
    expect(config.admin.superadminUsers).toEqual(['ana', 'bruno']);
    expect(config.publicUrl).toBe('https://api.exemplo.org');
  });

  it('avisa quando falta AUTH_SECRET em produção', () => {
    const config = new AppConfig();
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    expect(config.authSecret).toBe(DEFAULT_AUTH_SECRET);
    expect(config.warnings()).toEqual(expect.arrayContaining([expect.stringContaining('AUTH_SECRET')]));
  });
});
