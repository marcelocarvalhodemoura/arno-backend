/**
 * Testes de caracterização: congelam o comportamento observável da API (status, mensagens e efeitos)
 * antes da refatoração da persistência e do domínio. Se um destes quebrar, o comportamento mudou.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { prisma } from '../../src/shared/db';
import { invalidateCache } from '../../src/shared/persistence/finance-store';
import { TEST_ADMIN_USER, TEST_PASSWORD, TEST_TREASURER_USER } from './credentials';

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
type Auth = { Authorization: string };

async function login(user: string): Promise<Auth> {
  const res = await request(server).post('/api/auth/login').send({ user, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.token as string}` };
}

async function ensureType(auth: Auth, name: string, direction: 'income' | 'expense' | 'both') {
  const listed = await request(server).get('/api/movement-types').set(auth);
  const existing = listed.body.find((item: { name: string }) => item.name === name);
  if (existing) return existing as { id: string; name: string };
  const created = await request(server)
    .post('/api/movement-types')
    .set(auth)
    .send({ name, direction, description: name });
  expect(created.status).toBe(201);
  return created.body as { id: string; name: string };
}

async function createMember(auth: Auth, name: string) {
  const res = await request(server)
    .post('/api/members')
    .set(auth)
    .send({
      name,
      email: `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@teste.org.br`,
      phone: '(51) 97777-0000',
      branch: 'escoteiro',
      role: 'jovem',
      monthlyFee: 60,
      joinedAt: '2026-01-01',
      clubeLtc: false,
      guardians: [{ name: `Resp ${name}`, relationship: 'Mãe', phone: '(51) 97777-0001', email: '' }],
    });
  expect(res.status).toBe(201);
  return res.body as { id: string; name: string };
}

function txBody(movementTypeId: string, overrides: Record<string, unknown> = {}) {
  return {
    date: '2033-05-10',
    type: 'income',
    nature: 'variable',
    movementTypeId,
    description: 'Caracterização',
    amount: 40,
    branch: 'grupo',
    method: 'pix',
    ...overrides,
  };
}

describe('Caracterização da API', () => {
  let auth: Auth;
  let admin: Auth;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    auth = await login(TEST_TREASURER_USER);
    admin = await login(TEST_ADMIN_USER);
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({
      where: { date: { gte: new Date('2033-01-01'), lt: new Date('2034-01-01') } },
    });
    await prisma.transaction.deleteMany({ where: { description: 'Caracterização' } });
    invalidateCache();
    await app.close();
  });

  describe('lançamentos', () => {
    it('recusa tipo inexistente, direção errada e corpo inválido com 400', async () => {
      const expenseOnly = await ensureType(auth, 'Caracterização Saída', 'expense');

      const unknownType = await request(server).post('/api/transactions').set(auth).send(txBody('nao-existe'));
      expect(unknownType.status).toBe(400);
      expect(unknownType.body.error).toBe('Tipo de movimentação inválido');

      const wrongDirection = await request(server).post('/api/transactions').set(auth).send(txBody(expenseOnly.id));
      expect(wrongDirection.status).toBe(400);
      expect(wrongDirection.body.error).toBe('Este tipo não aceita essa direção (entrada/saída)');

      const invalid = await request(server).post('/api/transactions').set(auth).send({ amount: 'x' });
      expect(invalid.status).toBe(400);
    });

    it('responde 404 para lançamento inexistente em editar, excluir e histórico vazio', async () => {
      const missing = '00000000-0000-7000-8000-000000000000';
      const patched = await request(server)
        .patch(`/api/transactions/${missing}`)
        .set(auth)
        .send({ description: 'Inexistente' });
      expect(patched.status).toBe(404);
      expect(patched.body.error).toBe('Lançamento não encontrado');

      const removed = await request(server).delete(`/api/transactions/${missing}`).set(auth);
      expect(removed.status).toBe(404);

      const history = await request(server).get(`/api/transactions/${missing}/history`).set(auth);
      expect(history.status).toBe(200);
      expect(history.body).toEqual([]);
    });

    it('carimba paidAt pela data do lançamento e limpa ao voltar para pendente', async () => {
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const created = await request(server).post('/api/transactions').set(auth).send(txBody(type.id));
      expect(created.status).toBe(201);
      expect(created.body.paymentStatus).toBe('paid');
      expect(created.body.paidAt).toBe('2033-05-10');
      expect(created.body.amount).toBe(40);

      const rounded = await request(server)
        .patch(`/api/transactions/${created.body.id}`)
        .set(auth)
        .send({ amount: 10.005 });
      expect(rounded.status).toBe(200);
      expect(rounded.body.amount).toBe(10.01);

      const pending = await request(server)
        .patch(`/api/transactions/${created.body.id}`)
        .set(auth)
        .send({ paymentStatus: 'pending' });
      expect(pending.body.paymentStatus).toBe('pending');
      expect(pending.body.paidAt).toBeUndefined();

      const paid = await request(server)
        .patch(`/api/transactions/${created.body.id}`)
        .set(auth)
        .send({ paymentStatus: 'paid', paidAt: '2033-05-12' });
      expect(paid.body.paidAt).toBe('2033-05-12');

      const history = await request(server).get(`/api/transactions/${created.body.id}/history`).set(auth);
      expect(history.body.map((row: { kind: string }) => row.kind)).toEqual([
        'updated',
        'updated',
        'updated',
        'created',
      ]);
    });

    it('lista com filtros e entrega tipo, associado e marcador de nota', async () => {
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const member = await createMember(auth, 'Caracterizacao Lista');
      const created = await request(server)
        .post('/api/transactions')
        .set(auth)
        .send(txBody(type.id, { date: '2033-06-02', memberId: member.id, branch: 'escoteiro', nature: 'fixed' }));
      expect(created.status).toBe(201);

      const listed = await request(server)
        .get('/api/transactions?from=2033-06-01&to=2033-06-30&branch=escoteiro&type=income&nature=fixed')
        .set(auth);
      expect(listed.status).toBe(200);
      const row = listed.body.find((item: { id: string }) => item.id === created.body.id);
      expect(row.movementType.id).toBe(type.id);
      expect(row.member.id).toBe(member.id);
      expect(row.hasNota).toBe(false);

      const otherBranch = await request(server)
        .get('/api/transactions?from=2033-06-01&to=2033-06-30&branch=lobinho')
        .set(auth);
      expect(otherBranch.body.some((item: { id: string }) => item.id === created.body.id)).toBe(false);
    });

    it('rateio exige soma igual ao total e pelo menos duas partes', async () => {
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const created = await request(server)
        .post('/api/transactions')
        .set(auth)
        .send(txBody(type.id, { amount: 100 }));

      const onePart = await request(server)
        .post(`/api/transactions/${created.body.id}/split`)
        .set(auth)
        .send({ parts: [{ amount: 100, movementTypeId: type.id, description: 'Uma parte' }] });
      expect(onePart.status).toBe(400);

      const wrongSum = await request(server)
        .post(`/api/transactions/${created.body.id}/split`)
        .set(auth)
        .send({
          parts: [
            { amount: 30, movementTypeId: type.id, description: 'Parte A' },
            { amount: 30, movementTypeId: type.id, description: 'Parte B' },
          ],
        });
      expect(wrongSum.status).toBe(400);

      const ok = await request(server)
        .post(`/api/transactions/${created.body.id}/split`)
        .set(auth)
        .send({
          parts: [
            { amount: 33.33, movementTypeId: type.id, description: 'Parte A' },
            { amount: 66.67, movementTypeId: type.id, description: 'Parte B' },
          ],
        });
      expect(ok.status).toBe(200);
      expect(ok.body).toHaveLength(2);
      const groups = new Set(ok.body.map((part: { splitGroupId: string }) => part.splitGroupId));
      expect(groups.size).toBe(1);
      expect(ok.body.map((part: { splitTotal: number }) => part.splitTotal)).toEqual([100, 100]);
    });
  });

  describe('notas', () => {
    it('responde 503 quando o S3 não está configurado', async () => {
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const created = await request(server).post('/api/transactions').set(auth).send(txBody(type.id));
      if (process.env.AWS_S3_BUCKET) return;
      const nota = await request(server).get(`/api/transactions/${created.body.id}/nota`).set(auth);
      expect(nota.status).toBe(503);
      const upload = await request(server)
        .post(`/api/transactions/${created.body.id}/nota`)
        .set(auth)
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'nota.pdf', contentType: 'application/pdf' });
      expect(upload.status).toBe(503);
    });
  });

  describe('governança', () => {
    it('reabrir mês que não está fechado responde 404; fechar mês inválido responde 400', async () => {
      const reopen = await request(server).delete('/api/month-closings/2033-02').set(admin);
      expect(reopen.status).toBe(404);
      expect(reopen.body.error).toMatch(/não está fechado/);

      const invalid = await request(server).post('/api/month-closings').set(auth).send({ yearMonth: '2033-2' });
      expect(invalid.status).toBe(400);

      const future = await request(server).post('/api/month-closings').set(auth).send({ yearMonth: '2033-02' });
      expect(future.status).toBe(400);
      expect(future.body.error).toBe('Só é possível fechar meses que já terminaram');
    });

    it('mês fechado bloqueia criar, excluir e mudar valor pago, mas aceita pendente', async () => {
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const paid = await request(server)
        .post('/api/transactions')
        .set(auth)
        .send(txBody(type.id, { date: '2024-02-05' }));
      const pending = await request(server)
        .post('/api/transactions')
        .set(auth)
        .send(txBody(type.id, { date: '2024-02-06', paymentStatus: 'pending' }));
      expect(paid.status).toBe(201);
      expect(pending.status).toBe(201);

      expect((await request(server).post('/api/month-closings').set(auth).send({ yearMonth: '2024-02' })).status).toBe(
        200,
      );
      try {
        const blockedCreate = await request(server)
          .post('/api/transactions')
          .set(auth)
          .send(txBody(type.id, { date: '2024-02-07' }));
        expect(blockedCreate.status).toBe(400);
        expect(blockedCreate.body.error).toMatch(/fechado/);

        const blockedDelete = await request(server).delete(`/api/transactions/${paid.body.id}`).set(auth);
        expect(blockedDelete.status).toBe(400);
        expect(blockedDelete.body.error).toMatch(/fechado/);

        const pendingEdit = await request(server)
          .patch(`/api/transactions/${pending.body.id}`)
          .set(auth)
          .send({ description: 'Pendente pode mudar' });
        expect(pendingEdit.status).toBe(200);
      } finally {
        expect((await request(server).delete('/api/month-closings/2024-02').set(admin)).status).toBe(200);
      }
    });

    it('esvaziar a lixeira é só do admin e remove os itens', async () => {
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const created = await request(server).post('/api/transactions').set(auth).send(txBody(type.id));
      const removed = await request(server).delete(`/api/transactions/${created.body.id}`).set(auth);
      expect(removed.status).toBe(200);

      expect((await request(server).delete('/api/trash').set(auth)).status).toBe(403);
      const emptied = await request(server).delete('/api/trash').set(admin);
      expect(emptied.status).toBe(200);
      expect(emptied.body.removed).toBeGreaterThanOrEqual(1);
      const trash = await request(server).get('/api/trash').set(auth);
      expect(trash.body).toEqual([]);

      const restore = await request(server).post(`/api/trash/${removed.body.trashId}/restore`).set(auth);
      expect(restore.status).toBe(404);
    });
  });

  describe('duplicados', () => {
    it('detecta, dispensa e resolve duplicados mandando as cópias para a lixeira', async () => {
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const body = txBody(type.id, { date: '2033-07-15', amount: 77.7, description: 'PIX DUPLICADO CARACTERIZACAO' });
      const first = await request(server).post('/api/transactions').set(auth).send(body);
      const second = await request(server).post('/api/transactions').set(auth).send(body);
      const third = await request(server).post('/api/transactions').set(auth).send(body);

      const found = await request(server).get('/api/duplicates').set(auth);
      expect(found.status).toBe(200);
      const group = JSON.stringify(found.body);
      expect(group).toContain(first.body.id);
      expect(group).toContain(second.body.id);

      const badDismiss = await request(server)
        .post('/api/duplicates/dismiss')
        .set(auth)
        .send({ ids: [first.body.id] });
      expect(badDismiss.status).toBe(400);

      const resolved = await request(server)
        .post('/api/duplicates/resolve')
        .set(auth)
        .send({ keepId: first.body.id, dropIds: [second.body.id, third.body.id] });
      expect(resolved.status).toBe(200);
      expect(resolved.body.trashed).toHaveLength(2);

      const listed = await request(server).get('/api/transactions?from=2033-07-01&to=2033-07-31').set(auth);
      const ids = listed.body.map((item: { id: string }) => item.id);
      expect(ids).toContain(first.body.id);
      expect(ids).not.toContain(second.body.id);
    });
  });

  describe('acordos de atrasados', () => {
    it('cria acordo separado, gera parcela, registra pagamento e recalcula o saldo', async () => {
      const member = await createMember(auth, 'Caracterizacao Acordo');

      const invalid = await request(server)
        .post('/api/arrears')
        .set(auth)
        .send({ memberId: member.id, amount: 300, installments: 1, startYearMonth: '2033-04', chargeMode: 'separate' });
      expect(invalid.status).toBe(400);

      const created = await request(server)
        .post('/api/arrears')
        .set(auth)
        .send({ memberId: member.id, amount: 300, installments: 3, startYearMonth: '2033-04', chargeMode: 'separate' });
      expect(created.status).toBe(201);
      const plan = created.body.plan ?? created.body;
      expect(plan.balance).toBe(300);
      expect(plan.installmentAmount).toBe(100);

      const month = await request(server)
        .post(`/api/arrears/${plan.id}/generate-month`)
        .set(auth)
        .send({ yearMonth: '2033-04' });
      expect(month.status).toBe(200);

      const listed = await request(server).get('/api/transactions?from=2033-04-01&to=2033-04-30').set(auth);
      const installment = listed.body.find((item: { arrearsId?: string }) => item.arrearsId === plan.id);
      expect(installment).toBeDefined();
      expect(installment.paymentStatus).toBe('pending');
      expect(installment.amount).toBe(100);

      const paidInstallment = await request(server)
        .patch(`/api/transactions/${installment.id}`)
        .set(auth)
        .send({ paymentStatus: 'paid', paidAt: '2033-04-10' });
      expect(paidInstallment.status).toBe(200);

      const afterInstallment = await request(server).get(`/api/arrears/${plan.id}`).set(auth);
      expect(afterInstallment.status).toBe(200);
      const planAfter = afterInstallment.body.plan ?? afterInstallment.body;
      expect(planAfter.balance).toBe(200);

      const payment = await request(server)
        .post(`/api/arrears/${plan.id}/payments`)
        .set(auth)
        .send({ amount: 50, paidAt: '2033-04-20', method: 'pix' });
      expect(payment.status).toBe(200);

      const afterPayment = await request(server).get(`/api/arrears/${plan.id}`).set(auth);
      expect((afterPayment.body.plan ?? afterPayment.body).balance).toBe(150);

      const settled = await request(server)
        .patch(`/api/arrears/${plan.id}/settle`)
        .set(auth)
        .send({ recordPayment: false });
      expect(settled.status).toBe(200);
      const afterSettle = await request(server).get(`/api/arrears/${plan.id}`).set(auth);
      expect((afterSettle.body.plan ?? afterSettle.body).balance).toBe(0);

      const missing = await request(server).get('/api/arrears/00000000-0000-7000-8000-000000000000').set(auth);
      expect(missing.status).toBe(404);
    });
  });

  describe('mensalidades', () => {
    it('quita uma mensalidade pendente e recusa corpo inválido ou id inexistente', async () => {
      const member = await createMember(auth, 'Caracterizacao Mensalidade');
      const generated = await request(server).post('/api/mensalidades/generate').set(auth).send({ year: 2033 });
      expect(generated.status).toBe(200);

      const listed = await request(server).get('/api/transactions?from=2033-03-01&to=2033-03-31').set(auth);
      const march = listed.body.find(
        (item: { memberId?: string; paymentStatus: string }) =>
          item.memberId === member.id && item.paymentStatus === 'pending',
      );
      expect(march).toBeDefined();

      const invalid = await request(server)
        .patch('/api/mensalidades/settle')
        .set(auth)
        .send({ transactionId: march.id });
      expect(invalid.status).toBe(400);

      const missing = await request(server)
        .patch('/api/mensalidades/settle')
        .set(auth)
        .send({ transactionId: '00000000-0000-7000-8000-000000000000', timing: 'on_time', notifyReceipt: false });
      expect(missing.status).toBe(404);

      const settled = await request(server)
        .patch('/api/mensalidades/settle')
        .set(auth)
        .send({ transactionId: march.id, timing: 'on_time', paidAt: '2033-03-08', notifyReceipt: false });
      expect(settled.status).toBe(200);
      expect(settled.body.paymentStatus).toBe('paid');
      expect(settled.body.paidAt).toBe('2033-03-08');

      const open = await request(server).get(`/api/mensalidades/open?memberId=${member.id}`).set(auth);
      expect(open.status).toBe(200);
      expect(
        open.body.some((item: { id?: string; transactionId?: string }) => (item.id ?? item.transactionId) === march.id),
      ).toBe(false);
    });
  });

  describe('integridade da gravação', () => {
    it('criar, anexar nota, excluir e restaurar lançamento não regrava as outras tabelas', async () => {
      // xmin muda quando a linha é regravada (TRUNCATE + INSERT); sem regravação, continua o mesmo.
      const versions = async () =>
        prisma.$queryRaw<{ table: string; xmin: string }[]>`
          SELECT 'members' AS table, min(xmin::text) AS xmin FROM members
          UNION ALL SELECT 'movement_types', min(xmin::text) FROM movement_types
          UNION ALL SELECT 'settings', min(xmin::text) FROM settings`;
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const before = await versions();

      const created = await request(server).post('/api/transactions').set(auth).send(txBody(type.id));
      expect(created.status).toBe(201);
      const removed = await request(server).delete(`/api/transactions/${created.body.id}`).set(auth);
      expect(removed.status).toBe(200);
      const restored = await request(server).post(`/api/trash/${removed.body.trashId}/restore`).set(auth);
      expect(restored.status).toBe(200);

      expect(await versions()).toEqual(before);
      const history = await request(server).get(`/api/transactions/${created.body.id}/history`).set(auth);
      expect(history.body.map((row: { kind: string }) => row.kind)).toEqual(['restored', 'deleted', 'created']);
    });

    it('uma escrita não apaga dados de outras tabelas', async () => {
      const before = {
        members: await prisma.member.count(),
        types: await prisma.movementType.count(),
        projects: await prisma.project.count(),
        guardians: await prisma.memberGuardian.count(),
        users: await prisma.user.count(),
      };
      const type = await ensureType(auth, 'Caracterização Entrada', 'income');
      const created = await request(server).post('/api/transactions').set(auth).send(txBody(type.id));
      expect(created.status).toBe(201);
      await request(server).patch(`/api/transactions/${created.body.id}`).set(auth).send({ amount: 41 });

      expect(await prisma.member.count()).toBe(before.members);
      expect(await prisma.movementType.count()).toBe(before.types);
      expect(await prisma.project.count()).toBe(before.projects);
      expect(await prisma.memberGuardian.count()).toBe(before.guardians);
      expect(await prisma.user.count()).toBe(before.users);
    });
  });
});
