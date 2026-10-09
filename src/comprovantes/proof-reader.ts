import sharp from 'sharp';
import { extractImages, getDocumentProxy } from 'unpdf';
import { fold } from '../shared/csv';
import type { LanguageModel } from '../shared/ai/language-model';
import { languageModel } from '../shared/ai/openai-compatible';
import { extractPdfText } from '../statement/statement-pdf';
import { appConfig } from '../shared/config';

export type ProofKind = 'pix' | 'ted' | 'boleto' | 'deposito' | 'nota_fiscal' | 'outro';
/** pdf = regras sobre o texto do PDF; ia = modelo de linguagem (foto, print ou PDF difícil). */
export type ProofSource = 'pdf' | 'ia';

export type ProofData = {
  kind: ProofKind;
  source: ProofSource;
  /** 0 quando não foi possível ler. */
  amount: number;
  /** yyyy-mm-dd ou '' */
  date: string;
  /** Id fim a fim do Pix (E + 32 caracteres), quando houver. */
  e2e: string;
  bank: string;
  payerName: string;
  payerDocument: string;
  payeeName: string;
  payeeDocument: string;
  rawText: string;
};

/** Id fim a fim do Pix: E + ISPB (8) + aaaaMMddHHmm (12) + 11 caracteres. Igual em todos os bancos. */
const E2E = /E\d{20}[A-Za-z0-9]{11}/;
const MONEY = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i;
/** Formatado ou 14 dígitos soltos (sem pegar trechos do id do Pix, que vêm grudados em letras). */
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b/;
const CPF_MASKED = /[\d*•x]{3}\.[\d*•x]{3}\.[\d*•x]{3}-[\d*•x]{2}/i;
const MONTHS: Record<string, string> = {
  jan: '01',
  fev: '02',
  mar: '03',
  abr: '04',
  mai: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  set: '09',
  out: '10',
  nov: '11',
  dez: '12',
};

const PAYER_LABELS = /^(dados do pagador|pagador|quem pagou|origem|de|conta de origem|remetente|dados de origem)\b/;
const PAYEE_LABELS =
  /^(dados do recebedor|recebedor|quem recebeu|destino|para|conta de destino|favorecido|beneficiario|dados do favorecido|destinatario|dados de destino)\b/;
const FIELD_LABELS =
  /^(nome|cpf|cnpj|instituicao|banco|agencia|conta|chave|tipo|valor|data|id|identificador|autenticacao|tarifa|descricao|mensagem|situacao|status)\b/;

export const AI_MAX_PER_DAY = () => appConfig.openai.dailyLimit;
const usage = { day: '', count: 0 };

/**
 * Lê o comprovante, em PDF ou imagem (JPEG, PNG, WebP):
 * 1. PDF com texto → regras (grátis); se faltar valor ou data, o texto vai para a IA;
 * 2. PDF sem texto (escaneado, foto salva como PDF) → a imagem da 1ª página vai para a IA;
 * 3. foto ou print → IA com a imagem.
 * Sem IA configurada, devolve o que as regras conseguiram (pode vir com valor 0).
 */
export async function readProof(
  buffer: Buffer,
  contentType: string,
  model: LanguageModel = languageModel,
): Promise<ProofData> {
  if (contentType !== 'application/pdf') return readImage(buffer, model);

  const text = await extractPdfText(new Uint8Array(buffer)).catch(() => '');
  const parsed = parseProofText(text);
  if (isComplete(parsed)) return parsed;
  if (text.trim()) {
    const ai = await askAi(model, { text });
    const merged = ai ? merge(parsed, ai, text) : parsed;
    if (isComplete(merged)) return merged;
  }
  const page = await pdfPageImage(buffer);
  if (!page) return parsed;
  const fromImage = await readImage(page, model);
  // O que o texto já tinha (ex.: id do Pix) continua valendo.
  return merge(parsed, toAi(fromImage), text || fromImage.rawText);
}

async function readImage(buffer: Buffer, model: LanguageModel) {
  const image = await sharp(buffer)
    .rotate()
    .resize({ width: 1400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
  const ai = await askAi(model, { imageDataUrl: `data:image/jpeg;base64,${image.toString('base64')}` });
  return ai ? merge(emptyProof('ia'), ai, '') : emptyProof('ia');
}

/** Maior imagem embutida na 1ª página: num PDF escaneado, é a própria página. */
async function pdfPageImage(buffer: Buffer): Promise<Buffer | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const images = await extractImages(pdf, 1);
    const largest = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!largest || largest.width * largest.height < 200 * 200) return null;
    return await sharp(Buffer.from(largest.data), {
      raw: { width: largest.width, height: largest.height, channels: largest.channels },
    })
      .png()
      .toBuffer();
  } catch (error) {
    console.warn('Comprovante: não consegui extrair a imagem do PDF', error instanceof Error ? error.message : error);
    return null;
  }
}

