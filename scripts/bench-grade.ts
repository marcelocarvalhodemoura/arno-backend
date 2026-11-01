/** Cronometra a leitura da grade de mensalidades num banco sintético do tamanho do de produção. */
import { buildMensalidadeReport, syncMensalidades } from '../src/mensalidades/mensalidades';
import type { DatabaseShape, Member } from '../src/shared/types';

const BRANCHES = ['lobinho', 'escoteiro', 'senior', 'pioneiro'] as const;
const members: Member[] = Array.from({ length: 120 }, (_, i) => ({
  id: `m${i}`,
  name: `Associado ${i}`,
  email: '',
  phone: '',
  branch: BRANCHES[i % 4],
  role: 'jovem',
  monthlyFee: 75,
  status: 'active',
  clubeLtc: i % 5 === 0,
  joinedAt: '2025-01-01',
  origin: 'manual',
  createdAt: '2025-01-01T00:00:00.000Z',
}));
const db: DatabaseShape = {
  members,
  memberGuardians: [],
  memberSiblings: [],
  memberAccounts: [],
  movementTypes: [
    {
      id: 'outro',
      name: 'Acampamento',
      direction: 'both',
      description: '',
      pixKey: '',
      branch: 'grupo',
      active: true,
      origin: 'manual',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ],
  fees: [],
  projects: [],
  transactions: [],
  settings: { openingBalance: 0, groupName: 'Arno', mensalidadeDueDay: 10 },
};
syncMensalidades(db, 2026, 'u', '2026-11-01');
// Paga ~70% das cobranças e acrescenta lançamentos avulsos para chegar perto de 2 mil.
db.transactions.forEach((tx, i) => {
  if (i % 10 < 7) Object.assign(tx, { paymentStatus: 'paid', paidAt: tx.date });
});
for (let i = 0; i < 900; i++) {
  db.transactions.push({
    id: `x${i}`,
    date: `2026-${String(3 + (i % 9)).padStart(2, '0')}-15`,
    type: i % 2 ? 'income' : 'expense',
    nature: 'variable',
    movementTypeId: 'outro',
    description: `Avulso ${i}`,
    amount: 50,
    branch: 'grupo',
    method: 'pix',
    paymentStatus: 'paid',
    origin: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
}
console.log('lançamentos', db.transactions.length);

function time(label: string, fn: () => unknown, runs = 5) {
  fn();
  const t = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  console.log(label.padEnd(28), (Number(process.hrtime.bigint() - t) / 1e6 / runs).toFixed(1), 'ms');
}
time('structuredClone', () => structuredClone(db));
time('JSON.stringify x2', () => (JSON.stringify(db), JSON.stringify(db)));
time('syncMensalidades', () => syncMensalidades(structuredClone(db), 2026, 'u', '2026-11-01'));
time('buildMensalidadeReport', () => buildMensalidadeReport(db, 2026, '2026-11-01'));
