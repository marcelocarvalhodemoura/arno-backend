import { readFileSync } from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';

export type PixPayer = {
  nome?: string;
  cpf?: string;
  cnpj?: string;
};

export type PixReceived = {
  endToEndId: string;
  txid?: string;
  valor: string;
  horario: string;
  chave?: string;
  infoPagador?: string;
  pagador?: PixPayer;
};

export type SicrediStatus = {
  configured: boolean;
  mock: boolean;
  environment: 'production' | 'sandbox' | 'mock' | 'off';
  pixKeyMasked?: string;
  webhookReady: boolean;
};

type TokenCache = { accessToken: string; expiresAt: number };

let tokenCache: TokenCache | null = null;

export function sicrediConfig() {
  const mock = process.env.SICREDI_MOCK === '1' || process.env.SICREDI_MOCK === 'true';
  const clientId = process.env.SICREDI_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.SICREDI_CLIENT_SECRET?.trim() ?? '';
  const certPath = process.env.SICREDI_CERT_PATH?.trim() ?? '';
  const keyPath = process.env.SICREDI_KEY_PATH?.trim() ?? '';
  const caPath = process.env.SICREDI_CA_PATH?.trim() ?? '';
  const pixKey = process.env.SICREDI_PIX_KEY?.trim() ?? '';
  const apiBase = (process.env.SICREDI_API_BASE ?? 'https://api-pix.sicredi.com.br/api/v2').replace(/\/$/, '');
  const oauthUrl = process.env.SICREDI_OAUTH_URL ?? 'https://api-pix.sicredi.com.br/oauth/token';
  const webhookToken = process.env.SICREDI_WEBHOOK_TOKEN?.trim() ?? '';
  const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const live = Boolean(clientId && clientSecret && certPath && keyPath);
  return {
    mock,
    live,
    clientId,
    clientSecret,
    certPath,
    keyPath,
    caPath,
    pixKey,
    apiBase,
    oauthUrl,
    webhookToken,
    publicUrl,
  };
}

export function sicrediStatus(): SicrediStatus {
  const config = sicrediConfig();
  if (config.mock) {
    return {
      configured: true,
      mock: true,
      environment: 'mock',
      webhookReady: Boolean(config.webhookToken),
    };
  }
  if (!config.live) {
    return {
      configured: false,
      mock: false,
      environment: 'off',
      webhookReady: false,
    };
  }
  const sandbox = !config.apiBase.includes('api-pix.sicredi.com.br') || config.apiBase.includes('-h.');
  return {
    configured: true,
    mock: false,
    environment: sandbox ? 'sandbox' : 'production',
    pixKeyMasked: maskPixKey(config.pixKey),
    webhookReady: Boolean(config.webhookToken && config.publicUrl),
  };
}

export function maskPixKey(value: string) {
  const key = value.trim();
  if (!key) return undefined;
  if (key.length <= 6) return '••••';
  return `${key.slice(0, 3)}•••${key.slice(-3)}`;
}

export function brasiliaDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function pixDescription(pix: PixReceived) {
  return ['PIX RECEBIDO', pix.pagador?.nome, pix.infoPagador].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function pixDocument(pix: PixReceived) {
  return pix.pagador?.cpf || pix.pagador?.cnpj || '';
}

export function parsePixPayload(body: unknown): PixReceived[] {
  if (!body || typeof body !== 'object') return [];
  const payload = body as { pix?: unknown; endToEndId?: unknown };
  const list = Array.isArray(payload.pix) ? payload.pix : payload.endToEndId ? [payload] : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as PixReceived;
    if (!row.endToEndId) return [];
    return [
      {
        endToEndId: String(row.endToEndId),
        txid: row.txid ? String(row.txid) : undefined,
        valor: String(row.valor ?? ''),
        horario: String(row.horario ?? new Date().toISOString()),
        chave: row.chave ? String(row.chave) : undefined,
        infoPagador: row.infoPagador ? String(row.infoPagador) : undefined,
        pagador: row.pagador,
      },
    ];
  });
}

export function mockPixReceived(now = new Date(), extra: PixReceived[] = []): PixReceived[] {
  const day = brasiliaDate(now.toISOString()).replaceAll('-', '');
  const base: PixReceived[] = [
    {
      endToEndId: `E01181521${day}T000000000000001`,
      valor: '55.00',
      horario: now.toISOString(),
      infoPagador: 'Mensalidade',
      pagador: { nome: 'Helena Souza', cpf: '11144477735' },
    },
    {
      endToEndId: `E01181521${day}T000000000000002`,
      valor: '150.00',
      horario: now.toISOString(),
      infoPagador: 'Doação',
      pagador: { nome: 'Doação avulsa' },
    },
  ];
  return [...base, ...extra];
}

export function simulatedPix(now = new Date()): PixReceived {
  const stamp = brasiliaDate(now.toISOString()).replaceAll('-', '') + String(now.getTime()).slice(-8);
  return {
    endToEndId: `E01181521${stamp}`.padEnd(32, '0').slice(0, 32),
    valor: '60.00',
    horario: now.toISOString(),
    infoPagador: 'Pix simulado',
    pagador: { nome: 'Helena Souza', cpf: '11144477735' },
  };
}

