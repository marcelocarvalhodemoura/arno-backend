import { prisma } from '../shared/db';
import { digitsPhone } from './whatsapp';

/**
 * Janela de atendimento da Meta: 24 h depois da última mensagem da pessoa, a empresa pode
 * responder com texto livre sem custo. Fora dela, a Meta recusa o texto (erro 131047) e só
 * aceita modelo pago. A margem evita disparar no último minuto e cair fora da janela na fila.
 */
export const WINDOW_MS = 24 * 60 * 60_000;
const SAFETY_MS = 15 * 60_000;

export const OUTSIDE_WINDOW_ERROR =
  'Fora da janela gratuita de 24 h do WhatsApp (a família não escreveu para a tesouraria nas últimas 24 h)';

/** Celulares do Brasil chegam com ou sem o nono dígito; a chave guarda sempre sem ele. */
export function windowKey(phone: string) {
  const digits = digitsPhone(phone);
  return digits.length === 13 && digits.startsWith('55') && digits[4] === '9'
    ? `${digits.slice(0, 4)}${digits.slice(5)}`
    : digits;
}

export function isInsideWindow(lastInboundAt: Date | null | undefined, now = Date.now()) {
  if (!lastInboundAt) return false;
  return now - lastInboundAt.getTime() < WINDOW_MS - SAFETY_MS;
}

export async function recordInbound(from: string, name: string | undefined, timestamp?: string) {
  const phone = windowKey(from);
  if (!phone) return;
  const seconds = Number(timestamp);
  const at = Number.isFinite(seconds) && seconds > 0 ? new Date(Math.min(seconds * 1000, Date.now())) : new Date();
  const existing = await prisma.whatsappContact.findUnique({ where: { phone } });
  if (existing && existing.lastInboundAt >= at) return;
  await prisma.whatsappContact.upsert({
    where: { phone },
    create: { phone, name: name?.trim() ?? '', lastInboundAt: at },
    update: { lastInboundAt: at, ...(name?.trim() ? { name: name.trim() } : {}) },
  });
}

export async function lastInboundAt(phone: string) {
  const key = windowKey(phone);
  if (!key) return null;
  const row = await prisma.whatsappContact.findUnique({ where: { phone: key } });
  return row?.lastInboundAt ?? null;
}

export async function windowOpen(phone: string, now = Date.now()) {
  return isInsideWindow(await lastInboundAt(phone), now);
}

/** Erros da Graph API que significam "fora da janela": não adianta tentar de novo. */
export function isOutsideWindowError(detail: string) {
  return /"code"\s*:\s*(131047|470)\b/.test(detail) || /re-engagement message/i.test(detail);
}