/** ProofData → formato da IA, para reaproveitar `merge`. */
function toAi(proof: ProofData): AiProof {
  return {
    tipo: proof.kind,
    valor: proof.amount,
    data: proof.date,
    e2e: proof.e2e,
    banco: proof.bank,
    pagadorNome: proof.payerName,
    pagadorDocumento: proof.payerDocument,
    recebedorNome: proof.payeeName,
    recebedorDocumento: proof.payeeDocument,
  };
}

export function isComplete(proof: ProofData) {
  return proof.amount > 0 && Boolean(proof.date) && proof.kind !== 'outro';
}

// ---------------------------------------------------------------- Regras (texto do PDF)

export function parseProofText(text: string): ProofData {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const compact = text.replace(/\s+/g, '');
  const e2e = compact.match(E2E)?.[0] ?? '';
  const payer = section(lines, PAYER_LABELS);
  const payee = section(lines, PAYEE_LABELS);
  return {
    kind: detectKind(text, Boolean(e2e)),
    source: 'pdf',
    amount: findAmount(lines),
    date: findDate(text) || dateFromE2e(e2e),
    e2e,
    bank: '',
    payerName: payer.name,
    payerDocument: payer.document,
    payeeName: payee.name,
    payeeDocument: payee.document,
    rawText: text.slice(0, 4000),
  };
}

function detectKind(text: string, hasE2e: boolean): ProofKind {
  const key = fold(text);
  if (/\bdanfe\b|nfc-?e|nota fiscal eletronica|chave de acesso/.test(key)) return 'nota_fiscal';
  if (hasE2e || /\bpix\b/.test(key)) return 'pix';
  if (/\bboleto\b|codigo de barras|linha digitavel/.test(key)) return 'boleto';
  if (/\bted\b|\bdoc\b|transferencia/.test(key)) return 'ted';
  if (/deposito/.test(key)) return 'deposito';
  return 'outro';
}

function findAmount(lines: string[]) {
  // Primeiro a linha com "valor" (o resto do comprovante pode ter tarifa, saldo, limite...).
  for (const [index, line] of lines.entries()) {
    if (!/^valor\b|valor (do pix|pago|da transfer|transferido|total|do pagamento|do documento)/i.test(fold(line))) {
      continue;
    }
    if (/tarifa|saldo|limite|desconto|juros|multa/i.test(fold(line))) continue;
    const here = line.match(MONEY) ?? line.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
    const next = lines[index + 1]?.match(MONEY);
    const value = parseMoney((here ?? next)?.[1]);
    if (value > 0) return value;
  }
  const first = lines.map((line) => line.match(MONEY)?.[1]).find(Boolean);
  return parseMoney(first);
}

