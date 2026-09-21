import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { issueToken, verifyToken } from './token';
import { hashPassword, isLegacyHash, verifyPassword } from './password';

const scryptAsync = promisify(scrypt);

async function legacyScryptHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

describe('auth tokens', () => {
  it('issues a token that can be verified', () => {
    const token = issueToken('admin', '01900000-0000-7000-8000-000000000001', 'admin');
    const payload = verifyToken(token);
    expect(payload?.user).toBe('admin');
    expect(payload?.role).toBe('admin');
    expect(payload?.userId).toBe('01900000-0000-7000-8000-000000000001');
  });

  it('rejects a tampered token', () => {
    const token = issueToken('admin', '01900000-0000-7000-8000-000000000001', 'admin');
    expect(verifyToken(`${token}x`)).toBeNull();
    expect(verifyToken('not-a-token')).toBeNull();
  });
});

describe('passwords', () => {
  it('hashes with bcrypt and verifies a password', async () => {
    const stored = await hashPassword('senha-de-teste');
    expect(stored).toMatch(/^\$2[aby]\$12\$/);
    expect(stored).not.toContain('senha-de-teste');
    expect(isLegacyHash(stored)).toBe(false);
    expect(await verifyPassword('senha-de-teste', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('never repeats the hash of the same password', async () => {
    const [first, second] = await Promise.all([hashPassword('senha-de-teste'), hashPassword('senha-de-teste')]);
    expect(first).not.toBe(second);
  });

  it('still verifies the scrypt hashes stored before the switch', async () => {
    const legacy = await legacyScryptHash('senha-de-teste');
    expect(isLegacyHash(legacy)).toBe(true);
    expect(await verifyPassword('senha-de-teste', legacy)).toBe(true);
    expect(await verifyPassword('wrong', legacy)).toBe(false);
  });
});
