/**
 * Mede o tempo das escritas mais comuns. Só roda com BENCH=1 (yarn test:bench).
 * Serve de referência para comparar antes e depois de mudanças na persistência.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { prisma } from '../../src/shared/db';
import { invalidateCache } from '../../src/shared/persistence/finance-store';
import { TEST_PASSWORD, TEST_TREASURER_USER } from './credentials';

const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 20);
const run = process.env.BENCH ? describe : describe.skip;

function summarize(label: string, samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return `${label.padEnd(28)} média ${avg.toFixed(1)} ms · p50 ${pick(0.5).toFixed(1)} ms · p95 ${pick(0.95).toFixed(1)} ms`;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

run('Bench de escrita', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { description: { startsWith: 'Bench ' } } });
    invalidateCache();
    await app.close();
  });

  it('mede criar e editar lançamento', async () => {
    const login = await request(server)
      .post('/api/auth/login')
      .send({ user: TEST_TREASURER_USER, password: TEST_PASSWORD });
    const auth = { Authorization: `Bearer ${login.body.token as string}` };
    const types = await request(server).get('/api/movement-types').set(auth);
    const type = types.body.find(
      (item: { direction: string; active: boolean }) => item.active && item.direction !== 'expense',
    );

    const creates: number[] = [];
    const patches: number[] = [];
    const lists: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const [created, createMs] = await timed(() =>
        request(server)
          .post('/api/transactions')
          .set(auth)
          .send({
            date: '2033-09-10',
            type: 'income',
            nature: 'variable',
            movementTypeId: type.id,
            description: `Bench ${round}`,
            amount: 10 + round,
            branch: 'grupo',
            method: 'pix',
          }),
      );
      expect(created.status).toBe(201);
      creates.push(createMs);

      const [patched, patchMs] = await timed(() =>
        request(server)
          .patch(`/api/transactions/${created.body.id}`)
          .set(auth)
          .send({ amount: 20 + round }),
      );
      expect(patched.status).toBe(200);
      patches.push(patchMs);

      const [listed, listMs] = await timed(() =>
        request(server).get('/api/transactions?from=2033-09-01&to=2033-09-30').set(auth),
      );
      expect(listed.status).toBe(200);
      lists.push(listMs);
    }

    const counts = {
      transactions: await prisma.transaction.count(),
      members: await prisma.member.count(),
    };
    console.log(
      [
        `Bench (${ROUNDS} rodadas; ${counts.transactions} lançamentos, ${counts.members} associados no banco)`,
        summarize('POST /transactions', creates),
        summarize('PATCH /transactions/:id', patches),
        summarize('GET /transactions (mês)', lists),
      ].join('\n'),
    );
  });
});
