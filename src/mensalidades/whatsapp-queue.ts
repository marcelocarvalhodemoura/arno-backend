import type { DatabaseShape } from '../shared/types';
import { BRANCH_LABELS, roundMoney } from '../shared/types';
import { digitsPhone } from '../notifications/whatsapp';
import { brl, formatDate, GROUP_CNPJ } from '../notifications/templates';
import { dueDayOf, listOpenMensalidades } from './mensalidades';
import { todayISO } from '../shared/dates';
import { appConfig } from '../shared/config';

/**
 * Fila de cobrança pelo WhatsApp sem custo: o sistema monta a mensagem e o link wa.me, e a
 * tesouraria envia do próprio WhatsApp. Mensagem que a empresa inicia pela Cloud API é paga;
 * pelo link não há cobrança nem risco de bloqueio do número.
 */
export type ChargeQueueMode = 'overdue' | 'upcoming';

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LOWER_WORDS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

/** Os nomes são gravados em maiúsculas; na mensagem ficam "Maria da Silva". */
export function prettyName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => (index > 0 && LOWER_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function firstName(name: string) {
  return prettyName(name).split(' ')[0] || 'família';
}

function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-');
  return `${SHORT_MONTHS[Number(month) - 1] ?? month}/${year}`;
}

// --- Pix copia e cola (BR Code estático, padrão EMV do Banco Central) ---

function ascii(value: string, max: number) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

