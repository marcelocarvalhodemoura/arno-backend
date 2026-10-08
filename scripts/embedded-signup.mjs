// Página local do Cadastro Incorporado (Embedded Signup) da Meta, no modo coexistência:
// conecta o número do app WhatsApp Business à Cloud API sem tirá-lo do celular.
// Uso: node scripts/embedded-signup.mjs  (porta 3001; exponha em HTTPS com um túnel)
// Precisa no .env: WHATSAPP_APP_ID, WHATSAPP_APP_SECRET e WHATSAPP_ES_CONFIG_ID.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';

const GRAPH = 'https://graph.facebook.com/v21.0';
const OUT = new URL('../.embedded-signup.json', import.meta.url);

function env() {
  const vars = {};
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) vars[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return vars;
}

function save(patch) {
  let current = {};
  try {
    current = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {}
  writeFileSync(OUT, JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2));
}

function page({ WHATSAPP_APP_ID: appId, WHATSAPP_ES_CONFIG_ID: configId }) {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Arno — conectar WhatsApp Business</title>
<style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:0 16px}button{font-size:18px;padding:12px 20px}pre{background:#f4f4f4;padding:12px;white-space:pre-wrap}</style>
</head>
<body>
<h1>Conectar o WhatsApp Business ao Arno</h1>
<p>Escolha a opção de conectar o aplicativo WhatsApp Business existente e escaneie o QR code pelo celular.</p>
<button onclick="launch()" ${appId && configId ? '' : 'disabled'}>Conectar</button>
<p><a href="/aba">Conectar sem janela pop-up (abre nesta aba)</a></p>
${appId && configId ? '' : '<p><b>Faltam WHATSAPP_APP_ID ou WHATSAPP_ES_CONFIG_ID no .env.</b></p>'}
<pre id="log"></pre>
<script>
const log = (text) => (document.getElementById('log').textContent += text + '\\n');
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
window.addEventListener('message', (event) => {
  if (!event.origin.endsWith('facebook.com')) return;
  let data = event.data;
  try {
    data = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return;
  }
  if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
  // FINISH* traz waba_id e phone_number_id; CANCEL/ERROR dizem onde o fluxo parou.
  log('Sessão: ' + JSON.stringify(data));
  post('/session', data);
});
window.fbAsyncInit = () => FB.init({ appId: '${appId ?? ''}', autoLogAppEvents: true, xfbml: true, version: 'v21.0' });
function launch() {
  FB.login((response) => {
    const code = response.authResponse && response.authResponse.code;
    if (!code) return log('Cadastro cancelado ou sem código: ' + JSON.stringify(response));
    log('Código recebido, trocando por token...');
    post('/exchange', { code, pageUrl: window.location.href }).then((r) => r.text()).then(log);
  }, {
    config_id: '${configId ?? ''}',
    response_type: 'code',
    override_default_response_type: true,
    extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
  });
}
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/pt_BR/sdk.js"></script>
</body>
</html>`;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

createServer(async (req, res) => {
  try {
    const vars = env();
    const here = new URL(req.url, `https://${req.headers['x-forwarded-host'] ?? req.headers.host}`);
    // Cadastro em aba normal (sem pop-up): a Meta volta para esta mesma página com ?code=, e a troca usa
    // exatamente o mesmo redirect_uri — evita o erro 36008 do código emitido pelo SDK em JS.
    const redirectUri = `${here.origin}/`;
    if (req.method === 'GET' && here.pathname === '/aba') {
      const dialog = new URL('https://www.facebook.com/v21.0/dialog/oauth');
      dialog.search = new URLSearchParams({
        client_id: vars.WHATSAPP_APP_ID,
        config_id: vars.WHATSAPP_ES_CONFIG_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        override_default_response_type: 'true',
        extras: JSON.stringify({ setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }),
      }).toString();
      res.writeHead(302, { Location: dialog.toString() });
      return res.end();
    }
    if (req.method === 'GET' && here.pathname === '/' && here.searchParams.has('code')) {
      const url = new URL(`${GRAPH}/oauth/access_token`);
      url.search = new URLSearchParams({
        client_id: vars.WHATSAPP_APP_ID,
        client_secret: vars.WHATSAPP_APP_SECRET,
        redirect_uri: redirectUri,
        code: here.searchParams.get('code'),
      }).toString();
      const result = await (await fetch(url)).json();
      console.log('Troca (aba):', result.access_token ? 'ok' : JSON.stringify(result.error));
      if (result.access_token) save({ businessToken: result.access_token });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(result.access_token ? 'Pronto! Cadastro concluído. Pode fechar esta página.' : `Falha: ${JSON.stringify(result.error)}`);
    }
    if (req.method === 'GET' && here.pathname === '/' && here.searchParams.has('error')) {
      console.log('Cadastro (aba) cancelado:', here.search);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`Cadastro não concluído: ${here.searchParams.get('error_description') ?? here.searchParams.get('error')}`);
    }
    if (req.method === 'GET' && here.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(page(vars));
    }
    if (req.method === 'POST' && req.url === '/session') {
      const data = await readJson(req);
      save({ session: data });
      console.log('Sessão do cadastro:', JSON.stringify(data));
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && req.url === '/exchange') {
      const { code, pageUrl } = await readJson(req);
      // Código do SDK em JS: a Meta às vezes exige o redirect_uri igual à página que abriu o login
      // (erro 36008). Tenta com a página, com a origem e sem redirect_uri.
      const origin = pageUrl ? new URL(pageUrl).origin + '/' : '';
      let result = {};
      for (const redirect of [pageUrl, origin, ''].filter((item, index, list) => list.indexOf(item) === index)) {
        const url = new URL(`${GRAPH}/oauth/access_token`);
        const params = { client_id: vars.WHATSAPP_APP_ID, client_secret: vars.WHATSAPP_APP_SECRET, code };
        if (redirect) params.redirect_uri = redirect;
        url.search = new URLSearchParams(params).toString();
        result = await (await fetch(url)).json();
        console.log(`Troca com redirect_uri=${redirect || '(nenhum)'}:`, result.access_token ? 'ok' : JSON.stringify(result.error));
        if (result.access_token) break;
      }
      if (!result.access_token) {
        console.log('Falha na troca do código:', JSON.stringify(result));
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Falha na troca do código: ' + JSON.stringify(result.error ?? result));
      }
      save({ businessToken: result.access_token });
      console.log('Token de integração recebido e salvo em .embedded-signup.json');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Pronto! Número conectado. Pode fechar esta página.');
    }
    res.writeHead(404);
    res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end(String(error));
  }
}).listen(3001, () => console.log('Cadastro incorporado em http://127.0.0.1:3001'));
