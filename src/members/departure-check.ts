import type { DatabaseShape } from '../shared/types';
import { BRANCH_LABELS, roundMoney } from '../shared/types';
import { paysMensalidade } from '../mensalidades/fee-table';
import { isMensalidadeTx, statusEffectiveDate, todayISO } from '../mensalidades/mensalidades';
import { digitsPhone } from '../notifications/whatsapp';
import { formatDate } from '../notifications/templates';
import { prettyName, waMeLink } from '../mensalidades/whatsapp-queue';

/**
 * Possíveis desligamentos: jovens ativos com várias mensalidades vencidas seguidas, sem pagamento entre elas.
 * Muitas famílias deixam o grupo sem avisar; a lista serve para a tesouraria perguntar antes de registrar a
 * saída. Ninguém é desligado automaticamente.
 */

/** Prazo, em dias, dado à família para responder se o jovem continua. */
export const DEPARTURE_CHECK_DAYS = 15;
export const DEFAULT_DEPARTURE_MONTHS = 3;

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function monthLabel(ym: string) {
  return `${SHORT_MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)}/${ym.slice(0, 4)}`;
}

function firstName(name: string) {
  return prettyName(name).split(' ')[0] || 'família';
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Último dia do mês anterior a `ym` (YYYY-MM). */
function endOfPreviousMonth(ym: string) {
  const first = new Date(`${ym}-01T12:00:00Z`);
  first.setUTCDate(0);
  return first.toISOString().slice(0, 10);
}

export function composeDepartureCheck(input: {
  group: string;
  who: string;
  memberName: string;
  since: string;
  deadline: string;
}) {
  const member = prettyName(input.memberName);
  return [
    `Olá, ${firstName(input.who)}! Tudo bem?`,
    `Aqui é a tesouraria do ${input.group}.`,
    '',
    `Notamos que as mensalidades de ${member} estão em aberto desde ${monthLabel(input.since)}.`,
    `Queremos confirmar: ${member} continua participando das atividades do grupo?`,
    '',
    '• Se continua, é só nos avisar por aqui que combinamos como regularizar.',
    '• Se não vai continuar, responda confirmando o desligamento, para pararmos de gerar as mensalidades.',
    '',
    `Se não tivermos retorno até ${formatDate(input.deadline)}, vamos considerar que ${member} deixou o grupo e registrar o desligamento.`,
    'Obrigado! ⚜️',
  ].join('\n');
}

export type DepartureContact = { name: string; relationship: string; phone: string; link: string; text: string };

export type DepartureCheckRow = {
  memberId: string;
  name: string;
  branch: string;
  branchLabel: string;
  /** Mensalidades vencidas seguidas sem pagamento. */
  streak: number;
  /** Primeiro mês da sequência em aberto (YYYY-MM). */
  since: string;
  months: string[];
  openAmount: number;
  lastPaidAt: string | null;
  hasAgreement: boolean;
  /** Data sugerida para a saída: fim do último mês antes da sequência em aberto. */
  suggestedEffectiveDate: string;
  contacts: DepartureContact[];
  hasEmail: boolean;
  /** Última pergunta de permanência enviada e o prazo dado à família. */
  lastCheck: { at: string; deadline: string; expired: boolean } | null;
};

export function buildPossibleDepartures(
  db: DatabaseShape,
  lastChecks: Map<string, string>,
  options: { months?: number; today?: string } = {},
) {
  const today = options.today ?? todayISO();
  const threshold = Math.max(1, Math.floor(options.months ?? DEFAULT_DEPARTURE_MONTHS));
  const group = db.settings.groupName || 'Grupo Escoteiro Arno Friedrich';
  const deadline = addDays(today, DEPARTURE_CHECK_DAYS);
  const rows: DepartureCheckRow[] = [];

  for (const member of db.members) {
    if (member.status !== 'active' || member.role !== 'jovem' || !paysMensalidade(member)) continue;
    const own = db.transactions.filter((tx) => tx.memberId === member.id && isMensalidadeTx(db, tx));
    // Meses já vencidos com cobrança, do mais recente para o mais antigo. Meses sem cobrança (antes da entrada,
    // fora da temporada, período fora do grupo) não quebram nem contam na sequência.
    const dueMonths = [...new Set(own.filter((tx) => tx.date < today).map((tx) => tx.date.slice(0, 7)))]
      .sort()
      .reverse();
    const paidMonths = new Set(own.filter((tx) => tx.paymentStatus === 'paid').map((tx) => tx.date.slice(0, 7)));
    const streakMonths: string[] = [];
    for (const ym of dueMonths) {
      if (paidMonths.has(ym)) break;
      streakMonths.push(ym);
    }
    if (streakMonths.length < threshold) continue;
    const months = streakMonths.reverse();
    const since = months[0];
    const openAmount = roundMoney(
      own
        .filter((tx) => tx.paymentStatus !== 'paid' && months.includes(tx.date.slice(0, 7)))
        .reduce((sum, tx) => sum + tx.amount, 0),
    );
    const lastPaidAt =
      own
        .filter((tx) => tx.paymentStatus === 'paid')
        .map((tx) => (tx.paidAt ?? tx.date).slice(0, 10))
        .sort()
        .pop() ?? null;

    // A saída sugerida não pode cair antes da entrada nem antes da última mudança de situação.
    let suggested = endOfPreviousMonth(since);
    const joined = member.joinedAt?.slice(0, 10);
    if (joined && suggested < joined) suggested = joined;
    const lastChange = (db.memberStatusHistory ?? [])
      .filter((entry) => entry.memberId === member.id)
      .map(statusEffectiveDate)
      .sort()
      .pop();
    if (lastChange && suggested < lastChange) suggested = lastChange;
    if (suggested > today) suggested = today;

    const guardians = (db.memberGuardians ?? []).filter((item) => item.memberId === member.id);
    const seen = new Set<string>();
    const contacts: DepartureContact[] = [];
    for (const person of [...guardians, { name: member.name, relationship: 'Associado', phone: member.phone }]) {
      const phone = digitsPhone(person.phone ?? '');
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      const text = composeDepartureCheck({
        group,
        who: person.name || member.name,
        memberName: member.name,
        since,
        deadline,
      });
      contacts.push({
        name: prettyName(person.name || member.name),
        relationship: person.relationship,
        phone: person.phone,
        link: waMeLink(phone, text),
        text,
      });
    }
    const hasEmail = Boolean(member.email?.includes('@')) || guardians.some((item) => item.email?.includes('@'));

    const checkedAt = lastChecks.get(member.id);
    const checkDeadline = checkedAt ? addDays(todayISO(new Date(checkedAt)), DEPARTURE_CHECK_DAYS) : null;

    rows.push({
      memberId: member.id,
      name: member.name,
      branch: member.branch,
      branchLabel: BRANCH_LABELS[member.branch],
      streak: months.length,
      since,
      months: months.map(monthLabel),
      openAmount,
      lastPaidAt,
      hasAgreement: (db.memberArrears ?? []).some((item) => item.memberId === member.id && item.status === 'active'),
      suggestedEffectiveDate: suggested,
      contacts,
      hasEmail,
      lastCheck:
        checkedAt && checkDeadline ? { at: checkedAt, deadline: checkDeadline, expired: checkDeadline < today } : null,
    });
  }

  rows.sort((a, b) => b.streak - a.streak || b.openAmount - a.openAmount || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    today,
    months: threshold,
    deadlineDays: DEPARTURE_CHECK_DAYS,
    rows,
    totals: {
      members: rows.length,
      openAmount: roundMoney(rows.reduce((sum, row) => sum + row.openAmount, 0)),
      contacted: rows.filter((row) => row.lastCheck).length,
      expired: rows.filter((row) => row.lastCheck?.expired).length,
    },
  };
}

/** Texto do e-mail de confirmação para um destinatário. */
export function departureCheckEmailText(db: DatabaseShape, memberId: string, who: string, today = todayISO()) {
  const report = buildPossibleDepartures(db, new Map(), { months: 1, today });
  const row = report.rows.find((item) => item.memberId === memberId);
  const member = db.members.find((item) => item.id === memberId);
  if (!row || !member) return null;
  return composeDepartureCheck({
    group: db.settings.groupName || 'Grupo Escoteiro Arno Friedrich',
    who,
    memberName: member.name,
    since: row.since,
    deadline: addDays(today, DEPARTURE_CHECK_DAYS),
  });
}
