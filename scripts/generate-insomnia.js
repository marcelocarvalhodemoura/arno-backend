#!/usr/bin/env node
/**
 * Gera a coleção Insomnia (export v4) da API de tesouraria.
 */
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const now = Date.now();
const wrk = "wrk_arno_tesouraria";
const env = "env_arno_base";

function folder(id, name, description, sort) {
  return {
    _id: id,
    parentId: wrk,
    modified: now,
    created: now,
    name,
    description,
    environment: {},
    environmentPropertyOrder: null,
    metaSortKey: sort,
    _type: "request_group",
  };
}

function req({
  id,
  parentId,
  name,
  method,
  url,
  description,
  body,
  query = [],
  auth = true,
  sort = 0,
}) {
  const headers = [];
  if (body) {
    headers.push({
      name: "Content-Type",
      value: "application/json",
      id: `${id}_ct`,
    });
  }
  return {
    _id: id,
    parentId,
    modified: now,
    created: now,
    url: `{{ _.base_url }}${url}`,
    name,
    description,
    method,
    body: body
      ? { mimeType: "application/json", text: JSON.stringify(body, null, 2) }
      : {},
    parameters: query.map((q, i) => ({
      name: q.name,
      value: q.value ?? "",
      description: q.description ?? "",
      disabled: Boolean(q.disabled),
      id: `${id}_q${i}`,
    })),
    headers,
    authentication: auth
      ? { type: "bearer", token: "{{ _.token }}", disabled: false }
      : { type: "none" },
    metaSortKey: sort,
    isPrivate: false,
    settingStoreCookies: true,
    settingSendCookies: true,
    settingDisableRenderRequestBody: false,
    settingEncodeUrl: true,
    settingRebuildPath: true,
    settingFollowRedirects: "global",
    _type: "request",
  };
}

const resources = [
  {
    _id: wrk,
    parentId: null,
    modified: now,
    created: now,
    name: "Arno Tesouraria API",
    description:
      "API NestJS da tesouraria do Grupo Escoteiro Arno Friedrich (43/RS).\n\n1. Importe este arquivo no Insomnia.\n2. Ajuste base_url, ADMIN_PASSWORD e o token do webhook no ambiente.\n3. Rode POST /api/auth/login e copie o token para a variável token.",
    scope: "collection",
    _type: "workspace",
  },
  {
    _id: env,
    parentId: wrk,
    modified: now,
    created: now,
    name: "Base Environment",
    data: {
      base_url: "http://127.0.0.1:4000",
      token: "",
      admin_user: "admin",
      admin_password: "defina-uma-senha-forte",
      tesoureiro_user: "tesouraria",
      webhook_token: "um-segredo-longo-para-o-webhook",
    },
    dataPropertyOrder: {
      "&": [
        "base_url",
        "token",
        "admin_user",
        "admin_password",
        "tesoureiro_user",
        "webhook_token",
      ],
    },
    color: "#2d8a4e",
    isPrivate: false,
    metaSortKey: 0,
    _type: "environment",
  },
];

const folders = [
  folder(
    "fld_saude",
    "Saúde e autenticação",
    "Health check público, login e sessão. Copie o token do login para a variável de ambiente `token`.",
    -1000,
  ),
  folder(
    "fld_usuarios",
    "Usuários (admin)",
    "Cadastro de administradores e tesoureiros. Exclusivo do perfil admin. Alterações pedem a senha atual do admin logado.",
    -900,
  ),
  folder(
    "fld_catalogo",
    "Catálogo e configurações",
    "Nome do grupo, saldo inicial, dia de vencimento da mensalidade, tipos de movimentação, taxas e metadados de ramos.",
    -800,
  ),
  folder(
    "fld_associados",
    "Associados",
    "Cadastro de associados, responsáveis (jovens) e contas de pagamento (PIX/banco). Importação em lotes de até 200 linhas.",
    -700,
  ),
  folder(
    "fld_caixa",
    "Fluxo de caixa",
    "Lançamentos manuais, conciliação (pago/pendente), responsável do jovem e rateio de um crédito em várias rubricas.",
    -600,
  ),
  folder(
    "fld_relatorios",
    "Painel e relatórios",
    "Dashboard (admin), fluxo de caixa mensal e relatório fiscal/customizado (admin).",
    -500,
  ),
  folder(
    "fld_projetos",
    "Projetos financeiros",
    "Orçamento planejado × realizado por ramo e ano. Criação e edição só para admin.",
    -400,
  ),
  folder(
    "fld_mensalidades",
    "Mensalidades",
    "Grade mar–dez com vencimento configurável. Sincroniza lançamentos pendentes e dispara cobrança/comprovante.",
    -300,
  ),
  folder(
    "fld_extrato",
    "Integração de extrato",
    "Leitura de CSV/PDF/planilha, mapeamento de colunas (com IA opcional) e ingestão de lançamentos em chunks de 200.",
    -200,
  ),
  folder(
    "fld_sicredi",
    "Sicredi Pix ao vivo",
    "Consulta, sincronização, simulação (SICREDI_MOCK=1), registro de webhook e recebimento público autenticado por token.",
    -100,
  ),
  folder(
    "fld_notify",
    "Notificações e WhatsApp",
    "Status dos canais (e-mail/WhatsApp), log de disparos e webhook da Meta (público, em /webhook e no caminho interno).",
    0,
  ),
];

