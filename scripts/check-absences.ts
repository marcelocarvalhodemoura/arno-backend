/**
 * Levantamento (somente leitura) dos casos afetados por desligamento/retorno de associados.
 * Não grava nada no banco.
 *
 * Uso: yarn absences:check [mesesEmAberto=3]
 *
 * 1. Cobranças em meses em que o associado estava fora (recriadas ao reativar ou pagas durante a ausência).
 * 2. Associados reativados (saíram e voltaram) — conferir o período fora.
 * 3. Inativos sem histórico de situação (inativados antes de 14/10/2026): se voltarem, o sistema não sabe
 *    em quais meses estiveram fora.
 * 4. Ativos com N ou mais mensalidades seguidas em aberto até hoje — possíveis desligamentos não registrados,
 *    incluindo cliques no botão antigo de desativar, que não tinha efeito.
 */
import { paysMensalidade } from '../src/mensalidades/fee-table';
import {
  absentMonthsIndex,
  isMensalidadeTx,
  MENSALIDADE_MONTHS,
  statusEffectiveDate,
  todayISO,
} from '../src/mensalidades/mensalidades';
import { disconnectDb } from '../src/shared/db';
import { loadDb } from '../src/shared/persistence/finance-store';
import type { Transaction } from '../src/shared/types';

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`;
const ymLabel = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

async function main() {
  const threshold = Number(process.argv[2] ?? 3);
  const today = todayISO();
  const db = await loadDb();
  const isAbsent = absentMonthsIndex(db);
  const history = db.memberStatusHistory ?? [];
  const byId = new Map(db.members.map((member) => [member.id, member]));
  const mensalidades = db.transactions.filter((tx) => tx.memberId && isMensalidadeTx(db, tx));

  console.log(`Levantamento de desligamentos/retornos — ${today}`);
  console.log(
    `Associados: ${db.members.length} (${db.members.filter((m) => m.status === 'inactive').length} inativos) · ` +
      `registros de histórico de situação: ${history.length} · mensalidades: ${mensalidades.length}`,
  );

  // 1. Cobranças em meses de ausência.
  const inAbsence = mensalidades.filter((tx) => isAbsent(tx.memberId!, tx.date.slice(0, 7)));
  const pending = inAbsence.filter((tx) => tx.paymentStatus !== 'paid');
  const paid = inAbsence.filter((tx) => tx.paymentStatus === 'paid');
  const printTx = (tx: Transaction) =>
    console.log(
      `  - ${byId.get(tx.memberId!)?.name ?? tx.memberId} · ${ymLabel(tx.date.slice(0, 7))} · ${brl(tx.amount)}` +
        (tx.paidAt ? ` · pago em ${tx.paidAt.slice(0, 10)}` : '') +
        ` · id ${tx.id}`,
    );
  console.log(`\n1) Cobranças PENDENTES em meses em que o associado estava fora: ${pending.length}`);
  pending.sort((a, b) => a.date.localeCompare(b.date)).forEach(printTx);
  console.log(`\n   Cobranças PAGAS em meses em que o associado estava fora (decisão da tesouraria): ${paid.length}`);
  paid.sort((a, b) => a.date.localeCompare(b.date)).forEach(printTx);

  // 2. Reativados.
  const reactivated = [...new Set(history.filter((h) => h.toStatus === 'active').map((h) => h.memberId))];
  console.log(`\n2) Associados que saíram e voltaram: ${reactivated.length}`);
  for (const memberId of reactivated) {
    const entries = history
      .filter((h) => h.memberId === memberId)
      .sort((a, b) => statusEffectiveDate(a).localeCompare(statusEffectiveDate(b)))
      .map((h) => `${h.toStatus === 'inactive' ? 'saiu' : 'voltou'} ${statusEffectiveDate(h)} ("${h.reason}")`);
    console.log(`  - ${byId.get(memberId)?.name ?? memberId}: ${entries.join(' → ')}`);
  }

  // 3. Inativos sem histórico.
  const withHistory = new Set(history.map((h) => h.memberId));
  const legacyInactive = db.members.filter((m) => m.status === 'inactive' && !withHistory.has(m.id));
  console.log(`\n3) Inativos sem histórico de situação (data de saída desconhecida): ${legacyInactive.length}`);
  for (const member of legacyInactive) {
    console.log(`  - ${member.name} · ${member.branch} · última alteração ${member.updatedAt?.slice(0, 10) ?? '?'}`);
  }

  // 4. Ativos com N+ meses seguidos em aberto.
  const year = Number(today.slice(0, 4));
  const dueMonths = MENSALIDADE_MONTHS.map((m) => `${year}-${String(m).padStart(2, '0')}`).filter(
    (ym) => `${ym}-01` <= today,
  );
  const suspects: Array<{
    name: string;
    branch: string;
    streak: number;
    since: string;
    open: number;
    lastPaid: string;
  }> = [];
  for (const member of db.members) {
    if (member.status !== 'active' || !paysMensalidade(member)) continue;
    const own = mensalidades.filter((tx) => tx.memberId === member.id);
    const paidMonths = new Set(own.filter((tx) => tx.paymentStatus === 'paid').map((tx) => tx.date.slice(0, 7)));
    const charged = new Set(own.map((tx) => tx.date.slice(0, 7)));
    let streak = 0;
    let open = 0;
    let since = '';
    for (const ym of [...dueMonths].reverse()) {
      if (paidMonths.has(ym)) break;
      if (!charged.has(ym)) break; // mês sem cobrança (antes da entrada / ausência)
      streak += 1;
      since = ym;
      open += own
        .filter((tx) => tx.date.startsWith(ym) && tx.paymentStatus !== 'paid')
        .reduce((sum, tx) => sum + tx.amount, 0);
    }
    if (streak < threshold) continue;
    const lastPaid =
      own
        .filter((tx) => tx.paymentStatus === 'paid')
        .map((tx) => tx.paidAt ?? tx.date)
        .sort()
        .pop() ?? 'nunca';
    suspects.push({ name: member.name, branch: member.branch, streak, since, open, lastPaid: lastPaid.slice(0, 10) });
  }
  suspects.sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name));
  console.log(`\n4) Ativos com ${threshold}+ mensalidades seguidas em aberto até hoje: ${suspects.length}`);
  for (const s of suspects) {
    console.log(
      `  - ${s.name} · ${s.branch} · ${s.streak} meses (desde ${ymLabel(s.since)}) · em aberto ${brl(s.open)} · último pagamento ${s.lastPaid}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
