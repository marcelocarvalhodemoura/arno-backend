import {
  csvCells,
  csvLines,
  fold,
  normalizeHeader,
  parseCsv,
  parseIsoDate,
  parseSignedAmount,
  type CsvTable,
} from '../shared/csv';
import { aiConfigured, chatJson } from '../shared/openai';
import { isTemplate } from './statement';

export type ImportKind = 'members' | 'statement';

export type CanonicalField =
  | 'date'
  | 'description'
  | 'amount'
  | 'credit'
  | 'debit'
  | 'type'
  | 'member'
  | 'method'
  | 'status'
  | 'nature'
  | 'branch'
  | 'movementType'
  | 'name'
  | 'email'
  | 'phone'
  | 'monthlyFee'
  | 'joinedAt'
  | 'role'
  | 'clubeLtc'
  | 'guardianName'
  | 'guardianRelationship'
  | 'guardianPhone'
  | 'guardianEmail'
  | 'guardianName2'
  | 'guardianRelationship2'
  | 'guardianPhone2'
  | 'guardianEmail2'
  | 'guardianName3'
  | 'guardianRelationship3'
  | 'guardianPhone3'
  | 'guardianEmail3';

export type FieldMapping = Partial<Record<CanonicalField, string>>;

export type SampleColumn = {
  field: CanonicalField;
  label: string;
  source: string;
  column: string;
};

export type ImportSample = {
  totalRows: number;
  shown: number;
  columns: SampleColumn[];
  rows: Record<string, string>[];
};

export type SampleReview = {
  usedAi: boolean;
  ok: boolean;
  summary: string;
};

export type RemapResult = {
  csv: string;
  table: CsvTable;
  usedAi: boolean;
  mapping: FieldMapping;
  sample: ImportSample;
  review: SampleReview;
  headerIndex: number;
};

const COLUMN: Record<CanonicalField, string> = {
  date: 'data',
  description: 'historico',
  amount: 'valor',
  credit: 'credito',
  debit: 'debito',
  type: 'tipo',
  member: 'associado',
  method: 'meio',
  status: 'situacao',
  nature: 'natureza',
  branch: 'ramo',
  movementType: 'tipo_movimentacao',
  name: 'nome',
  email: 'email',
  phone: 'telefone',
  monthlyFee: 'mensalidade',
  joinedAt: 'ingresso',
  role: 'papel',
  clubeLtc: 'clube_ltc',
  guardianName: 'responsavel',
  guardianRelationship: 'parentesco',
  guardianPhone: 'telefone_responsavel',
  guardianEmail: 'email_responsavel',
  guardianName2: 'responsavel_2',
  guardianRelationship2: 'parentesco_2',
  guardianPhone2: 'telefone_responsavel_2',
  guardianEmail2: 'email_responsavel_2',
  guardianName3: 'responsavel_3',
  guardianRelationship3: 'parentesco_3',
  guardianPhone3: 'telefone_responsavel_3',
  guardianEmail3: 'email_responsavel_3',
};

const FIELD_LABEL: Record<CanonicalField, string> = {
  date: 'Data',
  description: 'Histórico',
  amount: 'Valor',
  credit: 'Crédito',
  debit: 'Débito',
  type: 'Tipo',
  member: 'Associado',
  method: 'Meio',
  status: 'Situação',
  nature: 'Natureza',
  branch: 'Ramo',
  movementType: 'Tipo de movimentação',
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  monthlyFee: 'Mensalidade',
  joinedAt: 'Ingresso',
  role: 'Papel',
  clubeLtc: 'Clube LTC',
  guardianName: 'Responsável',
  guardianRelationship: 'Parentesco',
  guardianPhone: 'Telefone do responsável',
  guardianEmail: 'E-mail do responsável',
  guardianName2: 'Responsável 2',
  guardianRelationship2: 'Parentesco 2',
  guardianPhone2: 'Telefone do responsável 2',
  guardianEmail2: 'E-mail do responsável 2',
  guardianName3: 'Responsável 3',
  guardianRelationship3: 'Parentesco 3',
  guardianPhone3: 'Telefone do responsável 3',
  guardianEmail3: 'E-mail do responsável 3',
};

const SPLIT_AMOUNT = /(credito|debito|credit|debit)/;

