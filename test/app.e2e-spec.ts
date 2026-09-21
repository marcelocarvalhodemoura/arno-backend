import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app';
import { TEST_ADMIN_USER, TEST_PASSWORD, TEST_TREASURER_USER } from './integration/credentials';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health is public', async () => {
    await request(server).get('/api/health').expect(200).expect({ ok: true, service: 'arno-financeiro' });
  });

  it('GET /api/auth/me rejects missing token', async () => {
    await request(server).get('/api/auth/me').expect(401).expect({ error: 'Não autorizado' });
  });

  it('POST /api/auth/login rejects empty body', async () => {
    await request(server).post('/api/auth/login').send({}).expect(400);
  });

  it('GET /api/docs serves Swagger UI', async () => {
    const res = await request(server).get('/api/docs').redirects(1);
    expect(res.status).toBe(200);
    expect(res.text.toLowerCase()).toContain('swagger');
  });

  it('GET /api/docs-json describes the API', async () => {
    const res = await request(server).get('/api/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3/);
    expect(res.body.info.title).toBe('Tesouraria Arno');
    expect(res.body.paths['/api/health']).toBeDefined();
    expect(res.body.paths['/api/auth/login']).toBeDefined();
    expect(res.body.paths['/api/members']).toBeDefined();
  });
});

describe('Tesoureiro journey (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let auth: { Authorization: string };

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    const login = await request(server)
      .post('/api/auth/login')
      .send({ user: TEST_TREASURER_USER, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    auth = { Authorization: `Bearer ${login.body.token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('covers catalog, member, cash flow, import map and mensalidades', async () => {
    const meta = await request(server).get('/api/meta').set(auth);
    expect(meta.status).toBe(200);
    expect(meta.body.allBranches).toContain('grupo');

    const settings = await request(server).get('/api/settings').set(auth);
    expect(settings.status).toBe(200);

    const stamp = Date.now();
    const type = await request(server)
      .post('/api/movement-types')
      .set(auth)
      .send({
        name: `E2E Tipo ${stamp}`,
        direction: 'both',
        description: 'e2e',
      });
    expect(type.status).toBe(201);

    const member = await request(server)
      .post('/api/members')
      .set(auth)
      .send({
        name: `Jovem E2E ${stamp}`,
        email: `e2e.${stamp}@arnofriedrich.org.br`,
        phone: '51999990000',
        branch: 'escoteiro',
        role: 'jovem',
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe E2E', relationship: 'Mãe', phone: '51988880000' }],
      });
    expect(member.status).toBe(201);

    const account = await request(server).post(`/api/members/${member.body.id}/accounts`).set(auth).send({
      holderName: 'Mãe E2E',
      holderKind: 'parent',
      relationship: 'Mãe',
      pixKey: '51988880000',
      document: '12345678900',
      isPrimary: true,
    });
    expect(account.status).toBe(201);

    const tx = await request(server)
      .post('/api/transactions')
      .set(auth)
      .send({
        date: '2026-06-10',
        type: 'income',
        nature: 'variable',
        movementTypeId: type.body.id,
        description: `Pix e2e ${stamp}`,
        amount: 40,
        branch: 'escoteiro',
        method: 'pix',
        memberId: member.body.id,
      });
    expect(tx.status).toBe(201);

    const listed = await request(server).get('/api/transactions?from=2026-06-01&to=2026-06-30').set(auth);
    expect(listed.body.some((item: { id: string }) => item.id === tx.body.id)).toBe(true);

    const mapped = await request(server).post('/api/integrations/map-import').set(auth).send({
      kind: 'statement',
      csv: `Dt. Lançamento;Histórico do Lançamento;Valor R$\n10/06/2026;PIX RECEBIDO TESTE;40,00\n`,
    });
    expect(mapped.status).toBe(200);
    expect(mapped.body.mapping.date).toBeTruthy();

    const flow = await request(server).get('/api/reports/cashflow?from=2026-06-01&to=2026-06-30').set(auth);
    expect(flow.status).toBe(200);

    const grid = await request(server).get('/api/mensalidades?year=2026').set(auth);
    expect(grid.status).toBe(200);
    expect(grid.body.rows.some((row: { memberId: string }) => row.memberId === member.body.id)).toBe(true);

    const removed = await request(server).delete(`/api/transactions/${tx.body.id}`).set(auth);
    expect(removed.status).toBe(204);

    const users = await request(server).get('/api/users').set(auth);
    expect(users.status).toBe(403);
  });
});

describe('Admin journey (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let auth: { Authorization: string };

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    const login = await request(server)
      .post('/api/auth/login')
      .send({ user: TEST_ADMIN_USER, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    auth = { Authorization: `Bearer ${login.body.token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads dashboard, manages a project and custom report, and can rename the group', async () => {
    const me = await request(server).get('/api/auth/me').set(auth);
    expect(me.body.role).toBe('admin');

    const dashboard = await request(server).get('/api/dashboard?year=2026&month=6').set(auth);
    expect(dashboard.status).toBe(200);

    const created = await request(server)
      .post('/api/projects')
      .set(auth)
      .send({
        branch: 'grupo',
        year: 2026,
        name: `Projeto E2E ${Date.now()}`,
        description: 'Orçamento de teste e2e',
        items: [{ category: 'Sede', description: 'Aluguel', planned: 100 }],
      });
    expect(created.status).toBe(201);

    const patched = await request(server)
      .patch(`/api/projects/${created.body.id}`)
      .set(auth)
      .send({ description: 'Orçamento revisado no e2e' });
    expect(patched.status).toBe(200);

    const listed = await request(server).get('/api/projects?year=2026').set(auth);
    expect(listed.status).toBe(200);

    const report = await request(server).post('/api/reports/custom').set(auth).send({
      from: '2026-01-01',
      to: '2026-12-31',
      branches: [],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: 'month',
    });
    expect(report.status).toBe(200);
    expect(report.body.ledger).toBeDefined();

    const settings = await request(server).get('/api/settings').set(auth);
    const renamed = await request(server).patch('/api/settings').set(auth).send({ groupName: settings.body.groupName });
    expect(renamed.status).toBe(200);
  });
});
