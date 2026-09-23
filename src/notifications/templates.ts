import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lateMonthlyFee, onTimeMonthlyFee, paysMensalidade } from '../mensalidades/fee-table';
import { dueDayOf, todayISO } from '../mensalidades/mensalidades';
import type { DatabaseShape, Member, Transaction } from '../shared/types';
import { YOUTH_BRANCHES } from '../shared/types';
import type { NotifyKind } from './notify'; // type-only: avoids runtime cycle with notify.ts

export type NotifyMessage = {
  subject: string;
  text: string;
  html: string;
};

const MONTH_NAMES = [
  '',
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const FOREST = '#0c2d6b';
const FOREST_DEEP = '#071a42';
const GOLD = '#e8b423';
const CREAM = '#f4f1ea';
const PAPER = '#fffcf7';
const INK = '#12141a';
const MUTED = '#5a5f6a';
const MOSS = '#2d8a4e';
const CLAY = '#c8102e';
const LINE = '#d9d2c4';

export const GROUP_CNPJ = '08.415.677/0001-00';
export const FINANCE_WHATSAPP_DISPLAY = '(51) 98055-3559';
export const FINANCE_WHATSAPP_LINK = 'https://wa.me/5551980553559';
export const LOGO_CID = 'arno-logo';

export function logoFilePath() {
  const candidates = [
    join(process.cwd(), 'assets/arno_logo.png'),
    join(__dirname, '../../assets/arno_logo.png'),
    join(__dirname, '../../../assets/arno_logo.png'),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

export function groupPixKey() {
  return GROUP_CNPJ;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function brl(amount: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount);
}

export function formatDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-');
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function firstName(fullName: string) {
  const token = fullName.trim().split(/\s+/)[0];
  return token || 'família';
}

function logoImg(size: number, alt: string) {
  if (!existsSync(logoFilePath())) return '';
  return `<img src="cid:${LOGO_CID}" width="${size}" height="${size}" alt="${escapeHtml(alt)}" style="display:block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;" />`;
}

function branchLabel(member?: Member) {
  if (!member) return '';
  return YOUTH_BRANCHES.find((item) => item.id === member.branch)?.name ?? '';
}

function wrapEmail(group: string, inner: string, footerNote: string) {
  const safeGroup = escapeHtml(group);
  const headerLogo = logoImg(72, `Brasão do ${group}`);
  const footerLogo = logoImg(52, `Brasão do ${group}`);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeGroup}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CREAM}" style="background:${CREAM};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;border-collapse:collapse;">
          <tr>
            <td style="height:6px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td bgcolor="${FOREST_DEEP}" style="background:${FOREST_DEEP};padding:22px 28px;font-family:Georgia,'Times New Roman',serif;color:${PAPER};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${
                    headerLogo
                      ? `<td valign="middle" width="88" style="width:88px;padding-right:16px;">${headerLogo}</td>`
                      : ''
                  }
                  <td valign="middle">
                    <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${GOLD};">
                      43/RS · Tesouraria
                    </p>
                    <p style="margin:0;font-size:24px;line-height:1.2;color:${PAPER};">${safeGroup}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="${PAPER}" style="background:${PAPER};padding:32px 28px 28px;font-family:Arial,Helvetica,sans-serif;color:${INK};">
              ${inner}
            </td>
          </tr>
          <tr>
            <td bgcolor="${FOREST}" style="background:${FOREST};padding:20px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:${CREAM};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${
                    footerLogo
                      ? `<td valign="top" width="64" style="width:64px;padding-right:14px;">${footerLogo}</td>`
                      : ''
                  }
                  <td valign="top">
                    <p style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:${PAPER};">${safeGroup}</p>
                    <p style="margin:0;color:${CREAM};">${footerNote}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function detailRow(label: string, value: string, options?: { last?: boolean }) {
  const border = options?.last ? 'none' : `1px solid ${LINE}`;
  return `<tr>
    <td style="padding:12px 20px;border-bottom:${border};font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};width:40%;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:12px 20px;border-bottom:${border};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK};font-weight:700;text-align:right;vertical-align:top;">${escapeHtml(value)}</td>
  </tr>`;
}

function chargeHtml(input: {
  group: string;
  who: string;
  member?: Member;
  monthLabel: string;
  year: string;
  amount: string;
  dueDate: string;
  overdue: boolean;
  punctualNote?: { dueDay: number; onTime: string; late: string };
}) {
  const greeting = escapeHtml(firstName(input.who));
  const memberName = input.member ? escapeHtml(input.member.name) : '';
  const ramo = branchLabel(input.member);
  const statusColor = input.overdue ? CLAY : MOSS;
  const statusLabel = input.overdue ? 'Em aberto após o vencimento' : 'Em dia se paga até o vencimento';
  const impact = input.member
    ? `A mensalidade de <strong>${memberName}</strong> mantém sede, acampamentos, materiais e o programa ${ramo ? `do ${escapeHtml(ramo)}` : 'do grupo'} em movimento.`
    : `A mensalidade mantém sede, acampamentos, materiais e o programa do grupo em movimento.`;

  const punctual = input.punctualNote
    ? input.overdue
      ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${INK};">
           O prazo de pontualidade (dia ${input.punctualNote.dueDay}) já passou. O valor atual é ${escapeHtml(input.amount)}.
           Regularizar agora garante a continuidade das atividades — e o próximo mês volta a ter o valor com pontualidade (${escapeHtml(input.punctualNote.onTime)}).
         </p>`
      : `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${INK};">
           Pague até o dia <strong>${input.punctualNote.dueDay}</strong> e a mensalidade fica em
           <strong>${escapeHtml(input.punctualNote.onTime)}</strong>. Depois dessa data, o valor passa para
           ${escapeHtml(input.punctualNote.late)}.
         </p>`
    : input.member?.clubeLtc
      ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${INK};">
           Valor de sócio do Clube da Flor de Lis (Lindóia): ${escapeHtml(input.amount)}.
         </p>`
      : '';

  const pixBlock = `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};">Chave Pix do grupo (CNPJ)</p>
       <p style="margin:0 0 8px;font-family:Consolas,Menlo,monospace;font-size:18px;letter-spacing:0.03em;color:${FOREST_DEEP};">${escapeHtml(GROUP_CNPJ)}</p>
       <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${INK};">
         A chave Pix corresponde ao CNPJ do grupo: <strong>${escapeHtml(GROUP_CNPJ)}</strong>. Na descrição do Pix, use o nome do associado.
       </p>`;

  const paidAlready = `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${MOSS};">Já pagou esta mensalidade?</p>
       <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${INK};">
         Envie o comprovante no WhatsApp do financeiro
         <a href="${FINANCE_WHATSAPP_LINK}" style="color:${FOREST};font-weight:700;text-decoration:none;">${FINANCE_WHATSAPP_DISPLAY}</a>
         e desconsidere esta mensagem.
       </p>`;

  const footerNote = `Tesouraria · 43/RS. Se já pagou, envie o comprovante no WhatsApp ${FINANCE_WHATSAPP_DISPLAY} e desconsidere esta mensagem. Dúvidas: responda este e-mail.`;

  return wrapEmail(
    input.group,
    `
      <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${CLAY};">
        Mensalidade
      </p>
      <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:${FOREST};font-weight:400;">
        Olá, ${greeting}.
      </h1>
      <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:${INK};">
        ${impact} Com o pagamento em dia, a tropa segue pronta para o próximo sábado.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:${CREAM};border:1px solid ${LINE};">
        <tr>
          <td style="padding:22px 24px;">
            <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">
              Valor a pagar · ${escapeHtml(input.monthLabel)} ${escapeHtml(input.year)}
            </p>
            <p style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.1;color:${FOREST};">
              ${escapeHtml(input.amount)}
            </p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${statusColor};font-weight:700;">
              ${statusLabel} · vence em ${escapeHtml(input.dueDate)}
            </p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
        ${input.member ? detailRow('Associado', input.member.name) : ''}
        ${ramo ? detailRow('Ramo', ramo) : ''}
        ${detailRow('Competência', `${input.monthLabel} de ${input.year}`)}
        ${detailRow('Vencimento', input.dueDate)}
        ${detailRow('Valor', input.amount)}
      </table>
      ${
        punctual
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-left:4px solid ${GOLD};background:${CREAM};">
               <tr><td style="padding:14px 16px;">${punctual}</td></tr>
             </table>`
          : ''
      }
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
        <tr>
          <td bgcolor="${FOREST}" style="background:${FOREST};padding:16px 20px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${GOLD};">
            Pagar por Pix
          </td>
        </tr>
        <tr>
          <td style="padding:16px 20px 8px;border:1px solid ${LINE};border-top:0;">
            ${pixBlock}
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 28px;background:${CREAM};border:1px solid ${LINE};">
        <tr>
          <td style="padding:16px 20px;">
            ${paidAlready}
          </td>
        </tr>
      </table>
    `,
    footerNote,
  );
}

function receiptHtml(input: {
  group: string;
  who: string;
  member?: Member;
  amount: string;
  paidOn: string;
  dueDate: string;
  monthLabel: string;
  year: string;
  description: string;
  receiptCode: string;
}) {
  const greeting = escapeHtml(firstName(input.who));
  const ramo = branchLabel(input.member);
  const successBanner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-left:4px solid ${MOSS};background:${CREAM};">
    <tr>
      <td style="padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${INK};">
        <strong style="color:${MOSS};">Pagamento confirmado com sucesso.</strong>
        Este e-mail é o recibo oficial da tesouraria referente à mensalidade abaixo.
      </td>
    </tr>
  </table>`;
  return wrapEmail(
    input.group,
    `
      <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${MOSS};">
        Recibo de pagamento
      </p>
      <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:${FOREST};font-weight:400;">
        Obrigado, ${greeting}.
      </h1>
      <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${INK};">
        A tesouraria do ${escapeHtml(input.group)} confirma o recebimento. Sua contribuição já entra no programa do grupo.
      </p>
      ${successBanner}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid ${LINE};border-collapse:collapse;">
        <tr>
          <td bgcolor="${FOREST}" style="background:${FOREST};padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${GOLD};">
            Recibo
          </td>
        </tr>
        <tr>
          <td style="padding:0;background:${PAPER};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              ${input.member ? detailRow('Associado', input.member.name) : ''}
              ${ramo ? detailRow('Ramo', ramo) : ''}
              ${detailRow('Competência', `${input.monthLabel} de ${input.year}`)}
              ${detailRow('Vencimento', input.dueDate)}
              ${detailRow('Data do pagamento', input.paidOn)}
              ${detailRow('Valor pago', input.amount)}
              ${detailRow('Referência', input.description)}
              ${detailRow('Nº do recibo', input.receiptCode, { last: true })}
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${MUTED};">
        Guarde este e-mail como comprovante. Em caso de divergência, responda esta mensagem ou fale com a tesouraria no WhatsApp ${FINANCE_WHATSAPP_DISPLAY}.
      </p>
    `,
    `Tesouraria · 43/RS. Este é um recibo interno do ${escapeHtml(input.group)}. Dúvidas: responda este e-mail.`,
  );
}

export function composeNotifyMessage(db: DatabaseShape, tx: Transaction, kind: NotifyKind, who: string): NotifyMessage {
  const group = db.settings.groupName || 'Grupo Escoteiro Arno Friedrich';
  const member = tx.memberId ? db.members.find((item) => item.id === tx.memberId) : undefined;
  const month = Number(tx.date.slice(5, 7));
  const year = tx.date.slice(0, 4);
  const monthLabel = MONTH_NAMES[month] ?? tx.date;
  const amount = brl(tx.amount);
  const dueDate = formatDate(tx.date);
  const paidOn = formatDate((tx.paidAt ?? tx.date).slice(0, 10));
  const receiptCode = tx.id.replace(/-/g, '').slice(0, 12).toUpperCase();

  if (kind === 'receipt') {
    const subject = `Pagamento confirmado · Mensalidade ${monthLabel} ${year} · ${group}`;
    const text =
      `Olá, ${firstName(who)}.\n\n` +
      `Pagamento confirmado com sucesso.\n\n` +
      `A tesouraria do ${group} confirma o recebimento de ${amount} referente à mensalidade de ${monthLabel} de ${year}.\n` +
      (member ? `Associado: ${member.name}.\n` : '') +
      `Vencimento: ${dueDate}.\n` +
      `Data do pagamento: ${paidOn}.\n` +
      `Referência: ${tx.description}.\n` +
      `Nº do recibo: ${receiptCode}.\n\n` +
      `Obrigado por manter o programa do grupo em dia.\n` +
      `Guarde este e-mail como comprovante. Em caso de divergência, fale com a tesouraria no WhatsApp ${FINANCE_WHATSAPP_DISPLAY}.`;
    return {
      subject,
      text,
      html: receiptHtml({
        group,
        who,
        member,
        amount,
        paidOn,
        dueDate,
        monthLabel,
        year,
        description: tx.description,
        receiptCode,
      }),
    };
  }

  const dueDay = dueDayOf(db);
  const overdue = tx.date.slice(0, 10) < todayISO();
  const billingMonth = Number(tx.date.slice(5, 7));
  const punctualNote =
    member && paysMensalidade(member) && !member.clubeLtc
      ? {
          dueDay,
          onTime: brl(onTimeMonthlyFee(member, billingMonth)),
          late: brl(lateMonthlyFee(member, billingMonth)),
        }
      : undefined;
  const subject = overdue
    ? `Mensalidade de ${monthLabel} ${year} em aberto · ${group}`
    : `Mensalidade de ${monthLabel} ${year} · ${group}`;

  const punctualText = punctualNote
    ? overdue
      ? `O prazo de pontualidade (dia ${punctualNote.dueDay}) já passou. O valor atual é ${amount}. No próximo mês, pague até o dia ${punctualNote.dueDay} para voltar ao valor de ${punctualNote.onTime}.`
      : `Pague até o dia ${punctualNote.dueDay} e a mensalidade fica em ${punctualNote.onTime}. Depois dessa data, o valor passa para ${punctualNote.late}.`
    : member?.clubeLtc
      ? `Valor de sócio do Clube da Flor de Lis (Lindóia): ${amount}.`
      : '';

  const pixText = `A chave Pix do grupo é o CNPJ ${GROUP_CNPJ}. Na descrição, use o nome do associado.`;
  const paidText = `Se já pagou esta mensalidade, envie o comprovante no WhatsApp do financeiro ${FINANCE_WHATSAPP_DISPLAY} e desconsidere esta mensagem.`;

  const text =
    `Olá, ${firstName(who)}.\n\n` +
    (member
      ? `A mensalidade de ${monthLabel} de ${year} de ${member.name} está em ${amount}, com vencimento em ${dueDate}.\n`
      : `A mensalidade de ${monthLabel} de ${year} está em ${amount}, com vencimento em ${dueDate}.\n`) +
    `Essa contribuição mantém sede, acampamentos e o programa do grupo.\n\n` +
    (punctualText ? `${punctualText}\n\n` : '') +
    `${pixText}\n` +
    `${paidText}\n\n` +
    `Tesouraria · ${group}`;

  return {
    subject,
    text,
    html: chargeHtml({
      group,
      who,
      member,
      monthLabel,
      year,
      amount,
      dueDate,
      overdue,
      punctualNote,
    }),
  };
}