export function webhookTokenOk(provided: string | undefined) {
  const expected = sicrediConfig().webhookToken;
  if (!expected) return false;
  return Boolean(provided) && provided === expected;
}

async function requestJson<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    cert?: Buffer;
    key?: Buffer;
    ca?: Buffer;
  },
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? 'GET',
        headers: options.headers,
        cert: options.cert,
        key: options.key,
        ca: options.ca,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk as Buffer));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data: T;
          try {
            data = text ? (JSON.parse(text) as T) : ({} as T);
          } catch {
            data = { raw: text } as T;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function tlsFiles() {
  const config = sicrediConfig();
  return {
    cert: readFileSync(config.certPath),
    key: readFileSync(config.keyPath),
    ca: config.caPath ? readFileSync(config.caPath) : undefined,
  };
}

async function accessToken() {
  const config = sicrediConfig();
  if (tokenCache && tokenCache.expiresAt > Date.now() + 15_000) return tokenCache.accessToken;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const tls = tlsFiles();
  const { status, data } = await requestJson<{
    access_token?: string;
    expires_in?: number;
    title?: string;
    detail?: string;
  }>(config.oauthUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=cob.read cob.write pix.read webhook.read webhook.write',
    cert: tls.cert,
    key: tls.key,
    ca: tls.ca,
  });
  if (status >= 400 || !data.access_token) {
    throw new Error(data.detail || data.title || `Falha ao autenticar no Sicredi (${status})`);
  }
  const expiresIn = Number(data.expires_in ?? 300);
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(30, expiresIn) * 1000,
  };
  return tokenCache.accessToken;
}

async function sicrediGet<T>(path: string) {
  const config = sicrediConfig();
  const token = await accessToken();
  const tls = tlsFiles();
  const { status, data } = await requestJson<T & { title?: string; detail?: string }>(`${config.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cert: tls.cert,
    key: tls.key,
    ca: tls.ca,
  });
  if (status >= 400) {
    throw new Error(data.detail || data.title || `Sicredi retornou ${status}`);
  }
  return data;
}

async function sicrediPut<T>(path: string, body: unknown) {
  const config = sicrediConfig();
  const token = await accessToken();
  const tls = tlsFiles();
  const { status, data } = await requestJson<T & { title?: string; detail?: string }>(`${config.apiBase}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cert: tls.cert,
    key: tls.key,
    ca: tls.ca,
  });
  if (status >= 400) {
    throw new Error(data.detail || data.title || `Sicredi retornou ${status}`);
  }
  return data;
}

export async function listReceivedPix(from: Date, to: Date): Promise<PixReceived[]> {
  const config = sicrediConfig();
  if (config.mock) return mockPixReceived(to);
  if (!config.live) throw new Error('API Pix do Sicredi ainda não está configurada');

  const collected: PixReceived[] = [];
  let page = 0;
  while (page < 50) {
    const params = new URLSearchParams({
      inicio: from.toISOString(),
      fim: to.toISOString(),
      'paginacao.paginaAtual': String(page),
      'paginacao.itensPorPagina': '100',
    });
    const data = await sicrediGet<{
      pix?: PixReceived[];
      parametros?: { paginacao?: { quantidadeDePaginas?: number } };
    }>(`/pix?${params.toString()}`);
    collected.push(...(data.pix ?? []));
    const pages = data.parametros?.paginacao?.quantidadeDePaginas ?? 1;
    page += 1;
    if (page >= pages) break;
  }
  return collected;
}

export async function getReceivedPix(endToEndId: string): Promise<PixReceived | null> {
  const config = sicrediConfig();
  if (config.mock) {
    return (
      mockPixReceived().find((item) => item.endToEndId === endToEndId) ?? {
        endToEndId,
        valor: '',
        horario: new Date().toISOString(),
      }
    );
  }
  if (!config.live) throw new Error('API Pix do Sicredi ainda não está configurada');
  return sicrediGet<PixReceived>(`/pix/${encodeURIComponent(endToEndId)}`);
}

export async function registerPixWebhook() {
  const config = sicrediConfig();
  if (config.mock) {
    return {
      webhookUrl: config.publicUrl ? `${config.publicUrl}/api/integrations/sicredi/webhook` : '',
    };
  }
  if (!config.live) throw new Error('API Pix do Sicredi ainda não está configurada');
  if (!config.pixKey) throw new Error('Informe SICREDI_PIX_KEY para registrar o webhook');
  if (!config.publicUrl) throw new Error('Informe PUBLIC_URL (HTTPS) para o Sicredi chamar o webhook');
  const webhookUrl = `${config.publicUrl}/api/integrations/sicredi/webhook${
    config.webhookToken ? `?token=${encodeURIComponent(config.webhookToken)}` : ''
  }`;
  await sicrediPut(`/webhook/${encodeURIComponent(config.pixKey)}`, {
    webhookUrl,
  });
  return { webhookUrl };
}
