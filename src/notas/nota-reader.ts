import jsQR from 'jsqr';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { extractPdfText } from '../statement/statement-pdf';

export type NotaItem = {
  description: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
};

export type NotaSource = 'sefaz' | 'pdf' | 'ocr';

export type NotaData = {
  source: NotaSource;
  issuerName: string;
  issuerDocument: string;
  /** yyyy-mm-dd */
  date: string;
  total: number;
  items: NotaItem[];
  paymentMethod?: string;
  accessKey?: string;
  qrUrl?: string;
  confidence: 'high' | 'medium' | 'low';
  rawText: string;
};

/**
 * Lê a nota inteira a partir de foto ou PDF, sem serviço pago:
 * 1. QR code da NFC-e → página pública da Sefaz (emitente, itens, total, pagamento);
 * 2. PDF → texto do DANFE/cupom;
 * 3. foto sem QR legível → OCR local (tesseract).
 */
export async function readNota(buffer: Buffer, contentType: string): Promise<NotaData> {
  if (contentType === 'application/pdf') {
    const text = await extractPdfText(new Uint8Array(buffer));
    const qrUrl = findQrUrl(text);
    if (qrUrl) {
      const fromSefaz = await readFromSefaz(qrUrl).catch(() => null);
      if (fromSefaz) return fromSefaz;
    }
    return parseNotaText(text, 'pdf');
  }

  const qrUrl = await decodeQr(buffer);
  if (qrUrl) {
    const fromSefaz = await readFromSefaz(qrUrl).catch((error) => {
      console.warn('Nota: falha ao consultar a Sefaz', error instanceof Error ? error.message : error);
      return null;
    });
    if (fromSefaz) return fromSefaz;
  }
  const text = await ocrImage(buffer);
  const parsed = parseNotaText(text, 'ocr');
  if (qrUrl && !parsed.accessKey) parsed.accessKey = accessKeyFromQr(qrUrl);
  return parsed;
}

// ---------------------------------------------------------------- QR code

export async function decodeQr(buffer: Buffer): Promise<string | null> {
  const attempts: Array<(image: ReturnType<typeof sharp>) => ReturnType<typeof sharp>> = [
    (image) => image.resize({ width: 1400, withoutEnlargement: true }),
    (image) => image.resize({ width: 900, withoutEnlargement: true }).grayscale().normalize(),
    (image) => image.resize({ width: 2000, withoutEnlargement: true }).grayscale().threshold(140),
  ];
  for (const attempt of attempts) {
    try {
      const { data, info } = await attempt(sharp(buffer).rotate())
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (found?.data) return found.data.trim();
    } catch {
      // tenta a próxima variação
    }
  }
  return null;
}

export function findQrUrl(text: string): string | null {
  const match = text.replace(/\s+/g, ' ').match(/https?:\/\/\S*(?:nfce|qrcode)\S*\?p=[\d|A-Za-z]+/i);
  return match ? match[0] : null;
}

export function accessKeyFromQr(url: string): string | undefined {
  const param = url.match(/[?&]p=(\d{44})/);
  return param?.[1];
}

// ---------------------------------------------------------------- Sefaz (NFC-e)

