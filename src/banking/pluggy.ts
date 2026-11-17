// Agregador Open Finance (Pluggy): extrato da conta PJ Sicredi com entradas e saídas.
// Docs: https://docs.pluggy.ai — auth por clientId/clientSecret → X-API-KEY.

export type PluggyParty = {
  name?: string;
  documentNumber?: { type?: string; value?: string };
};

export type PluggyTransaction = {
  id: string;
  accountId?: string;
  date: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  status?: 'POSTED' | 'PENDING';
  category?: string | null;
  paymentData?: {
    payer?: PluggyParty | null;
    receiver?: PluggyParty | null;
    paymentMethod?: string | null;
    reason?: string | null;
  } | null;
};

export type PluggyAccount = {
  id: string;
  type: 'BANK' | 'CREDIT';
  subtype?: string;
  name: string;
  number?: string;
};

export type PluggyStatus = {
  configured: boolean;
  mock: boolean;
  environment: 'live' | 'mock' | 'off';
};

type KeyCache = { apiKey: string; expiresAt: number };

let keyCache: KeyCache | null = null;

// A documentação não informa a validade da API key; renovamos bem antes das 2h usuais.
const KEY_TTL_MS = 90 * 60 * 1000;

export function pluggyConfig() {
  const mock = process.env.PLUGGY_MOCK === '1' || process.env.PLUGGY_MOCK === 'true';
  const clientId = process.env.PLUGGY_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET?.trim() ?? '';
  const itemId = process.env.PLUGGY_ITEM_ID?.trim() ?? '';
  const accountId = process.env.PLUGGY_ACCOUNT_ID?.trim() ?? '';
  const apiBase = (process.env.PLUGGY_API_BASE ?? 'https://api.pluggy.ai').replace(/\/$/, '');
  const live = Boolean(clientId && clientSecret && (itemId || accountId));
  return { mock, live, clientId, clientSecret, itemId, accountId, apiBase };
}

export function pluggyStatus(): PluggyStatus {
  const config = pluggyConfig();
  if (config.mock) return { configured: true, mock: true, environment: 'mock' };
  if (!config.live) return { configured: false, mock: false, environment: 'off' };
  return { configured: true, mock: false, environment: 'live' };
}

export function mockPluggyTransactions(month: string): PluggyTransaction[] {
  return [
    {
      id: `mock-${month}-1`,
      date: `${month}-05T00:00:00.000Z`,
      description: 'PIX RECEBIDO HELENA SOUZA',
      amount: 55,
      type: 'CREDIT',
      status: 'POSTED',
      paymentData: {
        payer: { name: 'Helena Souza', documentNumber: { type: 'CPF', value: '11144477735' } },
        paymentMethod: 'PIX',
      },
    },
    {
      id: `mock-${month}-2`,
      date: `${month}-10T00:00:00.000Z`,
      description: 'LIQUIDACAO BOLETO',
      amount: 150,
      type: 'CREDIT',
      status: 'POSTED',
      paymentData: null,
    },
    {
      id: `mock-${month}-3`,
      date: `${month}-12T00:00:00.000Z`,
      description: 'PIX ENVIADO MATERIAL DE ACAMPAMENTO',
      amount: -89.9,
      type: 'DEBIT',
      status: 'POSTED',
      paymentData: {
        receiver: { name: 'Loja Aventura Ltda', documentNumber: { type: 'CNPJ', value: '11222333000181' } },
        paymentMethod: 'PIX',
      },
    },
    {
      id: `mock-${month}-4`,
      date: `${month}-15T00:00:00.000Z`,
      description: 'TARIFA PACOTE SERVICOS',
      amount: -32.5,
      type: 'DEBIT',
      status: 'POSTED',
      paymentData: null,
    },
  ];
}

async function apiKey() {
  const config = pluggyConfig();
  if (keyCache && keyCache.expiresAt > Date.now()) return keyCache.apiKey;
  const response = await fetch(`${config.apiBase}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
  });
  const data = (await response.json().catch(() => ({}))) as { apiKey?: string; message?: string };
  if (!response.ok || !data.apiKey) {
    throw new Error(data.message || `Falha ao autenticar no Pluggy (${response.status})`);
  }
  keyCache = { apiKey: data.apiKey, expiresAt: Date.now() + KEY_TTL_MS };
  return keyCache.apiKey;
}

async function pluggyGet<T>(path: string): Promise<T> {
  const config = pluggyConfig();
  const response = await fetch(`${config.apiBase}${path}`, {
    headers: { 'X-API-KEY': await apiKey(), 'Content-Type': 'application/json' },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) keyCache = null;
    throw new Error(data.message || `Pluggy retornou ${response.status}`);
  }
  return data;
}

export async function listPluggyAccounts(itemId: string) {
  const data = await pluggyGet<{ results?: PluggyAccount[] }>(
    `/accounts?${new URLSearchParams({ itemId, type: 'BANK' }).toString()}`,
  );
  return data.results ?? [];
}

/** Conta corrente do item conectado (ou PLUGGY_ACCOUNT_ID, se informado). */
export async function resolvePluggyAccountId() {
  const config = pluggyConfig();
  if (config.accountId) return config.accountId;
  const accounts = await listPluggyAccounts(config.itemId);
  const account = accounts.find((item) => item.subtype === 'CHECKING_ACCOUNT') ?? accounts[0];
  if (!account) throw new Error('Nenhuma conta bancária encontrada no Pluggy para este item');
  return account.id;
}

/** Transações de um período (datas yyyy-mm-dd, inclusivas), paginando pelo cursor da v2. */
export async function listPluggyTransactions(month: string, from: string, to: string): Promise<PluggyTransaction[]> {
  const config = pluggyConfig();
  if (config.mock) return mockPluggyTransactions(month);
  if (!config.live) throw new Error('Pluggy ainda não está configurado');

  const accountId = await resolvePluggyAccountId();
  const collected: PluggyTransaction[] = [];
  let query: string | null = `?${new URLSearchParams({ accountId, dateFrom: from, dateTo: to }).toString()}`;
  let pages = 0;
  while (query && pages < 50) {
    const data: { results?: PluggyTransaction[]; next?: string | null } = await pluggyGet(`/v2/transactions${query}`);
    collected.push(...(data.results ?? []));
    // `next` já vem pronto para anexar ao path (com accountId e o cursor `after`).
    query = data.next ? (data.next.startsWith('?') ? data.next : `?${data.next}`) : null;
    pages += 1;
  }
  return collected;
}
