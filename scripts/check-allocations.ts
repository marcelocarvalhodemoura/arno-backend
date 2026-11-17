/**
 * Grava a divisão das mensalidades pagas que ainda não têm e mostra a Conferência do ano.
 * Uso: yarn allocations:check [ano]
 */
import { buildConference } from '../src/allocations/allocations';
import { disconnectDb } from '../src/shared/db';
import { backfillAllocations, invalidateCache, loadDb } from '../src/shared/persistence/finance-store';

async function main() {
  const year = Number(process.argv[2] ?? new Date().getFullYear());
  const result = await backfillAllocations();
  console.log(`Divisões gravadas/refeitas: ${result.computed} · removidas: ${result.removed}`);
  invalidateCache();
  const report = buildConference(await loadDb(), year);
  console.log(`\nConferência ${year}`);
  console.table({ total: report.totals, ...Object.fromEntries(report.byBranch.map((row) => [row.memberBranch, row])) });
  console.log('Pontos de atenção:', report.counts);
  for (const issue of report.issues.slice(0, 40)) {
    console.log(
      `- [${issue.kind}] ${issue.date} ${issue.memberName ?? '(sem associado)'} R$ ${issue.amount}: ${issue.message}`,
    );
  }
  if (report.issues.length > 40) console.log(`… e mais ${report.issues.length - 40}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
