/**
 * Normaliza nomes de associados/responsáveis/titulares para "Primeira Maiúscula".
 *
 * Uso (na pasta arno-backend):
 *   node --env-file=.env -r ts-node/register/transpile-only scripts/normalize-member-names.ts
 *   DATABASE_URL='postgres://...' node -r ts-node/register/transpile-only scripts/normalize-member-names.ts
 *
 * Depois, reinicie a API (ou chame um endpoint que faça mutate, ex. GET /api/members)
 * para o cache em memória refletir os nomes.
 */
import '../src/shared/env';
import { disconnectDb } from '../src/shared/db';
import { normalizeStoredMemberNames } from '../src/members/members';
import { mutate } from '../src/shared/persistence/finance-store';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/^[^@]+@/, '').replace(/\/.*$/, '') || '(sem DATABASE_URL)';
  console.log(`Normalizando nomes em ${host}…`);

  const result = await mutate((db) => normalizeStoredMemberNames(db));

  console.log(`OK — associados: ${result.members}, responsáveis: ${result.guardians}, contas: ${result.accounts}`);
  console.log('Reinicie a API (ou chame GET /api/members autenticado) para atualizar o cache.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
