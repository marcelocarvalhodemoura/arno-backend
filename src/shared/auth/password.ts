import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import bcrypt from "bcrypt";

const scryptAsync = promisify(scrypt);

const ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isLegacyHash(stored)) return verifyLegacyPassword(password, stored);
  return bcrypt.compare(password, stored);
}

/**
 * Antes do bcrypt as senhas eram derivadas com scrypt e guardadas como
 * `salt:hash`. Hashes bcrypt começam com $2a$, $2b$ ou $2y$, então o prefixo
 * distingue os dois formatos e o login consegue migrar os antigos.
 */
export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith("$2");
}

async function verifyLegacyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
