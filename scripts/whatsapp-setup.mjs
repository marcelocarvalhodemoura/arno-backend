// Confere (e, com --apply, ajusta) a configuração do WhatsApp na Meta:
// token, número, assinatura do app na conta WhatsApp (WABA) e webhook.
// Uso: node scripts/whatsapp-setup.mjs           só confere
//      node scripts/whatsapp-setup.mjs --apply   assina o app na WABA e cadastra o webhook
// Lê do .env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID,
// WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_ID, WHATSAPP_APP_SECRET e PUBLIC_URL.
import { readFileSync } from 'node:fs';

const GRAPH = 'https://graph.facebook.com/v21.0';
const apply = process.argv.includes('--apply');
let problems = 0;

function env() {
  const vars = {};
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) vars[match[1]] = match[2].replace(/^"|"$/g, '').trim();
  }
  return vars;
}

const ok = (text) => console.log(`  ✔ ${text}`);
const info = (text) => console.log(`  · ${text}`);
function bad(text, fix) {
  problems += 1;
  console.log(`  ✘ ${text}`);
  if (fix) console.log(`    → ${fix}`);
}

async function graph(path, token, init = {}) {
  const response = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
  return body;
}

const vars = env();
const token = vars.WHATSAPP_TOKEN;
const phoneId = vars.WHATSAPP_PHONE_NUMBER_ID;
const wabaId = vars.WHATSAPP_BUSINESS_ACCOUNT_ID;
const appId = vars.WHATSAPP_APP_ID;
const appSecret = vars.WHATSAPP_APP_SECRET;
const verifyToken = vars.WHATSAPP_VERIFY_TOKEN;
const publicUrl = (vars.PUBLIC_URL ?? '').replace(/\/$/, '');
const appToken = appId && appSecret ? `${appId}|${appSecret}` : '';

console.log('\n1. Token');
let tokenOk = false;
if (!token) {
  bad('WHATSAPP_TOKEN vazio', 'gere o token permanente do Usuário do Sistema (plano-whatsapp-notas.md, passo 2.3)');
} else {
  try {
    const { data } = await graph(`/debug_token?input_token=${encodeURIComponent(token)}`, appToken || token);
    tokenOk = Boolean(data?.is_valid);
    if (!tokenOk) bad('token inválido', 'gere um novo token permanente');
    else if (!data.expires_at) ok(`token permanente (${data.type ?? 'tipo ?'})`);
    else {
      const when = new Date(data.expires_at * 1000).toLocaleString('pt-BR');
      bad(`token temporário, expira em ${when}`, 'troque pelo token do Usuário do Sistema com validade "Nunca"');
    }
    const scopes = data?.scopes ?? [];
    for (const scope of ['whatsapp_business_messaging', 'whatsapp_business_management']) {
      if (scopes.length && !scopes.includes(scope)) bad(`token sem a permissão ${scope}`);
    }
  } catch (error) {
    bad(`token recusado pela Meta: ${error.message}`, 'gere o token permanente e grave em WHATSAPP_TOKEN');
  }
}

console.log('\n2. Número');
if (tokenOk && phoneId) {
  try {
    const phone = await graph(
      `/${phoneId}?fields=display_phone_number,verified_name,status,platform_type,code_verification_status,quality_rating`,
      token,
    );
    info(`${phone.display_phone_number} · ${phone.verified_name} · status ${phone.status ?? '?'}`);
    if (String(phone.display_phone_number).replace(/\D/g, '').startsWith('1555')) {
      bad('é o número de teste da Meta (só envia para 5 destinatários cadastrados)', 'conecte o (51) 98055-3559 pela coexistência (coexistencia-passos.txt)');
    } else ok('número real');
    if (phone.platform_type && phone.platform_type !== 'CLOUD_API') bad(`plataforma ${phone.platform_type}, esperado CLOUD_API`);
  } catch (error) {
    bad(`não consegui ler o número ${phoneId}: ${error.message}`);
  }
} else if (!phoneId) bad('WHATSAPP_PHONE_NUMBER_ID vazio');
else info('pulado (token inválido)');

console.log('\n3. App assinado na conta WhatsApp (WABA)');
if (tokenOk && wabaId) {
  try {
    const { data = [] } = await graph(`/${wabaId}/subscribed_apps`, token);
    const subscribed = data.some((item) => item.whatsapp_business_api_data?.id === appId);
    if (subscribed) ok('app assinado: as mensagens reais chegam no webhook');
    else if (apply) {
      await graph(`/${wabaId}/subscribed_apps`, token, { method: 'POST' });
      ok('app assinado agora');
    } else bad('app não assinado na WABA', 'rode de novo com --apply');
  } catch (error) {
    bad(`não consegui ler as assinaturas da WABA: ${error.message}`);
  }
} else if (!wabaId) bad('WHATSAPP_BUSINESS_ACCOUNT_ID vazio');
else info('pulado (token inválido)');

console.log('\n4. Webhook');
const callback = publicUrl ? `${publicUrl}/webhook` : '';
if (!publicUrl) {
  bad('PUBLIC_URL vazia', 'use o domínio HTTPS da API ou, para testar, um túnel: ngrok http 3000');
} else if (!verifyToken) {
  bad('WHATSAPP_VERIFY_TOKEN vazio');
} else {
  try {
    const challenge = String(Date.now());
    const url = `${callback}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${challenge}`;
    const response = await fetch(url, { headers: { 'ngrok-skip-browser-warning': '1' } });
    const text = await response.text();
    if (response.ok && text === challenge) ok(`${callback} responde ao desafio da Meta`);
    else bad(`${callback} respondeu HTTP ${response.status}`, 'confira se a API está no ar e se o túnel aponta para a porta certa');
  } catch (error) {
    bad(`${callback} inacessível: ${error.message}`, 'a API precisa estar no ar e pública em HTTPS');
  }
}
if (!appToken) {
  bad('WHATSAPP_APP_SECRET vazio: não dá para conferir o webhook cadastrado no app', 'copie a Chave Secreta em Configurações do app > Básico');
} else if (callback && verifyToken) {
  try {
    const { data = [] } = await graph(`/${appId}/subscriptions`, appToken);
    const current = data.find((item) => item.object === 'whatsapp_business_account');
    const hasMessages = current?.fields?.some((field) => (field.name ?? field) === 'messages');
    if (current?.callback_url === callback && current.active && hasMessages) ok('webhook cadastrado no app com o campo messages');
    else if (apply) {
      const body = new URLSearchParams({
        object: 'whatsapp_business_account',
        callback_url: callback,
        verify_token: verifyToken,
        fields: 'messages',
      });
      await graph(`/${appId}/subscriptions`, appToken, { method: 'POST', body });
      ok(`webhook cadastrado: ${callback}`);
    } else {
      bad(
        current ? `webhook aponta para ${current.callback_url}` : 'webhook não cadastrado no app',
        'rode de novo com --apply',
      );
    }
  } catch (error) {
    bad(`não consegui ler o webhook do app: ${error.message}`);
  }
}

console.log('\n5. Feito só no painel (a API não permite conferir)');
info('app em modo "Ao vivo" (developers.facebook.com > app > topo da página)');
info('teste final: mande "oi" para o número e veja "WhatsApp text de ..." no log da API');

console.log(problems ? `\n${problems} pendência(s).\n` : '\nTudo certo.\n');
process.exitCode = problems ? 1 : 0;