const ALIASES: Record<CanonicalField, string[]> = {
  date: [
    'data',
    'date',
    'dt',
    'data_movimento',
    'dt_movimento',
    'data_lancamento',
    'dt_lancamento',
    'data_do_lancamento',
    'vencimento',
    'dt_lcto',
    'data_lcto',
  ],
  description: [
    'historico',
    'descricao',
    'lancamento',
    'memo',
    'historico_completo',
    'identificador',
    'historico_do_lancamento',
    'descricao_do_lancamento',
    'historico_lancamento',
    'detalhe',
    'complemento',
  ],
  amount: ['valor', 'amount', 'vlr', 'valor_movimento', 'valor_r', 'valor_rs', 'valor_lancamento'],
  credit: ['credito', 'credit', 'entrada', 'valor_credito', 'vlr_credito'],
  debit: ['debito', 'debit', 'saida', 'valor_debito', 'vlr_debito'],
  type: ['tipo', 'dc', 'c_d', 'natureza_dc', 'entrada_saida', 'credito_debito', 'tipo_lancamento'],
  member: ['associado', 'member', 'pagador', 'nome_pagador', 'remetente', 'beneficiario'],
  method: ['meio', 'method', 'forma', 'forma_pagamento', 'canal'],
  status: ['situacao', 'status', 'conciliacao'],
  nature: ['natureza', 'nature'],
  branch: ['ramo', 'branch', 'secao'],
  movementType: ['tipo_movimentacao', 'tipo_de_movimentacao', 'movimentacao', 'movement_type'],
  name: ['nome', 'name', 'associado', 'nome_completo', 'jovem', 'nome_do_jovem', 'nome_associado', 'nome_do_associado'],
  email: ['email', 'e_mail', 'mail'],
  phone: ['telefone', 'phone', 'celular', 'whatsapp', 'fone'],
  monthlyFee: ['mensalidade', 'monthly_fee', 'taxa', 'valor_mensalidade'],
  joinedAt: ['ingresso', 'joined_at', 'data_ingresso', 'data_cadastro', 'dt_cadastro'],
  role: ['papel', 'funcao', 'role'],
  clubeLtc: ['clube_ltc', 'ltc', 'clube', 'clube_l'],
  guardianName: [
    'responsavel',
    'nome_responsavel',
    'guardian',
    'pai_mae',
    'responsavel_legal',
    'mae',
    'nome_mae',
    'nome_da_mae',
    'mae_nome',
  ],
  guardianRelationship: ['parentesco', 'grau_parentesco', 'relacao', 'vinculo', 'parentescos', 'parent'],
  guardianPhone: [
    'telefone_responsavel',
    'fone_responsavel',
    'celular_responsavel',
    'telefone_mae',
    'celular_mae',
    'telefone_da_mae',
    'telefone2',
  ],
  guardianEmail: ['email_responsavel', 'e_mail_responsavel', 'email_mae', 'email_da_mae', 'email2'],
  guardianName2: [
    'responsavel_2',
    'responsavel_1',
    'nome_responsavel_2',
    'guardian_2',
    'pai',
    'nome_pai',
    'nome_do_pai',
    'pai_nome',
    'resp2',
  ],
  guardianRelationship2: ['parentesco_2', 'parentesco_1', 'grau_parentesco_2', 'relacao_2', 'parent2'],
  guardianPhone2: [
    'telefone_responsavel_2',
    'fone_responsavel_2',
    'celular_responsavel_2',
    'telefone_pai',
    'celular_pai',
    'telefone_do_pai',
    'telefone3',
  ],
  guardianEmail2: ['email_responsavel_2', 'e_mail_responsavel_2', 'email_pai', 'email_do_pai'],
  guardianName3: ['responsavel_3', 'nome_responsavel_3', 'guardian_3'],
  guardianRelationship3: ['parentesco_3', 'grau_parentesco_3', 'relacao_3'],
  guardianPhone3: ['telefone_responsavel_3', 'fone_responsavel_3', 'celular_responsavel_3'],
  guardianEmail3: ['email_responsavel_3', 'e_mail_responsavel_3'],
};

const STATEMENT_FIELDS: CanonicalField[] = [
  'date',
  'description',
  'credit',
  'debit',
  'amount',
  'type',
  'member',
  'method',
  'status',
  'nature',
  'branch',
  'movementType',
];

const MEMBER_FIELDS: CanonicalField[] = [
  'name',
  'email',
  'phone',
  'branch',
  'role',
  'monthlyFee',
  'joinedAt',
  'clubeLtc',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  'guardianName2',
  'guardianRelationship2',
  'guardianPhone2',
  'guardianEmail2',
  'guardianName3',
  'guardianRelationship3',
  'guardianPhone3',
  'guardianEmail3',
];

