/** Nomes das telas (rotas do frontend) para a auditoria. */
export const SCREEN_LABELS: Record<string, string> = {
  '/': 'Painel',
  '/fluxo': 'Fluxo de caixa',
  '/mensalidades': 'Mensalidades',
  '/repasse-clube': 'Repasse ao clube',
  '/taxa-lanche': 'Taxa do lanche',
  '/dividas': 'Dívidas',
  '/tipos': 'Tipos de movimentação',
  '/taxas': 'Taxas',
  '/projetos': 'Previsão de gastos',
  '/associados': 'Associados',
  '/usuarios': 'Usuários',
  '/relatorios': 'Relatórios',
  '/integracao': 'Integrações',
  '/configuracoes': 'Disparos de mensagem',
  '/auditoria': 'Auditoria',
};

export function screenLabel(path: string): string {
  return SCREEN_LABELS[path] ?? path;
}

/** Ações (rotas da API que gravam) em linguagem de quem usa o sistema. */
const ACTION_LABELS: [RegExp, string][] = [
  [/^POST \/api\/transactions$/, 'Lançamento criado'],
  [/^PATCH \/api\/transactions\/:id$/, 'Lançamento alterado'],
  [/^DELETE \/api\/transactions\/:id$/, 'Lançamento excluído'],
  [/^POST \/api\/transactions\/:id\/split$/, 'Lançamento rateado'],
  [/^POST \/api\/transactions\/:id\/nota$/, 'Nota anexada'],
  [/^DELETE \/api\/transactions\/:id\/nota$/, 'Nota removida'],
  [/^POST \/api\/trash\/:id\/restore$/, 'Lançamento restaurado da lixeira'],
  [/^DELETE \/api\/trash$/, 'Lixeira esvaziada'],
  [/^POST \/api\/month-closings$/, 'Mês fechado'],
  [/^DELETE \/api\/month-closings\/:yearMonth$/, 'Mês reaberto'],
  [/^POST \/api\/duplicates\/(resolve|dismiss)$/, 'Duplicado revisado'],
  [/^POST \/api\/reconciliation\/confirm$/, 'Conciliação confirmada'],
  [/^POST \/api\/reconciliation\/dismiss$/, 'Sugestão de conciliação recusada'],
  [/^PATCH \/api\/mensalidades\/settle$/, 'Mensalidade baixada'],
  [/^POST \/api\/mensalidades\/allocate$/, 'Pix rateado em mensalidades'],
  [/^POST \/api\/mensalidades\/generate$/, 'Cobranças do ano geradas'],
  [/^PATCH \/api\/mensalidades\/club-fee/, 'Taxa do clube alterada'],
  [/^POST \/api\/mensalidades\/notify$/, 'Cobrança ou recibo enviado'],
  [/^(POST|PATCH|DELETE) \/api\/members/, 'Cadastro de associado alterado'],
  [/^(POST|PATCH|DELETE) \/api\/arrears/, 'Acordo de dívida alterado'],
  [/^(POST|PATCH|DELETE) \/api\/movement-types/, 'Tipo de movimentação alterado'],
  [/^(POST|PATCH|DELETE) \/api\/fees/, 'Taxa alterada'],
  [/^(POST|PATCH|DELETE) \/api\/projects/, 'Previsão de gastos alterada'],
  [/^(POST|PATCH|DELETE) \/api\/users/, 'Usuário alterado'],
  [/^POST \/api\/reports\//, 'Relatório gerado'],
  [/^(POST|PATCH) \/api\/settings/, 'Configurações alteradas'],
  [/^POST \/api\/(statement|import|integrations)/, 'Importação ou sincronização'],
];

export function actionLabel(method: string, path: string): string {
  const key = `${method} ${path}`;
  return ACTION_LABELS.find(([pattern]) => pattern.test(key))?.[1] ?? key;
}
