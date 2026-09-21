import pg from 'pg';
import './env';

const { Pool, types } = pg;

types.setTypeParser(1082, (value) => value);
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);
types.setTypeParser(1700, (value) => Number.parseFloat(value));

let singleton: pg.Pool | undefined;

function createPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL não definida. Copie arno-backend/.env.example para arno-backend/.env (ou use application/.env) e preencha as credenciais do Postgres.',
    );
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
}

export function getPool(): pg.Pool {
  if (!singleton) singleton = createPool();
  return singleton;
}

/** Compatível com o domínio legado que importa `pool` diretamente. */
export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, property, receiver) {
    const instance = getPool() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export const DATABASE_URL = process.env.DATABASE_URL ?? '';

export async function waitForDb(retries = 30): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await getPool().query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      console.log(`Aguardando PostgreSQL (${i + 1}/${retries})…`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Não foi possível conectar ao PostgreSQL');
}