export async function remapImportCsv(
  csv: string,
  kind: ImportKind,
  options?: { mapping?: FieldMapping; review?: boolean },
): Promise<RemapResult> {
  const headerIndex = detectHeaderIndex(csv, kind);
  const original = parseCsv(csv, headerIndex);
  const given = options?.mapping && Object.keys(options.mapping).length ? options.mapping : undefined;
  const withReview = options?.review !== false;
  if (!original.rows.length) {
    return finishRemap(csv, original, false, given ?? {}, kind, headerIndex, withReview);
  }

  if (given) {
    const remapped = applyMapping(original, given, kind);
    return finishRemap(tableToCsv(remapped), remapped, false, given, kind, headerIndex, withReview);
  }

  if (kind === 'statement' && isTemplate(original.headers)) {
    return finishRemap(tableToCsv(original), original, false, {}, kind, headerIndex, withReview);
  }

  let mapping = heuristicMapping(original.headers, kind);
  let usedAi = false;

  if (aiConfigured() && needsAi(mapping, kind)) {
    const ai = await mapFieldsWithAi(csv, kind, headerIndex);
    if (ai) {
      usedAi = true;
      const parsed = parseCsv(csv, ai.headerIndex);
      const resolved = resolveMapping(parsed.headers, ai.fields, kind);
      if (Object.keys(resolved).length) {
        mapping = { ...mapping, ...resolved };
        const remapped = applyMapping(parsed, mapping, kind);
        return finishRemap(tableToCsv(remapped), remapped, usedAi, mapping, kind, ai.headerIndex, withReview);
      }
    }
  }

  const remapped = applyMapping(original, mapping, kind);
  return finishRemap(tableToCsv(remapped), remapped, usedAi, mapping, kind, headerIndex, withReview);
}

async function finishRemap(
  csv: string,
  table: CsvTable,
  usedAi: boolean,
  mapping: FieldMapping,
  kind: ImportKind,
  headerIndex: number,
  withReview: boolean,
): Promise<RemapResult> {
  const sample = buildImportSample(table, mapping, kind);
  const review = withReview ? await reviewImportSample(sample, kind) : { usedAi: false, ok: true, summary: '' };
  return { csv, table, usedAi, mapping, sample, review, headerIndex };
}

export function buildImportSample(table: CsvTable, mapping: FieldMapping, kind: ImportKind): ImportSample {
  const fields = kind === 'members' ? MEMBER_FIELDS : STATEMENT_FIELDS;
  let columns: SampleColumn[] = fields
    .filter((field) => mapping[field])
    .map((field) => ({
      field,
      label: FIELD_LABEL[field],
      source: mapping[field] ?? COLUMN[field],
      column: COLUMN[field],
    }));
  if (!columns.length) {
    columns = fields
      .filter((field) => table.headers.includes(COLUMN[field]))
      .map((field) => ({
        field,
        label: FIELD_LABEL[field],
        source: COLUMN[field],
        column: COLUMN[field],
      }));
  }
  const shown = Math.min(5, table.rows.length);
  const rows = table.rows.slice(0, shown).map((row) => {
    const next: Record<string, string> = {};
    for (const column of columns) {
      next[column.column] = row[column.column] ?? '';
    }
    return next;
  });
  return { totalRows: table.rows.length, shown, columns, rows };
}

export async function reviewImportSample(sample: ImportSample, kind: ImportKind): Promise<SampleReview> {
  const heuristic = heuristicSampleReview(sample, kind);
  if (process.env.VITEST || !aiConfigured() || !sample.rows.length) return heuristic;
  const ai = await chatJson<{ ok?: boolean; summary?: string }>(
    'Você valida uma AMOSTRA de importação da tesouraria de um grupo escoteiro. Responda só JSON {"ok":true,"summary":"..."}. summary em português, 1 ou 2 frases, para o tesoureiro conferir se os campos batem com os exemplos. Não invente datas, valores ou nomes. Não peça para gravar se data, valor, nome ou e-mail parecerem coluna trocada.',
    {
      kind,
      colunas: sample.columns.map((column) => ({
        campo: column.label,
        origem: column.source,
        exemplos: sample.rows
          .map((row) => row[column.column])
          .filter(Boolean)
          .slice(0, 5),
      })),
    },
    12_000,
  );
  if (!ai?.summary) return heuristic;
  return {
    usedAi: true,
    ok: heuristic.ok && ai.ok !== false,
    summary: heuristic.ok ? ai.summary.trim() : heuristic.summary,
  };
}

