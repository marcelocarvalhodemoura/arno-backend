/**
 * Lista lançamentos duplicados — SÓ SIMULAÇÃO: não grava nem apaga nada no banco.
 * A remoção é feita pela tesouraria na tela de duplicados (as cópias vão para a lixeira).
 *
 * Uso (na pasta arno-backend, com as migrações em dia):
 *   yarn duplicates:check
 *   yarn duplicates:check --from 2026-10-01 --to 2026-10-31 --csv duplicados-outubro.csv
 *   DATABASE_URL='postgres://...' yarn duplicates:check --from 2026-10-01
 *
 * Duas buscas:
 * 1. Reimportação: crédito "A identificar" criado de novo para um Pix que já estava conciliado
 *    ou editado (data no vencimento, descrição reescrita). Era o defeito corrigido em a0dde85.
 * 2. Iguais: mesmo dia, valor, documento e histórico (a busca que a tela de duplicados já usa).
 */
import { writeFileSync } from 'node:fs';
import '../src/shared/env';
import { disconnectDb } from '../src/shared/db';
import { findDuplicateGroups } from '../src/ledger/duplicates';
import { loadDb } from '../src/shared/persistence/finance-store';
import { findReimportDuplicates } from '../src/statement/reimport-duplicates';
import type { DatabaseShape, Transaction } from '../src/shared/types';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type Line = { group: number; search: string; action: 'MANTER' | 'CÓPIA'; tx: Transaction };

function label(db: DatabaseShape, tx: Transaction): string {
  const type = db.movementTypes.find((item) => item.id === tx.movementTypeId)?.name ?? '?';
  const member = db.members.find((item) => item.id === tx.memberId)?.name;
  const paid = tx.paidAt && tx.paidAt !== tx.date ? ` (pago ${tx.paidAt})` : '';
  return [
    `${tx.date}${paid}`,
    type,
    `R$ ${(tx.splitTotal ?? tx.amount).toFixed(2)}`,
    tx.description.slice(0, 70),
    member ? `assoc. ${member}` : '',
    `criado ${tx.createdAt.slice(0, 16).replace('T', ' ')}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function main() {
  const from = arg('from');
  const to = arg('to');
  const csvPath = arg('csv');
  const host = (process.env.DATABASE_URL ?? '').replace(/^[^@]+@/, '').replace(/\/.*$/, '') || '(sem DATABASE_URL)';
  console.log(`SIMULAÇÃO em ${host} · período ${from ?? 'início'} a ${to ?? 'hoje'} · nada será alterado\n`);

  const db = await loadDb();
  const inRange = (tx: Transaction) => (!from || tx.date >= from) && (!to || tx.date <= to);
  const lines: Line[] = [];
  const listed = new Set<string>();
  let group = 0;

  for (const pair of findReimportDuplicates(db, { from, to })) {
    group += 1;
    lines.push({ group, search: 'reimportação', action: 'MANTER', tx: pair.keep });
    lines.push({ group, search: 'reimportação', action: 'CÓPIA', tx: pair.copy });
    listed.add(pair.copy.id);
  }
  const byId = new Map(db.transactions.map((tx) => [tx.id, tx]));
  for (const plan of findDuplicateGroups(db, new Set())) {
    const keep = byId.get(plan.keep.id);
    const copies = plan.drop.map((item) => byId.get(item.id)).filter((tx): tx is Transaction => Boolean(tx));
    const fresh = copies.filter((tx) => !listed.has(tx.id) && inRange(tx));
    if (!keep || !fresh.length) continue;
    group += 1;
    lines.push({ group, search: 'iguais', action: 'MANTER', tx: keep });
    for (const tx of fresh) {
      lines.push({ group, search: 'iguais', action: 'CÓPIA', tx });
      listed.add(tx.id);
    }
  }

  const copies = lines.filter((line) => line.action === 'CÓPIA');
  const total = copies.reduce((sum, line) => sum + line.tx.amount, 0);
  for (const search of ['reimportação', 'iguais']) {
    const ofSearch = lines.filter((line) => line.search === search);
    console.log(`== ${search}: ${new Set(ofSearch.map((line) => line.group)).size} grupo(s)`);
    for (const line of ofSearch) {
      console.log(`${line.action === 'MANTER' ? `#${line.group} MANTER` : '   CÓPIA '} ${label(db, line.tx)}`);
    }
    console.log('');
  }
  console.log(`Total: ${copies.length} cópia(s) · R$ ${total.toFixed(2)} contado(s) a mais no caixa.`);
  console.log('Confira cada grupo e resolva na tela de duplicados (a cópia vai para a lixeira).');

  if (csvPath) {
    const header = [
      'Grupo',
      'Busca',
      'Ação',
      'Id',
      'Data',
      'Pago em',
      'Tipo',
      'Valor',
      'Descrição',
      'Associado',
      'Criado em',
    ];
    const rows = lines.map((line) => [
      line.group,
      line.search,
      line.action,
      line.tx.id,
      line.tx.date,
      line.tx.paidAt ?? '',
      db.movementTypes.find((item) => item.id === line.tx.movementTypeId)?.name ?? '',
      (line.tx.splitTotal ?? line.tx.amount).toFixed(2).replace('.', ','),
      line.tx.description,
      db.members.find((item) => item.id === line.tx.memberId)?.name ?? '',
      line.tx.createdAt,
    ]);
    writeFileSync(csvPath, '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n'));
    console.log(`CSV salvo em ${csvPath}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
