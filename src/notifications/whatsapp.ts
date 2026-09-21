import { timingSafeEqual } from 'node:crypto';

export type WhatsAppStatus = {
  configured: boolean;
  webhookReady: boolean;
};

export type WhatsAppIncomingMessage = {
  phoneNumberId: string;
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: string;
  contactName?: string;
};

type WhatsAppWebhookBody = {
  object?: unknown;
  entry?: unknown;
};

type WhatsAppChangeValue = {
  metadata?: { phone_number_id?: unknown };
  contacts?: Array<{ profile?: { name?: unknown }; wa_id?: unknown }>;
  messages?: Array<{
    from?: unknown;
    id?: unknown;
    timestamp?: unknown;
    type?: unknown;
    text?: { body?: unknown };
  }>;
};

export function whatsappConfig() {
  const token = process.env.WHATSAPP_TOKEN?.trim() ?? '';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '';
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? '';
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? '';
  const financeNumber = process.env.WHATSAPP_FINANCE_NUMBER?.trim() ?? '';
  const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return {
    token,
    phoneNumberId,
    businessAccountId,
    verifyToken,
    financeNumber,
    publicUrl,
  };
}

export function whatsappStatus(): WhatsAppStatus {
  const config = whatsappConfig();
  return {
    configured: Boolean(config.token && config.phoneNumberId),
    webhookReady: Boolean(config.verifyToken),
  };
}

export function whatsappWebhookUrl() {
  const { publicUrl } = whatsappConfig();
  return publicUrl ? `${publicUrl}/webhook` : '';
}

export function hubChallenge(query: Record<string, unknown>) {
  const hub = asRecord(query.hub);
  return {
    mode: firstString(query['hub.mode'], hub?.mode, query.hub_mode),
    token: firstString(query['hub.verify_token'], hub?.verify_token, query.hub_verify_token),
    challenge: firstString(query['hub.challenge'], hub?.challenge, query.hub_challenge),
  };
}

export function verifyWebhook(mode: string, token: string) {
  const expected = whatsappConfig().verifyToken;
  if (!expected) {
    console.warn('WhatsApp webhook: defina WHATSAPP_VERIFY_TOKEN no .env e reinicie a API');
    return false;
  }
  return mode === 'subscribe' && secretsEqual(token, expected);
}

export function isWhatsAppAccount(body: unknown): body is WhatsAppWebhookBody {
  return Boolean(
    body && typeof body === 'object' && (body as WhatsAppWebhookBody).object === 'whatsapp_business_account',
  );
}

export function parseWhatsAppWebhook(body: unknown): WhatsAppIncomingMessage[] {
  if (!isWhatsAppAccount(body) || !Array.isArray(body.entry)) return [];
  const messages: WhatsAppIncomingMessage[] = [];
  for (const entry of body.entry) {
    const changes = asRecord(entry)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = asRecord(change)?.value as WhatsAppChangeValue | undefined;
      if (!value) continue;
      const phoneNumberId = asString(value.metadata?.phone_number_id);
      const contacts = new Map(
        (value.contacts ?? []).map((contact) => [asString(contact.wa_id), asString(contact.profile?.name)]),
      );
      for (const item of value.messages ?? []) {
        const from = asString(item.from);
        const id = asString(item.id);
        if (!from || !id) continue;
        messages.push({
          phoneNumberId,
          from,
          id,
          timestamp: asString(item.timestamp),
          type: asString(item.type) || 'unknown',
          text: asString(item.text?.body) || undefined,
          contactName: contacts.get(from) || undefined,
        });
      }
    }
  }
  return messages;
}

export function handleWhatsAppEvents(body: unknown) {
  console.log('Evento recebido:', JSON.stringify(body, null, 2));
  const messages = parseWhatsAppWebhook(body);
  for (const message of messages) {
    const who = message.contactName ? `${message.contactName} (${message.from})` : message.from;
    const detail = message.text ? `: ${message.text}` : '';
    console.log(`WhatsApp ${message.type} de ${who}${detail}`);
  }
  return { received: messages.length };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return '';
}

function asString(value: unknown) {
  if (Array.isArray(value)) return asString(value[0]);
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

export function digitsPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export async function sendWhatsAppText(to: string, body: string) {
  const phone = digitsPhone(to);
  if (!phone) return { ok: false, skipped: true, error: 'Destinatário sem telefone' };
  if (process.env.WHATSAPP_MOCK === '1' || process.env.MAIL_MOCK === '1') {
    return { ok: true, skipped: false };
  }
  const { token, phoneNumberId } = whatsappConfig();
  if (!token || !phoneNumberId) {
    return { ok: false, skipped: true, error: 'WhatsApp não configurado' };
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body, preview_url: false },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        skipped: false,
        error: detail.slice(0, 280) || `HTTP ${response.status}`,
      };
    }
    return { ok: true, skipped: false };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : 'Falha ao enviar WhatsApp',
    };
  }
}

function secretsEqual(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