function heuristicSampleReview(sample: ImportSample, kind: ImportKind): SampleReview {
  if (!sample.rows.length) {
    return {
      usedAi: false,
      ok: false,
      summary: 'Não há linhas na amostragem para conferir.',
    };
  }
  const problems: string[] = [];
  for (const column of sample.columns) {
    const values = sample.rows.map((row) => row[column.column]?.trim() ?? '').filter(Boolean);
    if (!values.length) {
      if (OPTIONAL_SAMPLE.has(column.field)) continue;
      problems.push(`${column.label} veio vazio na amostra`);
      continue;
    }
    if ((column.field === 'date' || column.field === 'joinedAt') && !values.some((value) => parseIsoDate(value))) {
      problems.push(`${column.label} não parece data (${values[0]})`);
    }
    if (
      (column.field === 'amount' ||
        column.field === 'credit' ||
        column.field === 'debit' ||
        column.field === 'monthlyFee') &&
      !values.some((value) => Number.isFinite(parseSignedAmount(value)))
    ) {
      problems.push(`${column.label} não parece valor (${values[0]})`);
    }
    if (column.field === 'email' && !values.some((value) => value.includes('@'))) {
      problems.push(`${column.label} não parece e-mail (${values[0]})`);
    }
    if (column.field === 'name' && values[0]!.length < 2) {
      problems.push(`${column.label} está curto demais na amostra`);
    }
    if (column.field === 'description' && values[0]!.length < 3) {
      problems.push(`${column.label} está curto demais na amostra`);
    }
  }
  const needed =
    kind === 'members'
      ? sample.columns.some((column) => column.field === 'name') &&
        sample.columns.some((column) => column.field === 'email')
      : sample.columns.some((column) => column.field === 'date') &&
        sample.columns.some((column) => column.field === 'description') &&
        sample.columns.some(
          (column) => column.field === 'amount' || column.field === 'credit' || column.field === 'debit',
        );
  if (!needed) problems.push('Faltam campos obrigatórios na amostra');
  const ok = problems.length === 0;
  return {
    usedAi: false,
    ok,
    summary: ok
      ? `Amostra com ${sample.shown} ${sample.shown === 1 ? 'linha' : 'linhas'}: os exemplos batem com os campos identificados.`
      : problems.join('. '),
  };
}

const OPTIONAL_SAMPLE = new Set<CanonicalField>([
  'credit',
  'debit',
  'amount',
  'type',
  'member',
  'method',
  'status',
  'nature',
  'branch',
  'movementType',
  'phone',
  'role',
  'clubeLtc',
  'monthlyFee',
  'joinedAt',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  'guardianName2',
  'guardianRelationship2',
  'guardianPhone2',
  'guardianEmail2',
  'guardianName3',
  'guardianRelationship3',
  'guardianPhone3',
  'guardianEmail3',
]);