async function readFromSefaz(qrUrl: string): Promise<NotaData | null> {
  if (!/^https?:\/\//i.test(qrUrl)) return null;
  const response = await fetch(qrUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Arno tesouraria)', Accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Sefaz HTTP ${response.status}`);
  const html = await response.text();
  const parsed = parseSefazHtml(html);
  if (!parsed) return null;
  return { ...parsed, qrUrl, accessKey: parsed.accessKey ?? accessKeyFromQr(qrUrl) };
}

/** Layout padrão da consulta pública da NFC-e (SVRS e demais portais). */
export function parseSefazHtml(html: string): NotaData | null {
  const issuerName = cleanHtml(html.match(/class="txtTopo"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '');
  const issuerDocument = onlyDigits(html.match(/CNPJ:\s*([\d./-]+)/i)?.[1] ?? '');

  const items: NotaItem[] = [];
  const rows = html.match(/<tr[^>]*id="Item[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const description = cleanHtml(row.match(/class="txtTit2?"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const quantity = parseMoney(cleanHtml(row.match(/class="Rqtd"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ''));
    const unitPrice = parseMoney(cleanHtml(row.match(/class="RvlUnit"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ''));
    const total = parseMoney(cleanHtml(row.match(/class="valor"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ''));
    if (!description || !Number.isFinite(total)) continue;
    items.push({
      description,
      quantity: Number.isFinite(quantity) ? quantity : undefined,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined,
      total,
    });
  }

  const totals = [
    ...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>\s*<span[^>]*class="totalNumb[^"]*"[^>]*>([\s\S]*?)<\/span>/gi),
  ].map((match) => ({ label: fold(cleanHtml(match[1])), value: parseMoney(cleanHtml(match[2])) }));
  const toPay = totals.find((item) => item.label.includes('valor a pagar'));
  const gross = totals.find((item) => item.label.includes('valor total'));
  const total = toPay?.value ?? gross?.value ?? items.reduce((sum, item) => sum + item.total, 0);

  const formaIndex = totals.findIndex((item) => item.label.includes('forma de pagamento'));
  const paymentMethod =
    totals.slice(formaIndex >= 0 ? formaIndex + 1 : 0).find((item) => PAYMENT_WORDS.test(item.label))?.label ??
    html.match(/<label class="tx">([\s\S]*?)<\/label>/i)?.[1];

  const text = cleanHtml(html);
  const date = isoDate(text.match(/Emiss[ãa]o:?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? '');
  const accessKey = onlyDigits(html.match(/class="chave"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '') || undefined;

  if (!issuerName || !Number.isFinite(total) || total <= 0) return null;
  return {
    source: 'sefaz',
    issuerName,
    issuerDocument,
    date,
    total: round(total),
    items,
    paymentMethod: paymentMethod ? cleanHtml(paymentMethod) : undefined,
    accessKey: accessKey?.length === 44 ? accessKey : undefined,
    confidence: date ? 'high' : 'medium',
    rawText: text.slice(0, 4000),
  };
}

// ---------------------------------------------------------------- OCR

async function ocrImage(buffer: Buffer): Promise<string> {
  const prepared = await sharp(buffer)
    .rotate()
    .resize({ width: 1800, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
  const worker = await createWorker('por');
  try {
    const { data } = await worker.recognize(prepared);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------- Texto (PDF ou OCR)

const MONEY = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/;
const PAYMENT_WORDS = /(cr[eé]dito|d[eé]bito|dinheiro|pix|cart[aã]o|vale)/i;
const TOTAL_LABELS = [
  /valor\s+a\s+pagar/i,
  /valor\s+total\s+da\s+nota/i,
  /valor\s+total\s*(?:r\$)?/i,
  /total\s+a\s+pagar/i,
  /\btotal\s*r\$/i,
  /^\s*total\b/i,
];
const HEADER_WORDS =
  /(danfe|documento auxiliar|nota fiscal|nfc-?e|consumidor|cnpj|inscri[cç][aã]o|ie:|endere[cç]o|rua|av\.|avenida|cep|fone|telefone|protocolo|emiss[aã]o|s[eé]rie|chave|consulte|www\.|http)/i;

export function parseNotaText(text: string, source: NotaSource): NotaData {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const flat = lines.join('\n');

  const issuerDocument = onlyDigits(flat.match(/\d{2}\.?\d{3}\.?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2}/)?.[0] ?? '');
  const issuerName = findIssuer(lines);
  const date = isoDate(
    flat.match(/emiss[ãa]o[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? flat.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? '',
  );
  const total = findTotal(lines);
  const accessKey = findAccessKey(flat);
  const items = findItems(lines);
  const paymentMethod = lines
    .find((line) => PAYMENT_WORDS.test(line) && MONEY.test(line))
    ?.replace(MONEY, '')
    .trim();

  const found = [issuerName, date, total > 0].filter(Boolean).length;
  return {
    source,
    issuerName,
    issuerDocument,
    date,
    total,
    items,
    paymentMethod: paymentMethod || undefined,
    accessKey,
    confidence: found === 3 && source === 'pdf' ? 'high' : found === 3 ? 'medium' : 'low',
    rawText: flat.slice(0, 4000),
  };
}

function findIssuer(lines: string[]) {
  const recebemos = lines.join(' ').match(/recebemos de\s+(.+?)\s+os produtos/i)?.[1];
  if (recebemos) return recebemos.trim();
  const razao = lines.find((line) => /raz[aã]o social|emitente/i.test(line));
  if (razao) {
    const value = razao.replace(/.*(raz[aã]o social|emitente)\s*:?/i, '').trim();
    if (value.length >= 3) return value;
  }
  return (
    lines.find((line) => /[a-z]{3}/i.test(line) && !HEADER_WORDS.test(line) && !MONEY.test(line) && line.length >= 4) ??
    ''
  );
}

function findTotal(lines: string[]) {
  for (const label of TOTAL_LABELS) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!label.test(lines[index])) continue;
      const here = lines[index].match(new RegExp(`${MONEY.source}\\s*$`)) ?? lines[index].match(MONEY);
      const value = parseMoney(here?.[1] ?? lines[index + 1]?.match(MONEY)?.[1] ?? '');
      if (Number.isFinite(value) && value > 0) return round(value);
    }
  }
  return 0;
}

function findAccessKey(text: string) {
  for (const match of text.matchAll(/(?:\d{4}\s?){10}\d{4}/g)) {
    const digits = onlyDigits(match[0]);
    if (digits.length === 44) return digits;
  }
  return undefined;
}

/** Linhas de item: descrição + (qtd UN x unit) + valor total no fim da linha. */
function findItems(lines: string[]): NotaItem[] {
  const items: NotaItem[] = [];
  const pattern = new RegExp(
    `^(?:\\d{1,3}\\s+)?(?:\\d{3,14}\\s+)?(.+?)\\s+(\\d+(?:[.,]\\d{1,3})?)\\s*(?:UN|UND|KG|G|L|LT|PC|CX|PCT|FD|M)\\b.*?${MONEY.source}\\s*$`,
    'i',
  );
  for (const line of lines) {
    if (TOTAL_LABELS.some((label) => label.test(line)) || PAYMENT_WORDS.test(line)) continue;
    const match = line.match(pattern);
    if (!match) continue;
    const total = parseMoney(match[3]);
    const description = match[1].replace(/\s+/g, ' ').trim();
    if (!/[a-z]{2}/i.test(description) || !Number.isFinite(total)) continue;
    items.push({ description, quantity: parseMoney(match[2]), total });
  }
  return items;
}

// ---------------------------------------------------------------- utilitários

export function describeNota(nota: NotaData, limit = 4) {
  const names = nota.items.slice(0, limit).map((item) => item.description.toLowerCase());
  const more = nota.items.length > limit ? ` e mais ${nota.items.length - limit}` : '';
  return names.length ? `${names.join(', ')}${more}` : '';
}

function parseMoney(value: string) {
  const match = value.match(/-?\d[\d.]*(?:,\d+)?/);
  if (!match) return Number.NaN;
  return Number(match[0].replace(/\./g, '').replace(',', '.'));
}

function isoDate(value: string) {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function fold(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function cleanHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