function findDate(text: string) {
  const numeric = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (numeric) return validDate(`${numeric[3]}-${numeric[2]}-${numeric[1]}`);
  const written = fold(text).match(
    /\b(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s*(?:de\s+)?(\d{4})\b/,
  );
  if (written) return validDate(`${written[3]}-${MONTHS[written[2]]}-${written[1].padStart(2, '0')}`);
  return '';
}

/** Data (UTC) que vem dentro do id do Pix; só serve se o comprovante não tiver data legível. */
function dateFromE2e(e2e: string) {
  if (!e2e) return '';
  const raw = e2e.slice(9, 21);
  const utc = new Date(
    `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:00Z`,
  );
  if (Number.isNaN(utc.getTime())) return '';
  return new Date(utc.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Nome e documento logo abaixo de "Pagador"/"Recebedor" (ou em "Nome: ..." dentro da seção). */
function section(lines: string[], label: RegExp) {
  const start = lines.findIndex((line) => label.test(fold(line)));
  if (start < 0) return { name: '', document: '' };
  let name = '';
  let document = '';
  const inline = lines[start].split(':').slice(1).join(':').trim();
  if (inline && /[a-z]{3}/i.test(inline) && !FIELD_LABELS.test(fold(inline))) name = inline;
  for (const line of lines.slice(start + 1, start + 8)) {
    const key = fold(line);
    if (line !== lines[start] && (PAYER_LABELS.test(key) || PAYEE_LABELS.test(key))) break;
    if (!document) document = line.match(CNPJ)?.[0] ?? line.match(CPF_MASKED)?.[0] ?? '';
    if (name) continue;
    if (/^nome\b/.test(key)) {
      const value = line.split(':').slice(1).join(':').trim();
      if (value) name = value;
      continue;
    }
    if (FIELD_LABELS.test(key) || /\d{3}/.test(line) || !/[a-z]{3}/i.test(line)) continue;
    name = line;
  }
  return { name: name.slice(0, 120), document };
}

// ---------------------------------------------------------------- IA

const SYSTEM = `Você lê comprovantes de pagamento brasileiros (Pix, TED/DOC, boleto, depósito) de qualquer banco.
Responda SOMENTE um objeto JSON com as chaves:
{"tipo":"pix|ted|boleto|deposito|nota_fiscal|outro","valor":number,"data":"aaaa-mm-dd","e2e":"string","banco":"string",
"pagadorNome":"string","pagadorDocumento":"string","recebedorNome":"string","recebedorDocumento":"string"}
Regras: "valor" é o valor pago (não tarifa nem saldo), com ponto decimal. "e2e" é o ID da transação Pix que começa com E
e tem 32 caracteres; copie exatamente, ou "" se não houver. Documentos como aparecem (podem estar mascarados).
Use "" para o que não estiver no documento. Se não for um comprovante de pagamento, use "tipo":"outro".`;

type AiProof = {
  tipo?: string;
  valor?: number | string;
  data?: string;
  e2e?: string;
  banco?: string;
  pagadorNome?: string;
  pagadorDocumento?: string;
  recebedorNome?: string;
  recebedorDocumento?: string;
};

async function askAi(model: LanguageModel, input: { text?: string; imageDataUrl?: string }): Promise<AiProof | null> {
  if (!model.isConfigured()) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) Object.assign(usage, { day: today, count: 0 });
  if (usage.count >= AI_MAX_PER_DAY()) {
    console.warn(`IA: limite diário de ${AI_MAX_PER_DAY()} leituras atingido`);
    return null;
  }
  usage.count += 1;
  return model.visionJson<AiProof>(SYSTEM, {
    text: input.text
      ? `Texto extraído do comprovante:\n${input.text.slice(0, 6000)}`
      : 'Extraia os dados deste comprovante.',
    imageDataUrl: input.imageDataUrl,
  });
}

/** Junta regras e IA: o que as regras acharam com segurança (id do Pix) prevalece. */
export function merge(base: ProofData, ai: AiProof, text: string): ProofData {
  const e2e =
    base.e2e ||
    (String(ai.e2e ?? '')
      .replace(/\s+/g, '')
      .match(E2E)?.[0] ??
      '');
  const kinds: ProofKind[] = ['pix', 'ted', 'boleto', 'deposito', 'nota_fiscal', 'outro'];
  const aiKind = kinds.find((item) => item === ai.tipo);
  return {
    kind: base.kind !== 'outro' ? base.kind : (aiKind ?? 'outro'),
    source: 'ia',
    amount: base.amount > 0 ? base.amount : aiAmount(ai.valor),
    date: base.date || validDate(String(ai.data ?? '')) || dateFromE2e(e2e),
    e2e,
    bank: String(ai.banco ?? '').slice(0, 80),
    payerName: base.payerName || String(ai.pagadorNome ?? '').slice(0, 120),
    payerDocument: base.payerDocument || String(ai.pagadorDocumento ?? '').slice(0, 30),
    payeeName: base.payeeName || String(ai.recebedorNome ?? '').slice(0, 120),
    payeeDocument: base.payeeDocument || String(ai.recebedorDocumento ?? '').slice(0, 30),
    rawText: (text || JSON.stringify(ai)).slice(0, 4000),
  };
}

function emptyProof(source: ProofSource): ProofData {
  return {
    kind: 'outro',
    source,
    amount: 0,
    date: '',
    e2e: '',
    bank: '',
    payerName: '',
    payerDocument: '',
    payeeName: '',
    payeeDocument: '',
    rawText: '',
  };
}

function aiAmount(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  const text = String(value ?? '').replace(/[^\d,.-]/g, '');
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function parseMoney(value?: string) {
  if (!value) return 0;
  const number = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function validDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}
