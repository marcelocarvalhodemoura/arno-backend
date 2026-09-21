import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { getPool } from '../../src/shared/db';
import { isUuidV7 } from '../../src/shared/id';
import { verifyPassword } from '../../src/shared/auth/password';
import { rehashLegacySeedUsers } from '../../src/identity/users';
import { invalidateCache } from '../../src/shared/persistence/finance-store';
import { TEST_ADMIN_USER, TEST_PASSWORD, TEST_TREASURER_USER } from './credentials';

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;

const scryptAsync = promisify(scrypt);
const BCRYPT = /^\$2[aby]\$/;

async function passwordHashOf(username: string): Promise<string> {
  const result = await getPool().query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE username = $1',
    [username],
  );
  const hash = result.rows[0]?.password_hash;
  expect(hash).toBeDefined();
  return hash!;
}

async function login(user: string, password: string) {
  const res = await request(server).post('/api/auth/login').send({ user, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function tesoureiroAuth() {
  const token = await login(TEST_TREASURER_USER, TEST_PASSWORD);
  return { Authorization: `Bearer ${token}` };
}

async function ensureType(auth: { Authorization: string }, name: string, direction: 'income' | 'expense' | 'both') {
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

describe('API integration', () => {
  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health without auth', async () => {
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects invalid credentials', async () => {
    const res = await request(server).post('/api/auth/login').send({ user: 'admin', password: 'errada' });
    expect(res.status).toBe(401);
  });

  it('lets the tesoureiro use cash flow endpoints', async () => {
    const auth = await tesoureiroAuth();
    const incomeType = await ensureType(auth, 'Doação', 'income');
    const withPix = await request(server)
      .patch(`/api/movement-types/${incomeType.id}`)
      .set(auth)
      .send({ pixKey: '08.415.677/0001-00' });
    expect(withPix.status).toBe(200);
    expect(withPix.body.pixKey).toBe('08.415.677/0001-00');
    const withBranch = await request(server)
      .patch(`/api/movement-types/${incomeType.id}`)
      .set(auth)
      .send({ branch: 'escoteiro' });
    expect(withBranch.status).toBe(200);
    expect(withBranch.body.branch).toBe('escoteiro');

    const createdMember = await request(server)
      .post('/api/members')
      .set(auth)
      .send({
        name: 'Associado LTC Teste',
        email: `ltc.teste.${Date.now()}@arnofriedrich.org.br`,
        phone: '(51) 99999-0000',
        branch: 'escoteiro',
        role: 'jovem',
        monthlyFee: 60,
        joinedAt: '2026-08-01',
        clubeLtc: true,
        guardians: [
          {
            name: 'Maria Teste',
            relationship: 'Mãe',
            phone: '(51) 99999-0001',
            email: '',
          },
        ],
      });
    expect(createdMember.status).toBe(201);
    expect(createdMember.body.clubeLtc).toBe(true);
    expect(createdMember.body.monthlyFee).toBe(75);
    expect(createdMember.body.origin).toBe('manual');
    expect(isUuidV7(createdMember.body.id)).toBe(true);

    const listedAfterCreate = await request(server).get('/api/members').set(auth);
    const saved = listedAfterCreate.body.find((item: { id: string }) => item.id === createdMember.body.id);
    expect(saved.guardians).toHaveLength(1);
    expect(saved.guardians[0].name).toBe('Maria Teste');
    expect(saved.guardians[0].relationship).toBe('Mãe');

    const withoutGuardian = await request(server)
      .post('/api/members')
      .set(auth)
      .send({
        name: 'Jovem sem responsável',
        email: `sem.resp.${Date.now()}@arnofriedrich.org.br`,
        phone: '(51) 99999-0002',
        branch: 'escoteiro',
        role: 'jovem',
        monthlyFee: 60,
        joinedAt: '2026-08-01',
        clubeLtc: false,
      });
    expect(withoutGuardian.status).toBe(400);

    const patchedMember = await request(server).patch(`/api/members/${createdMember.body.id}`).set(auth).send({
      name: 'Associado LTC Alterado',
      phone: '(51) 98888-0000',
      monthlyFee: 75,
      branch: 'senior',
      clubeLtc: false,
    });
    expect(patchedMember.status).toBe(200);
    expect(patchedMember.body.name).toBe('Associado LTC Alterado');
    expect(patchedMember.body.phone).toBe('(51) 98888-0000');
    expect(patchedMember.body.monthlyFee).toBe(89.5);
    expect(patchedMember.body.branch).toBe('senior');
    expect(patchedMember.body.clubeLtc).toBe(false);
    expect(patchedMember.body.updatedAt).toBeTruthy();
    expect(patchedMember.body.updatedBy).toBeTruthy();
    expect(patchedMember.body.origin).toBe('manual');

    const listedAfterPatch = await request(server).get('/api/members').set(auth);
    const savedAfterPatch = listedAfterPatch.body.find((item: { id: string }) => item.id === createdMember.body.id);
    expect(savedAfterPatch.guardians).toHaveLength(1);
    expect(savedAfterPatch.guardians[0].name).toBe('Maria Teste');

    const renamedGuardian = await request(server)
      .patch(`/api/members/${createdMember.body.id}`)
      .set(auth)
      .send({
        guardians: [
          {
            id: savedAfterPatch.guardians[0].id,
            name: 'Maria Teste Alterada',
            relationship: 'Mãe',
            phone: '(51) 99999-0001',
            email: '',
          },
        ],
      });
    expect(renamedGuardian.status).toBe(200);
    const listedAfterRename = await request(server).get('/api/members').set(auth);
    const savedAfterRename = listedAfterRename.body.find((item: { id: string }) => item.id === createdMember.body.id);
    expect(savedAfterRename.guardians).toHaveLength(1);
    expect(savedAfterRename.guardians[0].id).toBe(savedAfterPatch.guardians[0].id);
    expect(savedAfterRename.guardians[0].name).toBe('Maria Teste Alterada');

    const duplicate = await request(server).post('/api/members').set(auth).send({
      name: 'Outro associado',
      email: createdMember.body.email,
      phone: '(51) 99999-1111',
      branch: 'escoteiro',
      role: 'jovem',
      monthlyFee: 60,
      joinedAt: '2026-08-01',
      clubeLtc: false,
    });
    expect(duplicate.status).toBe(409);

    const members = await request(server).get('/api/members').set(auth);
    expect(members.status).toBe(200);
    expect(members.body.length).toBeGreaterThan(0);
    expect(typeof members.body[0].clubeLtc).toBe('boolean');
    expect(isUuidV7(members.body[0].id)).toBe(true);

    const txs = await request(server).get('/api/transactions?from=2026-08-01&to=2026-08-31').set(auth);
    expect(txs.status).toBe(200);
    expect(Array.isArray(txs.body)).toBe(true);

    const flow = await request(server).get('/api/reports/cashflow?from=2026-08-01&to=2026-08-31').set(auth);
    expect(flow.status).toBe(200);
    expect(flow.body).toHaveProperty('opening');
    expect(flow.body).toHaveProperty('closing');

    const created = await request(server).post('/api/transactions').set(auth).send({
      date: '2026-08-28',
      type: 'income',
      nature: 'variable',
      movementTypeId: incomeType.id,
      description: 'Lançamento de teste de integração',
      amount: 12.5,
      branch: 'grupo',
      method: 'pix',
    });
    expect(created.status).toBe(201);
    expect(created.body.amount).toBe(12.5);
    expect(created.body.origin).toBe('manual');
    expect(created.body.paymentStatus).toBe('paid');
    expect(isUuidV7(created.body.id)).toBe(true);

    const pending = await request(server)
      .patch(`/api/transactions/${created.body.id}`)
      .set(auth)
      .send({ paymentStatus: 'pending' });
    expect(pending.status).toBe(200);
    expect(pending.body.paymentStatus).toBe('pending');

    const patched = await request(server)
      .patch(`/api/transactions/${created.body.id}`)
      .set(auth)
      .send({ description: 'Lançamento alterado no teste' });
    expect(patched.status).toBe(200);
    expect(patched.body.description).toBe('Lançamento alterado no teste');
    expect(patched.body.updatedAt).toBeTruthy();
    expect(patched.body.updatedBy).toBeTruthy();
    expect(patched.body.origin).toBe('manual');
  });

  it('lets tesoureiro split a credit and read settings', async () => {
    const auth = await tesoureiroAuth();
    const donation = await ensureType(auth, 'Doação', 'income');
    const camp = await ensureType(auth, 'Acampamento', 'income');
    const created = await request(server).post('/api/transactions').set(auth).send({
      date: '2026-09-18',
      type: 'income',
      nature: 'variable',
      movementTypeId: donation.id,
      description: 'Pix agrupado teste',
      amount: 150,
      branch: 'grupo',
      method: 'pix',
    });
    expect(created.status).toBe(201);

    const split = await request(server)
      .post(`/api/transactions/${created.body.id}/split`)
      .set(auth)
      .send({
        parts: [
          {
            amount: 60,
            movementTypeId: donation.id,
            description: 'Doação da parte 1',
          },
          {
            amount: 90,
            movementTypeId: camp.id,
            description: 'Acampamento da parte 2',
          },
        ],
      });
    expect(split.status).toBe(200);
    expect(split.body).toHaveLength(2);

    const settings = await request(server).get('/api/settings').set(auth);
    expect(settings.status).toBe(200);
    expect(settings.body.groupName).toBeTruthy();
    expect(settings.body.mensalidadeDueDay).toBe(10);

    const dueDay = await request(server).patch('/api/settings').set(auth).send({ mensalidadeDueDay: 15 });
    expect(dueDay.status).toBe(200);
    expect(dueDay.body.mensalidadeDueDay).toBe(15);

    const blocked = await request(server).patch('/api/settings').set(auth).send({ groupName: 'Não pode' });
    expect(blocked.status).toBe(403);

    const restore = await request(server).patch('/api/settings').set(auth).send({ mensalidadeDueDay: 10 });
    expect(restore.status).toBe(200);
    expect(restore.body.mensalidadeDueDay).toBe(10);

    const status = await request(server).get('/api/notify/status').set(auth);
    expect(status.status).toBe(200);
    expect(status.body.email).toBe(true);
  });

  it('lets tesoureiro manage fees', async () => {
    const auth = await tesoureiroAuth();

    const listed = await request(server).get('/api/fees').set(auth);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body)).toBe(true);

    const created = await request(server)
      .post('/api/fees')
      .set(auth)
      .send({ name: `Taxa integração ${Date.now()}`, amount: 32.5 });
    expect(created.status).toBe(201);
    expect(created.body.amount).toBe(32.5);
    expect(isUuidV7(created.body.id)).toBe(true);

    const patched = await request(server).patch(`/api/fees/${created.body.id}`).set(auth).send({ amount: 40 });
    expect(patched.status).toBe(200);
    expect(patched.body.amount).toBe(40);

    const removed = await request(server).delete(`/api/fees/${created.body.id}`).set(auth);
    expect(removed.status).toBe(204);
  });

  it('imports members and cash-flow rows as integration', async () => {
    const auth = await tesoureiroAuth();
    const donation = await ensureType(auth, 'Doação', 'income');
    const stamp = Date.now();
    const email = `import.${stamp}@arnofriedrich.org.br`;
    const row = {
      name: `Associado importado ${stamp}`,
      email,
      phone: '(51) 99999-2222',
      branch: 'escoteiro',
      role: 'jovem',
      monthlyFee: 60,
      joinedAt: '2026-03-01',
      clubeLtc: false,
    };

    const first = await request(server)
      .post('/api/integrations/members')
      .set(auth)
      .send({ rows: [row] });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(1);
    expect(first.body.skipped).toEqual([]);

    const listed = await request(server).get('/api/members').set(auth);
    const member = listed.body.find((item: { email: string }) => item.email === email);
    expect(member).toBeTruthy();
    expect(member.origin).toBe('integration');
    expect(isUuidV7(member.id)).toBe(true);

    const second = await request(server)
      .post('/api/integrations/members')
      .set(auth)
      .send({ rows: [row] });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(0);
    expect(second.body.skipped).toHaveLength(1);

    const description = `Doação importada ${stamp}`;
    const txRow = {
      date: '2026-08-14',
      type: 'income',
      nature: 'variable',
      movementTypeId: donation.id,
      description,
      amount: 150,
      branch: 'grupo',
      method: 'pix',
      paymentStatus: 'paid',
    };
    const createdTx = await request(server)
      .post('/api/integrations/transactions')
      .set(auth)
      .send({ rows: [txRow] });
    expect(createdTx.status).toBe(200);
    expect(createdTx.body.created).toBe(1);

    const txs = await request(server).get('/api/transactions?from=2026-08-01&to=2026-08-31').set(auth);
    const imported = txs.body.find((item: { description: string }) => item.description === description);
    expect(imported).toBeTruthy();
    expect(imported.origin).toBe('integration');
    expect(imported.amount).toBe(150);

    const skippedTx = await request(server)
      .post('/api/integrations/transactions')
      .set(auth)
      .send({ rows: [txRow] });
    expect(skippedTx.body.created).toBe(0);
    expect(skippedTx.body.skipped).toHaveLength(1);
  });

  it('interprets a bank statement into suggested cash-flow rows', async () => {
    const auth = await tesoureiroAuth();
    await ensureType(auth, 'Mensalidade', 'income');
    await ensureType(auth, 'Utilidades', 'expense');

    const members = await request(server).get('/api/members').set(auth);
    const ana = members.body.find((item: { name: string }) => item.name === 'Ana Souza');
    if (!ana) {
      const created = await request(server)
        .post('/api/members')
        .set(auth)
        .send({
          name: 'Ana Souza',
          email: 'ana.souza@arnofriedrich.org.br',
          phone: '(51) 99999-1001',
          branch: 'lobinho',
          role: 'jovem',
          monthlyFee: 55,
          joinedAt: '2023-03-11',
          clubeLtc: false,
          guardians: [
            {
              name: 'Helena Souza',
              relationship: 'Mãe',
              phone: '(51) 99999-1002',
              email: '',
            },
          ],
        });
      expect(created.status).toBe(201);
    }

    const res = await request(server)
      .post('/api/integrations/interpret-statement')
      .set(auth)
      .send({
        csv: `Data;Histórico;Valor
14/08/2026;PIX RECEBIDO ANA SOUZA MENSALIDADE;89,50
14/08/2026;PAGAMENTO ENERGISA SEDE;-90,00
14/08/2026;SALDO ANTERIOR;4000,00
`,
      });
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('bank');
    expect(res.body.rows).toHaveLength(2);
    const fee = res.body.rows.find((row: { amount: number }) => row.amount === 89.5);
    expect(fee.movementTypeName).toBe('Mensalidade');
    expect(fee.memberName).toBe('Ana Souza');
    expect(fee.type).toBe('income');
    const bill = res.body.rows.find((row: { amount: number }) => row.amount === 90);
    expect(bill.type).toBe('expense');
    expect(bill.movementTypeName).toBe('Utilidades');
  });

  it('reads a Sicredi PDF, matches the associate and marks pending mensalidade as paid', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = await tesoureiroAuth();
    const mensalidade = await ensureType(auth, 'Mensalidade', 'income');
    await ensureType(auth, 'Outros', 'both');

    const listedMember = await request(server).get('/api/members').set(auth);
    const existing = listedMember.body.find((item: { guardians?: { name: string }[] }) =>
      item.guardians?.some((guardian) => guardian.name === 'Joana Exemplo'),
    );
    let memberId = existing?.id as string | undefined;
    if (!memberId) {
      const created = await request(server)
        .post('/api/members')
        .set(auth)
        .send({
          name: 'Lucas Exemplo',
          email: `lucas.exemplo.${Date.now()}@arnofriedrich.org.br`,
          phone: '(51) 99999-3409',
          branch: 'escoteiro',
          role: 'jovem',
          monthlyFee: 60,
          joinedAt: '2025-03-01',
          clubeLtc: false,
          guardians: [
            {
              name: 'Joana Exemplo',
              relationship: 'Mãe',
              phone: '(51) 99999-3410',
              email: '',
            },
          ],
        });
      expect(created.status).toBe(201);
      memberId = created.body.id as string;
    }
    const savedLookup = await request(server).get('/api/members').set(auth);
    const savedMember = savedLookup.body.find((item: { id: string }) => item.id === memberId);
    const guardianId = savedMember.guardians[0].id as string;
    for (const extra of savedLookup.body) {
      if (
        extra.id !== memberId &&
        extra.guardians?.some((guardian: { name: string }) => guardian.name === 'Joana Exemplo') &&
        extra.status !== 'inactive'
      ) {
        await request(server).patch(`/api/members/${extra.id}`).set(auth).send({ status: 'inactive' });
      }
    }
    if (
      !savedMember.accounts?.some((account: { document?: string }) => String(account.document ?? '').includes('953'))
    ) {
      const account = await request(server).post(`/api/members/${memberId}/accounts`).set(auth).send({
        holderName: 'Joana Exemplo',
        holderKind: 'parent',
        relationship: 'Pai',
        document: '111.111.111-11',
        pixKey: '11111111111',
      });
      expect(account.status).toBe(201);
    }

    const pending = await request(server).post('/api/transactions').set(auth).send({
      date: '2026-01-10',
      type: 'income',
      nature: 'fixed',
      movementTypeId: mensalidade.id,
      description: 'Mensalidade janeiro Lucas',
      amount: 60,
      branch: 'escoteiro',
      method: 'pix',
      paymentStatus: 'pending',
      memberId,
      memberGuardianId: guardianId,
    });
    expect(pending.status).toBe(201);

    const pdf = readFileSync(join(process.cwd(), 'test/fixtures/extrato-exemplo.pdf'));
    const interpreted = await request(server)
      .post('/api/integrations/interpret-statement')
      .set(auth)
      .send({ pdf: pdf.toString('base64') });
    expect(interpreted.status).toBe(200);
    expect(interpreted.body.rows).toHaveLength(1);
    const row = interpreted.body.rows[0];
    expect(row.amount).toBe(60);
    expect(row.memberId).toBe(memberId);
    expect(row.movementTypeName).toBe('Mensalidade');
    expect(row.paymentStatus).toBe('paid');
    expect(row.hint).toMatch(/paga/i);

    const imported = await request(server)
      .post('/api/integrations/transactions')
      .set(auth)
      .send({
        rows: [
          {
            date: row.date,
            type: row.type,
            nature: row.nature,
            movementTypeId: row.movementTypeId,
            description: row.description,
            amount: row.amount,
            branch: row.branch,
            method: row.method,
            paymentStatus: row.paymentStatus,
            memberId: row.memberId,
            memberGuardianId: row.memberGuardianId,
          },
        ],
      });
    expect(imported.status).toBe(200);
    expect(imported.body.paid).toBe(1);
    expect(imported.body.created).toBe(0);

    const listed = await request(server).get('/api/transactions?from=2026-01-01&to=2026-01-31').set(auth);
    const saved = listed.body.find((item: { id: string }) => item.id === pending.body.id);
    expect(saved.paymentStatus).toBe('paid');
  });

  it('keeps admin-only pages away from the tesoureiro', async () => {
    const auth = await tesoureiroAuth();
    const res = await request(server).get('/api/users').set(auth);
    expect(res.status).toBe(403);
  });

  it('builds the March-December mensalidade grid and launches pending cash-flow rows', async () => {
    const auth = await tesoureiroAuth();
    const stamp = Date.now();
    const created = await request(server)
      .post('/api/members')
      .set(auth)
      .send({
        name: `Jovem Mensalidade ${stamp}`,
        email: `mensalidade.${stamp}@arnofriedrich.org.br`,
        phone: '(51) 99999-3333',
        branch: 'escoteiro',
        role: 'jovem',
        monthlyFee: 60,
        joinedAt: '2026-05-10',
        clubeLtc: false,
        guardians: [
          {
            name: 'Responsável Mensalidade',
            relationship: 'Mãe',
            phone: '(51) 99999-3334',
          },
        ],
      });
    expect(created.status).toBe(201);

    const first = await request(server).get('/api/mensalidades?year=2026').set(auth);
    expect(first.status).toBe(200);
    const row = first.body.rows.find((item: { memberId: string }) => item.memberId === created.body.id);
    expect(row.dueDay).toBe(10);
    expect(first.body.dueDay).toBe(10);
    expect(row.cells.find((cell: { month: number }) => cell.month === 3).status).toBe('none');
    expect(row.cells.find((cell: { month: number }) => cell.month === 5).dueDate).toBe('2026-05-10');
    expect(row.cells.filter((cell: { status: string }) => cell.status !== 'none')).toHaveLength(8);

    const again = await request(server).get('/api/mensalidades?year=2026').set(auth);
    expect(again.status).toBe(200);

    const listed = await request(server).get('/api/transactions?from=2026-05-01&to=2026-12-31').set(auth);
    const launched = listed.body.filter(
      (item: { memberId?: string; movementType?: { name: string } }) =>
        item.memberId === created.body.id && item.movementType?.name === 'Mensalidade',
    );
    expect(launched).toHaveLength(8);
    expect(launched.every((item: { paymentStatus: string }) => item.paymentStatus === 'pending')).toBe(true);

    const inactivated = await request(server)
      .patch(`/api/members/${created.body.id}`)
      .set(auth)
      .send({ status: 'inactive' });
    expect(inactivated.status).toBe(200);

    const afterLeave = await request(server).get('/api/mensalidades?year=2026').set(auth);
    const left = afterLeave.body.rows.find((item: { memberId: string }) => item.memberId === created.body.id);
    const now = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Sao_Paulo',
    });
    const currentMonth = Number(now.slice(0, 4)) === 2026 ? Number(now.slice(5, 7)) : 12;
    const nextChargedMonth = currentMonth >= 12 ? null : currentMonth + 1;
    if (nextChargedMonth && nextChargedMonth >= 5) {
      expect(left.cells.find((cell: { month: number }) => cell.month === nextChargedMonth)?.status).toBe('none');
    }

    const remaining = await request(server).get('/api/transactions?from=2026-05-01&to=2026-12-31').set(auth);
    const stillOpen = remaining.body.filter(
      (item: { memberId?: string; movementType?: { name: string } }) =>
        item.memberId === created.body.id && item.movementType?.name === 'Mensalidade',
    );
    expect(stillOpen.some((item: { date: string }) => item.date.slice(0, 7) > now.slice(0, 7))).toBe(false);
  });

  it('lets the admin read dashboard, users and projects', async () => {
    const token = await login(TEST_ADMIN_USER, TEST_PASSWORD);
    const auth = { Authorization: `Bearer ${token}` };

    const me = await request(server).get('/api/auth/me').set(auth);
    expect(me.body.role).toBe('admin');

    const dashboard = await request(server).get('/api/dashboard?year=2026&month=8').set(auth);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.byBranch.length).toBeGreaterThan(0);

    const users = await request(server).get('/api/users').set(auth);
    expect(users.status).toBe(200);
    expect(users.body.some((u: { username: string }) => u.username === 'admin')).toBe(true);
    expect(isUuidV7(users.body[0].id)).toBe(true);

    const mismatch = await request(server)
      .post('/api/users')
      .set(auth)
      .send({
        username: `conf.user.${Date.now()}`,
        name: 'Usuário Confirmação',
        email: `conf.${Date.now()}@arnofriedrich.org.br`,
        password: 'abcdef',
        passwordConfirm: 'abcdefg',
        role: 'tesoureiro',
      });
    expect(mismatch.status).toBe(400);

    const created = await request(server)
      .post('/api/users')
      .set(auth)
      .send({
        username: `conf.ok.${Date.now()}`,
        name: 'Usuário Confirmado',
        email: `conf.ok.${Date.now()}@arnofriedrich.org.br`,
        password: 'abcdef',
        passwordConfirm: 'abcdef',
        role: 'tesoureiro',
      });
    expect(created.status).toBe(201);

    const withoutCurrent = await request(server)
      .patch(`/api/users/${created.body.id}`)
      .set(auth)
      .send({ name: 'Sem confirmação' });
    expect(withoutCurrent.status).toBe(400);

    const wrongCurrent = await request(server)
      .patch(`/api/users/${created.body.id}`)
      .set(auth)
      .send({ name: 'Senha errada', currentPassword: 'nao-e-essa' });
    expect(wrongCurrent.status).toBe(403);

    const patched = await request(server).patch(`/api/users/${created.body.id}`).set(auth).send({
      name: 'Usuário Alterado',
      password: 'novasenha',
      passwordConfirm: 'novasenha',
      currentPassword: TEST_PASSWORD,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Usuário Alterado');

    const withNewPassword = await request(server)
      .post('/api/auth/login')
      .send({ user: created.body.username, password: 'novasenha' });
    expect(withNewPassword.status).toBe(200);

    const withEmail = await request(server)
      .post('/api/auth/login')
      .send({
        user: String(created.body.email).toUpperCase(),
        password: 'novasenha',
      });
    expect(withEmail.status).toBe(200);

    const withOldPassword = await request(server)
      .post('/api/auth/login')
      .send({ user: created.body.username, password: 'abcdef' });
    expect(withOldPassword.status).toBe(401);

    const deactivated = await request(server)
      .patch(`/api/users/${created.body.id}`)
      .set(auth)
      .send({ active: false, currentPassword: TEST_PASSWORD });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);

    const projects = await request(server).get('/api/projects?year=2026&branch=escoteiro').set(auth);
    expect(projects.status).toBe(200);

    const report = await request(server).post('/api/reports/custom').set(auth).send({
      from: '2026-08-01',
      to: '2026-08-31',
      branches: [],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: 'movementType',
    });
    expect(report.status).toBe(200);
    expect(report.body.ledger).toBeDefined();
  });

  it('stores passwords as bcrypt and upgrades the old scrypt hashes on login', async () => {
    const seeded = await passwordHashOf(TEST_TREASURER_USER);
    expect(seeded).toMatch(BCRYPT);

    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(TEST_PASSWORD, salt, 64)) as Buffer;
    const legacy = `${salt}:${derived.toString('hex')}`;
    await getPool().query('UPDATE users SET password_hash = $2 WHERE username = $1', [TEST_TREASURER_USER, legacy]);
    expect(await passwordHashOf(TEST_TREASURER_USER)).not.toMatch(BCRYPT);

    await login(TEST_TREASURER_USER, TEST_PASSWORD);

    const migrated = await passwordHashOf(TEST_TREASURER_USER);
    expect(migrated).toMatch(BCRYPT);
    expect(await verifyPassword(TEST_PASSWORD, migrated)).toBe(true);
  });

  it('syncs mock Sicredi Pix into cash flow and is idempotent', async () => {
    process.env.SICREDI_MOCK = '1';
    process.env.SICREDI_WEBHOOK_TOKEN = 'teste-webhook';
    await getPool().query("DELETE FROM transactions WHERE origin = 'sicredi' OR external_id IS NOT NULL");
    await getPool().query('TRUNCATE bank_movements, bank_sync_state');
    invalidateCache();
    const auth = await tesoureiroAuth();
    await ensureType(auth, 'Mensalidade', 'income');
    await ensureType(auth, 'A identificar', 'both');
    await ensureType(auth, 'Doação', 'income');

    const listedMember = await request(server).get('/api/members').set(auth);
    const existing = listedMember.body.find((item: { name: string }) => item.name === 'Ana Souza');
    let memberId = existing?.id as string | undefined;
    if (!memberId) {
      const created = await request(server)
        .post('/api/members')
        .set(auth)
        .send({
          name: 'Ana Souza',
          email: `ana.sicredi.${Date.now()}@arnofriedrich.org.br`,
          phone: '(51) 99999-1001',
          branch: 'lobinho',
          role: 'jovem',
          monthlyFee: 55,
          joinedAt: '2023-03-11',
          clubeLtc: false,
          guardians: [
            {
              name: 'Helena Souza',
              relationship: 'Mãe',
              phone: '(51) 99999-1002',
            },
          ],
        });
      expect(created.status).toBe(201);
      memberId = created.body.id as string;
    }

    const mensalidade = await ensureType(auth, 'Mensalidade', 'income');
    const pending = await request(server)
      .post('/api/transactions')
      .set(auth)
      .send({
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 8) + '01',
        type: 'income',
        nature: 'fixed',
        movementTypeId: mensalidade.id,
        description: 'Mensalidade Ana Souza',
        amount: 55,
        branch: 'lobinho',
        method: 'pix',
        paymentStatus: 'pending',
        memberId,
      });
    expect(pending.status).toBe(201);

    const status = await request(server).get('/api/integrations/sicredi').set(auth);
    expect(status.status).toBe(200);
    expect(status.body.configured).toBe(true);
    expect(status.body.mock).toBe(true);

    const sync = await request(server).post('/api/integrations/sicredi/sync').set(auth).send({});
    expect(sync.status).toBe(200);
    expect(sync.body.fetched).toBeGreaterThanOrEqual(2);
    expect(sync.body.paid + sync.body.created).toBeGreaterThan(0);
    expect(sync.body.movements.length).toBeGreaterThan(0);

    const again = await request(server).post('/api/integrations/sicredi/sync').set(auth).send({});
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(0);
    expect(again.body.paid).toBe(0);

    const denied = await request(server).post('/api/integrations/sicredi/webhook').send({ pix: [] });
    expect(denied.status).toBe(401);
    const webhook = await request(server)
      .post('/api/integrations/sicredi/webhook?token=teste-webhook')
      .send({ pix: [] });
    expect(webhook.status).toBe(200);

    delete process.env.SICREDI_MOCK;
    delete process.env.SICREDI_WEBHOOK_TOKEN;
  });

  it('validates and receives WhatsApp webhooks without auth', async () => {
    const previous = process.env.WHATSAPP_VERIFY_TOKEN;
    process.env.WHATSAPP_VERIFY_TOKEN = 'teste-whatsapp';

    const ready = await request(server).get('/webhook');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ ok: true, service: 'whatsapp-webhook' });

    const denied = await request(server).get('/webhook').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'errado',
      'hub.challenge': '12345',
    });
    expect(denied.status).toBe(403);

    const verified = await request(server).get('/webhook').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'teste-whatsapp',
      'hub.challenge': '12345',
    });
    expect(verified.status).toBe(200);
    expect(verified.text).toBe('12345');

    const verifiedApi = await request(server).get('/api/integrations/whatsapp/webhook').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'teste-whatsapp',
      'hub.challenge': 'abc',
    });
    expect(verifiedApi.status).toBe(200);
    expect(verifiedApi.text).toBe('abc');

    const event = await request(server)
      .post('/webhook')
      .send({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '123' },
                  contacts: [{ profile: { name: 'Helena' }, wa_id: '5551999991002' }],
                  messages: [
                    {
                      from: '5551999991002',
                      id: 'wamid.teste',
                      timestamp: '1726600000',
                      type: 'text',
                      text: { body: 'Oi' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
    expect(event.status).toBe(200);
    expect(event.text).toBe('EVENT_RECEIVED');

    const unknown = await request(server).post('/webhook').send({ object: 'page' });
    expect(unknown.status).toBe(404);

    if (previous === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
    else process.env.WHATSAPP_VERIFY_TOKEN = previous;
  });

  it('rehashes seed users to bcrypt on startup when ADMIN_PASSWORD is set', async () => {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(TEST_PASSWORD, salt, 64)) as Buffer;
    await getPool().query('UPDATE users SET password_hash = $2 WHERE username = ANY($1)', [
      [TEST_ADMIN_USER, TEST_TREASURER_USER],
      `${salt}:${derived.toString('hex')}`,
    ]);
    expect(await passwordHashOf(TEST_ADMIN_USER)).not.toMatch(BCRYPT);

    expect(await rehashLegacySeedUsers()).toBe(2);
    expect(await passwordHashOf(TEST_ADMIN_USER)).toMatch(BCRYPT);
    expect(await passwordHashOf(TEST_TREASURER_USER)).toMatch(BCRYPT);
    expect(await rehashLegacySeedUsers()).toBe(0);
  });

  it('enqueues bulk mensalidade charges and the outbox worker delivers them', async () => {
    const auth = await tesoureiroAuth();
    const stamp = Date.now();
    const email = `fila.${stamp}@arnofriedrich.org.br`;
    const created = await request(server)
      .post('/api/members')
      .set(auth)
      .send({
        name: `Jovem Fila ${stamp}`,
        email,
        phone: '(51) 98888-2222',
        branch: 'escoteiro',
        role: 'jovem',
        monthlyFee: 60,
        joinedAt: '2026-03-01',
        clubeLtc: false,
        guardians: [{ name: 'Mãe Fila', relationship: 'Mãe', phone: '(51) 98888-2223' }],
      });
    expect(created.status).toBe(201);

    const grid = await request(server).get('/api/mensalidades?year=2026').set(auth);
    const row = grid.body.rows.find((item: { memberId: string }) => item.memberId === created.body.id);
    const cell = row.cells.find((item: { month: number }) => item.month === 9);
    expect(cell?.transactionId).toBeTruthy();

    const notified = await request(server)
      .post('/api/mensalidades/notify')
      .set(auth)
      .send({
        year: 2026,
        month: 9,
        kind: 'charge',
        transactionIds: [cell.transactionId],
      });
    expect(notified.status).toBe(200);
    expect(notified.body.queued).toBeGreaterThan(0);

    const { processOutbox } = await import('../../src/notifications/outbox');
    await processOutbox();

    const log = await request(server).get('/api/notify/log?limit=40').set(auth);
    const ours = log.body.filter(
      (item: { to: string }) => String(item.to).includes(email) || String(item.to).includes('98888-2222'),
    );
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.every((item: { status: string }) => item.status === 'sent')).toBe(true);

    const status = await request(server).get('/api/notify/status').set(auth);
    expect(status.status).toBe(200);
    expect(typeof status.body.queued).toBe('number');
  });
});