const requests = [
  req({
    id: "req_health",
    parentId: "fld_saude",
    name: "Health check",
    method: "GET",
    url: "/api/health",
    description:
      "Público. Confirma que a API está no ar. Resposta: `{ ok: true, service: \"arno-financeiro\" }`.",
    auth: false,
    sort: -10,
  }),
  req({
    id: "req_login",
    parentId: "fld_saude",
    name: "Login",
    method: "POST",
    url: "/api/auth/login",
    description:
      "Público. Autentica por usuário/e-mail e senha. Devolve token HMAC (12h), papel (`admin` | `tesoureiro`), nome e nome do grupo. Cole o `token` no ambiente.",
    auth: false,
    body: { user: "{{ _.admin_user }}", password: "{{ _.admin_password }}" },
    sort: -9,
  }),
  req({
    id: "req_me",
    parentId: "fld_saude",
    name: "Sessão atual",
    method: "GET",
    url: "/api/auth/me",
    description: "Retorna usuário, papel e userId do token Bearer.",
    sort: -8,
  }),

  req({
    id: "req_users_list",
    parentId: "fld_usuarios",
    name: "Listar usuários",
    method: "GET",
    url: "/api/users",
    description: "Admin. Lista usuários com autores de criação/atualização.",
    sort: -10,
  }),
  req({
    id: "req_users_create",
    parentId: "fld_usuarios",
    name: "Criar usuário",
    method: "POST",
    url: "/api/users",
    description:
      "Admin. Cria admin ou tesoureiro. Senha mínima de 6 caracteres; `password` e `passwordConfirm` devem coincidir. Conflito 409 se usuário/e-mail já existir.",
    body: {
      username: "tesoureiro2",
      name: "Tesoureiro Adjunto",
      email: "tesoureiro2@arnofriedrich.org.br",
      password: "senha123",
      passwordConfirm: "senha123",
      role: "tesoureiro",
    },
    sort: -9,
  }),
  req({
    id: "req_users_patch",
    parentId: "fld_usuarios",
    name: "Atualizar usuário",
    method: "PATCH",
    url: "/api/users/:id",
    description:
      "Admin. Atualiza nome, e-mail, papel, ativo ou senha. `currentPassword` é a senha do admin logado (não a do usuário alvo).",
    body: {
      name: "Tesouraria do Grupo",
      currentPassword: "{{ _.admin_password }}",
    },
    sort: -8,
  }),
  req({
    id: "req_admin_reset",
    parentId: "fld_usuarios",
    name: "Resetar dados financeiros",
    method: "POST",
    url: "/api/admin/reset",
    description:
      "Admin. Apaga associados, lançamentos, projetos, taxas, tipos, movimentos bancários e a fila de e-mails. Mantém usuários. Uso de manutenção.",
    sort: -7,
  }),

  req({
    id: "req_settings_get",
    parentId: "fld_catalogo",
    name: "Ler configurações",
    method: "GET",
    url: "/api/settings",
    description: "Saldo inicial, nome do grupo e dia de vencimento da mensalidade (1–31, padrão 10).",
    sort: -10,
  }),
  req({
    id: "req_settings_patch",
    parentId: "fld_catalogo",
    name: "Alterar configurações",
    method: "PATCH",
    url: "/api/settings",
    description:
      "Tesoureiro só altera `mensalidadeDueDay`. Nome do grupo e saldo inicial exigem admin. Mudar o dia de vencimento reagenda mensalidades pendentes.",
    body: { mensalidadeDueDay: 10, openingBalance: 0, groupName: "Grupo Escoteiro Arno Friedrich" },
    sort: -9,
  }),
  req({
    id: "req_meta",
    parentId: "fld_catalogo",
    name: "Metadados de ramos",
    method: "GET",
    url: "/api/meta",
    description: "Lista ramos jovens (nome, unidade, cor) e todos os ramos incluindo Grupo.",
    sort: -8,
  }),
  req({
    id: "req_mt_list",
    parentId: "fld_catalogo",
    name: "Listar tipos de movimentação",
    method: "GET",
    url: "/api/movement-types",
    description: "Tipos usados em cada lançamento (mensalidade, sede, doação…). Inclui direção, PIX, ramo e autores.",
    sort: -7,
  }),
  req({
    id: "req_mt_create",
    parentId: "fld_catalogo",
    name: "Criar tipo de movimentação",
    method: "POST",
    url: "/api/movement-types",
    description:
      "`direction`: income | expense | both. `branch` padrão grupo. Nome duplicado retorna 409.",
    body: {
      name: "Doação",
      direction: "income",
      description: "Doações avulsas",
      pixKey: "",
      branch: "grupo",
    },
    sort: -6,
  }),
  req({
    id: "req_mt_patch",
    parentId: "fld_catalogo",
    name: "Atualizar tipo de movimentação",
    method: "PATCH",
    url: "/api/movement-types/:id",
    description: "Altera nome, direção, descrição, chave PIX, ramo ou ativo.",
    body: { active: true, description: "Doações avulsas ao grupo" },
    sort: -5,
  }),
  req({
    id: "req_fees_list",
    parentId: "fld_catalogo",
    name: "Listar taxas",
    method: "GET",
    url: "/api/fees",
    description:
      "Garante a tabela oficial da mensalidade (base, extra, pontualidade) e devolve todas as taxas cadastradas.",
    sort: -4,
  }),
  req({
    id: "req_fees_create",
    parentId: "fld_catalogo",
    name: "Criar taxa",
    method: "POST",
    url: "/api/fees",
    description: "Cadastra taxa avulsa (`name` + `amount` positivo). Nome duplicado: 409.",
    body: { name: "Taxa de acampamento", amount: 50 },
    sort: -3,
  }),
  req({
    id: "req_fees_patch",
    parentId: "fld_catalogo",
    name: "Atualizar taxa",
    method: "PATCH",
    url: "/api/fees/:id",
    description: "Altera nome e/ou valor da taxa.",
    body: { amount: 55 },
    sort: -2,
  }),
  req({
    id: "req_fees_delete",
    parentId: "fld_catalogo",
    name: "Excluir taxa",
    method: "DELETE",
    url: "/api/fees/:id",
    description: "Remove a taxa. 204 em sucesso, 404 se não existir.",
    sort: -1,
  }),

  req({
    id: "req_members_list",
    parentId: "fld_associados",
    name: "Listar associados",
    method: "GET",
    url: "/api/members",
    description:
      "Lista associados com contas e responsáveis. Query opcional: `branch` (ramo jovem) e `status` (active | inactive). Recalcula a mensalidade oficial (ramo + Clube LTC).",
    query: [
      { name: "branch", value: "escoteiro", disabled: true, description: "filhote | lobinho | escoteiro | senior | pioneiro | flor-de-lis" },
      { name: "status", value: "active", disabled: true, description: "active | inactive" },
    ],
    sort: -10,
  }),
  req({
    id: "req_members_create",
    parentId: "fld_associados",
    name: "Cadastrar associado",
    method: "POST",
    url: "/api/members",
    description:
      "Jovem exige pelo menos um responsável. Papéis: jovem | escotista | dirigente | clube. E-mail duplicado: 409.",
    body: {
      name: "João Silva",
      email: "joao@example.com",
      phone: "51999990000",
      branch: "escoteiro",
      role: "jovem",
      joinedAt: "2026-03-01",
      clubeLtc: false,
      guardians: [
        {
          name: "Maria Silva",
          relationship: "Mãe",
          phone: "51988880000",
          email: "maria@example.com",
        },
      ],
    },
    sort: -9,
  }),
  req({
    id: "req_members_patch",
    parentId: "fld_associados",
    name: "Atualizar associado",
    method: "PATCH",
    url: "/api/members/:id",
    description:
      "Campos parciais. Enviar `guardians` substitui a lista de responsáveis. Inativar cancela mensalidades futuras pendentes.",
    body: { clubeLtc: true, status: "active" },
    sort: -8,
  }),
  req({
    id: "req_accounts_create",
    parentId: "fld_associados",
    name: "Adicionar conta de pagamento",
    method: "POST",
    url: "/api/members/:id/accounts",
    description:
      "`holderKind`: parent | youth | other. Útil para PIX/CPF usados na conciliação do extrato e do Sicredi.",
    body: {
      holderName: "Maria Silva",
      holderKind: "parent",
      relationship: "Mãe",
      pixKey: "12345678900",
      bank: "Sicredi",
      agency: "0101",
      accountNumber: "12345-6",
      document: "12345678900",
      isPrimary: true,
    },
    sort: -7,
  }),
  req({
    id: "req_accounts_patch",
    parentId: "fld_associados",
    name: "Atualizar conta de pagamento",
    method: "PATCH",
    url: "/api/member-accounts/:id",
    description: "Atualização parcial da conta, inclusive `active`.",
    body: { active: true, isPrimary: true },
    sort: -6,
  }),
  req({
    id: "req_accounts_delete",
    parentId: "fld_associados",
    name: "Excluir conta de pagamento",
    method: "DELETE",
    url: "/api/member-accounts/:id",
    description: "Remove a conta. 204 em sucesso.",
    sort: -5,
  }),
  req({
    id: "req_members_import",
    parentId: "fld_associados",
    name: "Importar associados (chunk)",
    method: "POST",
    url: "/api/integrations/members",
    description:
      "Importa até 200 linhas por requisição (teto do arquivo: 10 mil). E-mail já existente atualiza responsáveis se houver novos; senão marca skipped.",
    body: {
      rows: [
        {
          name: "Ana Souza",
          email: "ana@example.com",
          phone: "51977770000",
          branch: "lobinho",
          role: "jovem",
          joinedAt: "2026-03-01",
          clubeLtc: false,
          guardians: [{ name: "Carlos Souza", relationship: "Pai", phone: "51966660000" }],
        },
      ],
    },
    sort: -4,
  }),

  req({
    id: "req_tx_list",
    parentId: "fld_caixa",
    name: "Listar lançamentos",
    method: "GET",
    url: "/api/transactions",
    description:
      "Filtros: `from`, `to` (YYYY-MM-DD), `branch`, `type` (income|expense), `nature` (fixed|variable). Inclui tipo, associado, conta e responsável.",
    query: [
      { name: "from", value: "2026-01-01" },
      { name: "to", value: "2026-12-31" },
      { name: "branch", value: "escoteiro", disabled: true },
      { name: "type", value: "income", disabled: true },
      { name: "nature", value: "fixed", disabled: true },
    ],
    sort: -10,
  }),
  req({
    id: "req_tx_create",
    parentId: "fld_caixa",
    name: "Lançar transação",
    method: "POST",
    url: "/api/transactions",
    description:
      "Lançamento manual. O tipo precisa aceitar a direção. Jovem pode levar `memberGuardianId`. `paymentStatus` padrão paid. `method`: pix | cash | transfer | card | other.",
    body: {
      date: "2026-04-10",
      type: "income",
      nature: "fixed",
      movementTypeId: "uuid-do-tipo",
      description: "Mensalidade abril — João Silva",
      amount: 75,
      branch: "escoteiro",
      method: "pix",
      paymentStatus: "paid",
      memberId: "uuid-do-associado",
    },
    sort: -9,
  }),
  req({
    id: "req_tx_patch",
    parentId: "fld_caixa",
    name: "Atualizar lançamento",
    method: "PATCH",
    url: "/api/transactions/:id",
    description:
      "Classifica ou concilia um lançamento (tipo, associado, ramo, pago/pendente). `notifyReceipt: true` dispara comprovante se houver e-mail/WhatsApp configurado.",
    body: {
      movementTypeId: "uuid-do-tipo",
      memberId: "uuid-do-associado",
      paymentStatus: "paid",
      notifyReceipt: false,
    },
    sort: -8,
  }),
  req({
    id: "req_tx_delete",
    parentId: "fld_caixa",
    name: "Excluir lançamento",
    method: "DELETE",
    url: "/api/transactions/:id",
    description: "Remove o lançamento. 204 em sucesso.",
    sort: -7,
  }),
  req({
    id: "req_tx_split",
    parentId: "fld_caixa",
    name: "Ratear lançamento",
    method: "POST",
    url: "/api/transactions/:id/split",
    description:
      "Divide um crédito/débito em no mínimo duas partes. A soma dos valores precisa ser igual ao lançamento original. A primeira parte atualiza o original; as demais geram novos lançamentos.",
    body: {
      parts: [
        { amount: 50, movementTypeId: "uuid-tipo-a", description: "Mensalidade" },
        { amount: 25, movementTypeId: "uuid-tipo-b", description: "Doação" },
      ],
    },
    sort: -6,
  }),

  req({
    id: "req_dashboard",
    parentId: "fld_relatorios",
    name: "Painel (dashboard)",
    method: "GET",
    url: "/api/dashboard",
    description:
      "Admin. Indicadores do período (mês/ano): saldo inicial, entradas, saídas, saldo atual, associados e totais por ramo, mais série do gráfico.",
    query: [
      { name: "year", value: "2026" },
      { name: "month", value: "4", description: "1–12; omita ou 0 para o ano inteiro conforme a regra do painel" },
    ],
    sort: -10,
  }),
  req({
    id: "req_cashflow",
    parentId: "fld_relatorios",
    name: "Relatório de fluxo de caixa",
    method: "GET",
    url: "/api/reports/cashflow",
    description: "Série mensal de entradas, saídas, líquido e saldo, com quebra por tipo e por ramo.",
    query: [
      { name: "from", value: "2026-01-01" },
      { name: "to", value: "2026-12-31" },
    ],
    sort: -9,
  }),
  req({
    id: "req_custom",
    parentId: "fld_relatorios",
    name: "Relatório fiscal / customizado",
    method: "POST",
    url: "/api/reports/custom",
    description:
      "Admin. Livro-caixa numerado com saldo acumulado. `groupBy`: none | month | branch | movementType | nature. Filtros vazios = todos.",
    body: {
      from: "2026-01-01",
      to: "2026-12-31",
      branches: [],
      types: [],
      natures: [],
      movementTypeIds: [],
      groupBy: "none",
    },
    sort: -8,
  }),

  req({
    id: "req_projects_list",
    parentId: "fld_projetos",
    name: "Listar projetos",
    method: "GET",
    url: "/api/projects",
    description: "Orçamentos com realizado (`actuals`) e total planejado. Filtros: `year`, `branch`.",
    query: [
      { name: "year", value: "2026", disabled: true },
      { name: "branch", value: "grupo", disabled: true },
    ],
    sort: -10,
  }),
  req({
    id: "req_projects_create",
    parentId: "fld_projetos",
    name: "Criar projeto",
    method: "POST",
    url: "/api/projects",
    description: "Admin. Itens podem vincular `movementTypeId` para casar o realizado dos lançamentos.",
    body: {
      branch: "escoteiro",
      year: 2026,
      name: "Jamboree 2026",
      description: "Orçamento da tropa para o jamboree",
      items: [
        { category: "Inscrição", description: "Taxa de inscrição", planned: 2000, movementTypeId: "" },
      ],
    },
    sort: -9,
  }),
  req({
    id: "req_projects_patch",
    parentId: "fld_projetos",
    name: "Atualizar projeto",
    method: "PATCH",
    url: "/api/projects/:id",
    description: "Admin. Enviar `items` substitui o orçamento (ids existentes são reaproveitados).",
    body: { name: "Jamboree 2026 — revisão" },
    sort: -8,
  }),

  req({
    id: "req_mens_get",
    parentId: "fld_mensalidades",
    name: "Grade de mensalidades",
    method: "GET",
    url: "/api/mensalidades",
    description:
      "Sincroniza o ano (lança pendências mar–dez conforme tabela oficial) e devolve a grade com status paid | pending | overdue | none.",
    query: [{ name: "year", value: "2026" }],
    sort: -10,
  }),
  req({
    id: "req_mens_notify",
    parentId: "fld_mensalidades",
    name: "Disparar cobrança ou comprovante",
    method: "POST",
    url: "/api/mensalidades/notify",
    description:
      "`kind`: charge (pendente/atrasado) ou receipt (pago). Filtra por `month`, `memberIds` e/ou `transactionIds`. Canais: email | whatsapp. Sem `channels`, usa o que estiver configurado (MAIL_HOST / WhatsApp).",
    body: { year: 2026, month: 4, kind: "charge" },
    sort: -9,
  }),

  req({
    id: "req_interpret",
    parentId: "fld_extrato",
    name: "Interpretar extrato (CSV ou PDF)",
    method: "POST",
    url: "/api/integrations/interpret-statement",
    description:
      "Envia `csv` (texto) ou `pdf` (base64). Detecta colunas, sugere tipo/ramo/associado/responsável e devolve amostragem. `convertOnly` só converte PDF. `enrichAi` usa OpenAI se houver chave. Máx. ~7 MB CSV / ~10 MB PDF.",
    body: { csv: "Data;Historico;Valor\n10/04/2026;PIX JOAO SILVA;75,00", enrichAi: false },
    sort: -10,
  }),
  req({
    id: "req_map_import",
    parentId: "fld_extrato",
    name: "Mapear colunas da planilha",
    method: "POST",
    url: "/api/integrations/map-import",
    description:
      "`kind`: members | statement. Sem `mapping`, devolve revisão + amostragem (e IA se configurada). Com `mapping`, reaplica o mapa e gera CSV canônico.",
    body: { csv: "Nome;E-mail;Telefone;Ramo\nAna;ana@ex.com;5199999;Lobinho", kind: "members" },
    sort: -9,
  }),
  req({
    id: "req_tx_import",
    parentId: "fld_extrato",
    name: "Ingerir lançamentos do extrato",
    method: "POST",
    url: "/api/integrations/transactions",
    description:
      "Chunk de até 200 linhas. Concilia mensalidade (nome/responsável/PIX/CPF + valor pontual ou atrasado). Linhas sem tipo claro entram como Não identificado. Origem: integration.",
    body: {
      rows: [
        {
          date: "2026-04-10",
          type: "income",
          nature: "variable",
          movementTypeId: "uuid-tipo",
          description: "PIX JOAO SILVA",
          amount: 75,
          branch: "escoteiro",
          method: "pix",
          paymentStatus: "paid",
        },
      ],
    },
    sort: -8,
  }),

  req({
    id: "req_sicredi_get",
    parentId: "fld_sicredi",
    name: "Visão Sicredi",
    method: "GET",
    url: "/api/integrations/sicredi",
    description:
      "Status da integração, movimentos Pix do período e conciliação (matched / imported / pending). Sem `from`/`to`, usa o mês corrente (America/Sao_Paulo).",
    query: [
      { name: "from", value: "2026-04-01", disabled: true },
      { name: "to", value: "2026-04-30", disabled: true },
    ],
    sort: -10,
  }),
  req({
    id: "req_sicredi_sync",
    parentId: "fld_sicredi",
    name: "Sincronizar Pix agora",
    method: "POST",
    url: "/api/integrations/sicredi/sync",
    description:
      "Consulta GET /pix (Bacen) no Sicredi ou o mock. Concilia mensalidade pendente ou lança no caixa (origem sicredi, pago).",
    body: { from: "2026-04-01", to: "2026-04-30" },
    sort: -9,
  }),
  req({
    id: "req_sicredi_sim",
    parentId: "fld_sicredi",
    name: "Simular Pix recebido",
    method: "POST",
    url: "/api/integrations/sicredi/simulate",
    description: "Só com SICREDI_MOCK=1. Injeta um Pix fictício para treinar conciliação e o caixa ao vivo.",
    sort: -8,
  }),
  req({
    id: "req_sicredi_reg",
    parentId: "fld_sicredi",
    name: "Registrar webhook Pix",
    method: "POST",
    url: "/api/integrations/sicredi/webhook/register",
    description:
      "Registra na cooperativa a URL `PUBLIC_URL/api/integrations/sicredi/webhook?token=SICREDI_WEBHOOK_TOKEN`.",
    sort: -7,
  }),
  req({
    id: "req_sicredi_wh",
    parentId: "fld_sicredi",
    name: "Webhook Pix (público)",
    method: "POST",
    url: "/api/integrations/sicredi/webhook",
    description:
      "Público, autenticado por `token` na query (SICREDI_WEBHOOK_TOKEN). Corpo no formato de notificação Pix do Sicredi/Bacen.",
    auth: false,
    query: [{ name: "token", value: "{{ _.webhook_token }}" }],
    body: { pix: [] },
    sort: -6,
  }),

  req({
    id: "req_notify_status",
    parentId: "fld_notify",
    name: "Status dos canais",
    method: "GET",
    url: "/api/notify/status",
    description: "Indica se e-mail e WhatsApp estão configurados e quantos disparos estão na fila (outbox).",
    sort: -10,
  }),
  req({
    id: "req_notify_log",
    parentId: "fld_notify",
    name: "Histórico de disparos",
    method: "GET",
    url: "/api/notify/log",
    description: "Últimos envios (cobrança/comprovante). `limit` padrão 40.",
    query: [{ name: "limit", value: "40" }],
    sort: -9,
  }),
  req({
    id: "req_wa_verify",
    parentId: "fld_notify",
    name: "WhatsApp — verificação (GET)",
    method: "GET",
    url: "/webhook",
    description:
      "Público. Handshake da Meta (`hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`). Sem query devolve `{ ok, service }`. Também disponível em /api/integrations/whatsapp/webhook.",
    auth: false,
    query: [
      { name: "hub.mode", value: "subscribe", disabled: true },
      { name: "hub.verify_token", value: "o-mesmo-segredo-do-painel-da-meta", disabled: true },
      { name: "hub.challenge", value: "12345", disabled: true },
    ],
    sort: -8,
  }),
  req({
    id: "req_wa_event",
    parentId: "fld_notify",
    name: "WhatsApp — evento (POST)",
    method: "POST",
    url: "/webhook",
    description:
      "Público. Recebe mensagens da Cloud API. Responde texto EVENT_RECEIVED. Objeto que não for whatsapp_business_account retorna 404. Espelho em /api/integrations/whatsapp/webhook.",
    auth: false,
    body: { object: "whatsapp_business_account", entry: [] },
    sort: -7,
  }),
  req({
    id: "req_wa_verify_api",
    parentId: "fld_notify",
    name: "WhatsApp — verificação (caminho /api)",
    method: "GET",
    url: "/api/integrations/whatsapp/webhook",
    description: "Mesmo GET de verificação da Meta, no caminho interno da API.",
    auth: false,
    sort: -6,
  }),
  req({
    id: "req_wa_event_api",
    parentId: "fld_notify",
    name: "WhatsApp — evento (caminho /api)",
    method: "POST",
    url: "/api/integrations/whatsapp/webhook",
    description: "Mesmo POST de eventos da Meta, no caminho interno da API.",
    auth: false,
    body: { object: "whatsapp_business_account", entry: [] },
    sort: -5,
  }),
];

resources.push(...folders, ...requests);

const exportDoc = {
  _type: "export",
  __export_format: 4,
  __export_date: new Date().toISOString(),
  __export_source: "arno-backend:insomnia-generator",
  resources,
};

const outDir = join(__dirname, "..");
const outFile = join(outDir, "insomnia", "arno-tesouraria-api.json");
mkdirSync(join(outDir, "insomnia"), { recursive: true });
writeFileSync(outFile, JSON.stringify(exportDoc, null, 2));
console.log(`Coleção Insomnia gerada: ${outFile}`);
console.log(`Pastas: ${folders.length} | Requisições: ${requests.length}`);