function emv(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

export function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function pixCopiaECola(input: { key: string; amount: number; name: string; city: string; info?: string }) {
  const info = input.info ? ascii(input.info, 40) : '';
  const account = emv('00', 'br.gov.bcb.pix') + emv('01', input.key) + (info ? emv('02', info) : '');
  const payload =
    emv('00', '01') +
    emv('26', account) +
    emv('52', '0000') +
    emv('53', '986') +
    (input.amount > 0 ? emv('54', input.amount.toFixed(2)) : '') +
    emv('58', 'BR') +
    emv('59', ascii(input.name, 25) || 'GRUPO ESCOTEIRO') +
    emv('60', ascii(input.city, 15) || 'PORTO ALEGRE') +
    emv('62', emv('05', '***')) +
    '6304';
  return payload + crc16(payload);
}

function groupPix(amount: number, info: string) {
  return pixCopiaECola({
    key: GROUP_CNPJ.replace(/\D/g, ''),
    amount,
    name: appConfig.pix.merchantName,
    city: appConfig.pix.merchantCity,
    info,
  });
}

// --- Mensagem ---

type QueueItem = {
  transactionId: string;
  yearMonth: string;
  label: string;
  dueDate: string;
  onTimeAmount: number;
  lateAmount: number;
  amount: number;
  surcharge: number;
};

export type QueueContact = { name: string; relationship: string; phone: string; link: string; text: string };

export type QueueRow = {
  memberId: string;
  name: string;
  branch: string;
  branchLabel: string;
  items: QueueItem[];
  total: number;
  surcharge: number;
  pixAmount: number;
  hasAgreement: boolean;
  contacts: QueueContact[];
  lastSentAt: string | null;
};

export function composeWhatsAppCharge(input: {
  mode: ChargeQueueMode;
  group: string;
  who: string;
  memberName: string;
  items: QueueItem[];
  total: number;
  surcharge: number;
  dueDay: number;
  pix: string;
}) {
  const member = prettyName(input.memberName);
  const lines = [`Olá, ${firstName(input.who)}! Tudo bem?`, `Aqui é a tesouraria do ${input.group}.`, ''];
  if (input.mode === 'upcoming') {
    const item = input.items[0];
    lines.push(
      `Passando para lembrar que a mensalidade de ${item.label} de ${member} vence em ${formatDate(item.dueDate)}.`,
      `Pagando até o dia ${input.dueDay}, o valor é ${brl(item.onTimeAmount)}. Depois dessa data, passa para ${brl(item.lateAmount)}.`,
    );
  } else {
    lines.push(
      input.items.length === 1
        ? `Consta em aberto a mensalidade de ${member}:`
        : `Constam em aberto as mensalidades de ${member}:`,
    );
    for (const item of input.items) {
      lines.push(`• ${item.label}: ${brl(item.amount)} (vencimento ${formatDate(item.dueDate)})`);
    }
    lines.push('', `*Total: ${brl(input.total)}*`);
    if (input.surcharge > 0) {
      lines.push(`O total inclui ${brl(input.surcharge)} de acréscimo por pagamento após o dia ${input.dueDay}.`);
    }
  }
  lines.push(
    '',
    `Chave Pix (CNPJ): ${GROUP_CNPJ}`,
    'Ou use o Pix copia e cola abaixo, que já vem com o valor:',
    '',
    input.pix,
    '',
    'Se já pagou, é só responder com o comprovante que a gente dá baixa. Obrigado! ⚜️',
  );
  return lines.join('\n');
}

export function waMeLink(phone: string, text: string) {
  return `https://wa.me/${digitsPhone(phone)}?text=${encodeURIComponent(text)}`;
}

// --- Fila ---

export function buildWhatsAppChargeQueue(
  db: DatabaseShape,
  mode: ChargeQueueMode,
  lastSent: Map<string, string>,
  today = todayISO(),
) {
  const group = db.settings.groupName || 'Grupo Escoteiro Arno Friedrich';
  const dueDay = dueDayOf(db);
  const currentMonth = today.slice(0, 7);
  const rows: QueueRow[] = [];

  for (const member of db.members) {
    if (member.status !== 'active') continue;
    const open = listOpenMensalidades(db, member.id, today).filter((item) =>
      mode === 'overdue' ? item.status === 'overdue' : item.status === 'pending' && item.yearMonth === currentMonth,
    );
    if (!open.length) continue;

    const items: QueueItem[] = open.map((item) => {
      const amount = item.status === 'overdue' ? item.lateAmount : item.onTimeAmount;
      return {
        transactionId: item.transactionId,
        yearMonth: item.yearMonth,
        label: monthLabel(item.yearMonth),
        dueDate: item.dueDate,
        onTimeAmount: item.onTimeAmount,
        lateAmount: item.lateAmount,
        amount,
        surcharge: roundMoney(amount - item.onTimeAmount),
      };
    });
    const total = roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
    const surcharge = roundMoney(items.reduce((sum, item) => sum + item.surcharge, 0));
    const pixAmount = mode === 'upcoming' ? items[0].onTimeAmount : total;
    const pix = groupPix(pixAmount, `Mensalidade ${member.name}`);

    const guardians = (db.memberGuardians ?? []).filter((item) => item.memberId === member.id);
    const seen = new Set<string>();
    const contacts: QueueContact[] = [];
    for (const person of [...guardians, { name: member.name, relationship: 'Associado', phone: member.phone }]) {
      const phone = digitsPhone(person.phone ?? '');
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      const text = composeWhatsAppCharge({
        mode,
        group,
        who: person.name || member.name,
        memberName: member.name,
        items,
        total,
        surcharge,
        dueDay,
        pix,
      });
      contacts.push({
        name: prettyName(person.name || member.name),
        relationship: person.relationship,
        phone: person.phone,
        link: waMeLink(phone, text),
        text,
      });
    }

    rows.push({
      memberId: member.id,
      name: member.name,
      branch: member.branch,
      branchLabel: BRANCH_LABELS[member.branch],
      items,
      total,
      surcharge,
      pixAmount,
      hasAgreement: (db.memberArrears ?? []).some((item) => item.memberId === member.id && item.status === 'active'),
      contacts,
      lastSentAt: lastSent.get(member.id) ?? null,
    });
  }

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    mode,
    today,
    dueDay,
    rows,
    totals: {
      members: rows.length,
      amount: roundMoney(rows.reduce((sum, row) => sum + row.total, 0)),
      withoutPhone: rows.filter((row) => !row.contacts.length).length,
    },
  };
}