export function detectHeaderIndex(csv: string, kind: ImportKind): number {
  const lines = csvLines(csv);
  const fields = kind === 'members' ? MEMBER_FIELDS : STATEMENT_FIELDS;
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(lines.length, 30);
  for (let index = 0; index < limit; index += 1) {
    if (!lines[index]?.trim()) continue;
    const headers = csvCells(lines[index] ?? '').map(normalizeHeader);
    const score = fields.reduce((sum, field) => sum + (matchHeader(headers, field) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
    if (score >= 3) return index;
  }
  return bestScore >= 2 ? best : 0;
}

export function heuristicMapping(headers: string[], kind: ImportKind): FieldMapping {
  const fields = kind === 'members' ? MEMBER_FIELDS : STATEMENT_FIELDS;
  const mapping: FieldMapping = {};
  const used = new Set<string>();
  for (const field of fields) {
    const header = matchHeader(headers, field, used);
    if (!header) continue;
    mapping[field] = header;
    used.add(header);
  }
  return mapping;
}

function needsAi(mapping: FieldMapping, kind: ImportKind): boolean {
  if (kind === 'members') {
    return !mapping.name || !mapping.email;
  }
  const hasAmount = Boolean(mapping.amount || mapping.credit || mapping.debit);
  return !mapping.date || !mapping.description || !hasAmount;
}

async function mapFieldsWithAi(
  csv: string,
  kind: ImportKind,
  headerIndex: number,
): Promise<{ headerIndex: number; fields: Record<string, string> } | null> {
  const lines = csvLines(csv)
    .filter((line) => line.trim())
    .slice(0, 12)
    .map((line) => csvCells(line).map((cell) => cell.slice(0, 80)));
  const parsed = await chatJson<{
    headerRow?: number;
    fields?: Record<string, string>;
  }>(
    kind === 'members'
      ? 'Você identifica colunas de uma planilha de associados de grupo escoteiro. Responda só JSON {"headerRow":0,"fields":{}}. headerRow é o índice da linha de títulos (0 é a primeira). fields usa as chaves name,email,phone,branch,role,monthlyFee,joinedAt,clubeLtc,guardianName,guardianRelationship,guardianPhone,guardianEmail,guardianName2,guardianRelationship2,guardianPhone2,guardianEmail2,guardianName3,guardianRelationship3,guardianPhone3,guardianEmail3 e o valor é o texto EXATO do cabeçalho. Não invente colunas. Omita o que não existir. Se houver mãe e pai em colunas separadas, use guardianName para a mãe e guardianName2 para o pai. Se a mesma linha ou outra linha do mesmo jovem tiver mais de um responsável, mapeie todos. parentesco vai em guardianRelationship / guardianRelationship2.'
      : 'Você identifica colunas de um extrato bancário ou planilha da tesouraria. Responda só JSON {"headerRow":0,"fields":{}}. headerRow é o índice da linha de títulos. fields usa as chaves date,description,amount,credit,debit,type,member,method,status,nature,branch,movementType e o valor é o texto EXATO do cabeçalho. Não invente valores de células. Omita o que não existir. Se crédito e débito forem colunas separadas, não use amount.',
    { kind, headerRowHint: headerIndex, linhas: lines },
  );
  if (!parsed?.fields) return null;
  const nextIndex =
    typeof parsed.headerRow === 'number' && parsed.headerRow >= 0 && parsed.headerRow < 20
      ? parsed.headerRow
      : headerIndex;
  return { headerIndex: nextIndex, fields: parsed.fields };
}

function resolveMapping(headers: string[], fields: Record<string, string>, kind: ImportKind): FieldMapping {
  const allowed = new Set(kind === 'members' ? MEMBER_FIELDS : STATEMENT_FIELDS);
  const mapping: FieldMapping = {};
  for (const [field, label] of Object.entries(fields)) {
    if (!allowed.has(field as CanonicalField) || !label) continue;
    const header = headers.find((item) => item === normalizeHeader(label) || item === fold(label));
    if (header) mapping[field as CanonicalField] = header;
  }
  return mapping;
}

function applyMapping(table: CsvTable, mapping: FieldMapping, kind: ImportKind): CsvTable {
  const fields = kind === 'members' ? MEMBER_FIELDS : STATEMENT_FIELDS;
  const headers = fields.filter((field) => mapping[field]).map((field) => COLUMN[field]);
  if (!headers.length) return table;
  const unique = [...new Set(headers)];
  const rows = table.rows.map((row) => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const source = mapping[field];
      if (!source) continue;
      next[COLUMN[field]] = row[source] ?? '';
    }
    return next;
  });
  return { headers: unique, rows };
}

function tableToCsv(table: CsvTable): string {
  const escape = (value: string) => (/[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [
    table.headers.join(';'),
    ...table.rows.map((row) => table.headers.map((header) => escape(row[header] ?? '')).join(';')),
  ];
  return lines.join('\n');
}

function matchHeader(headers: string[], field: CanonicalField, used: Set<string> = new Set()): string | undefined {
  const aliases = ALIASES[field];
  const candidates = headers.filter((header) => !used.has(header));
  const exact = candidates.find((header) => aliases.includes(header));
  if (exact) return exact;
  if (field.startsWith('guardian')) return undefined;
  if (field === 'date') {
    const dated = candidates.find((header) => header.startsWith('dt_'));
    if (dated) return dated;
  }
  if (field === 'amount') {
    const valued = candidates.find((header) => header.startsWith('vlr_') && !SPLIT_AMOUNT.test(header));
    if (valued) return valued;
  }
  return candidates.find((header) => {
    if (field === 'amount' && SPLIT_AMOUNT.test(header)) return false;
    return aliases.some(
      (alias) => alias.length >= 4 && (header.startsWith(`${alias}_`) || header.endsWith(`_${alias}`)),
    );
  });
}
