import type { BranchId, PaymentMethod, TxNature, TxPaymentStatus, TxType } from "../shared/types";
import { fold, parseCsv, parseIsoDate, parseSignedAmount, pick } from "../shared/csv";
import { matchesMensalidadeAmount } from "../mensalidades/fee-table";

export type StatementLayout = "template" | "bank";
export type StatementConfidence = "high" | "medium" | "low";

export type StatementCatalog = {
  movementTypes: { id: string; name: string; direction: string; active: boolean }[];
  members: {
    id: string;
    name: string;
    branch: BranchId;
    monthlyFee: number;
    clubeLtc?: boolean;
    status?: string;
    accounts?: { holderName: string; pixKey?: string; document?: string }[];
    guardians?: { id: string; name: string }[];
  }[];
  fees?: { name: string; amount: number }[];
  pendingPayments?: { id: string; memberId?: string; amount: number; date: string; movementTypeId: string }[];
};

export type SuggestedTx = {
  line: number;
  date: string;
  type: TxType;
  nature: TxNature;
  movementTypeId: string;
  movementTypeName: string;
  description: string;
  amount: number;
  branch: BranchId;
  method: PaymentMethod;
  paymentStatus: TxPaymentStatus;
  memberId?: string;
  memberName?: string;
  memberGuardianId?: string;
  memberGuardianName?: string;
  confidence: StatementConfidence;
  hint: string;
  error?: string;
};

export type InterpretResult = {
  layout: StatementLayout;
  rows: SuggestedTx[];
};

const SKIP = /(saldo\s+(anterior|atual|do dia|final)|aplicacao automatica|rendimento de aplicacao)/;

const KEYWORDS: { needles: string[]; typeName: string; direction?: TxType }[] = [
  { needles: ["taxa de acampamento", "taxa acamp"], typeName: "Taxa de acampamento", direction: "income" },
  { needles: ["mensalidade", "mensalid"], typeName: "Mensalidade", direction: "income" },
  { needles: ["doacao"], typeName: "Doação", direction: "income" },
  { needles: ["ueb", "registro ueb"], typeName: "UEB / Registro" },
  { needles: ["bazar"], typeName: "Bazar", direction: "income" },
  { needles: ["rifa", "campanha"], typeName: "Campanha", direction: "income" },
  {
    needles: ["energisa", "copel", "rge", "energia", "internet", "sanepar", "utilidade"],
    typeName: "Utilidades",
    direction: "expense",
  },
  { needles: ["aluguel", "condominio", "iptu", "sede"], typeName: "Sede", direction: "expense" },
  {
    needles: ["ifood", "mercado", "supermercado", "padaria", "lanche", "restaurante", "aliment"],
    typeName: "Alimentação",
    direction: "expense",
  },
  { needles: ["uniforme", "lenco", "distintivo"], typeName: "Uniforme", direction: "expense" },
  { needles: ["limpeza", "manutencao", "conserto"], typeName: "Manutenção", direction: "expense" },
  { needles: ["material", "pioneiria", "papelaria"], typeName: "Material", direction: "expense" },
  { needles: ["acampamento", "jornada", "expedicao"], typeName: "Acampamento", direction: "expense" },
];

const FIXED_TYPES = new Set(["mensalidade", "ueb / registro", "sede", "utilidades"]);

export function interpretStatement(csv: string, catalog: StatementCatalog): InterpretResult {
  const table = parseCsv(csv);
  if (!table.rows.length) return { layout: "bank", rows: [] };
  const layout = isTemplate(table.headers) ? "template" : "bank";
  const rows = table.rows.flatMap((row, index) => {
    const line = index + 2;
    const suggested = layout === "template" ? fromTemplate(row, line, catalog) : fromBank(row, line, catalog);
    return suggested ? [suggested] : [];
  });
  return { layout, rows };
}

export function isTemplate(headers: string[]): boolean {
  const set = new Set(headers);
  return set.has("tipo_movimentacao") || set.has("tipo_de_movimentacao") || set.has("movement_type");
}

function fromTemplate(row: Record<string, string>, line: number, catalog: StatementCatalog): SuggestedTx | null {
  const date = parseIsoDate(pick(row, "data", "date", "vencimento"));
  const type = parseDirection(pick(row, "tipo", "type", "direcao"));
  const nature = parseNature(pick(row, "natureza", "nature"));
  const movementName = pick(row, "tipo_movimentacao", "tipo_de_movimentacao", "movimentacao", "movement_type");
  const description = pick(row, "descricao", "description", "historico");
  const amount = Math.abs(parseSignedAmount(pick(row, "valor", "amount")));
  const branch = parseBranch(pick(row, "ramo", "branch"), true);
  const method = parseMethod(pick(row, "meio", "method", "forma")) ?? "pix";
  const paymentStatus = parsePaymentStatus(pick(row, "situacao", "status", "conciliacao"));
  const memberName = pick(row, "associado", "member", "nome");
  const guardianName = pick(row, "responsavel", "nome_responsavel", "guardian");
  const movement = findType(catalog.movementTypes, movementName);

  const error = !date
    ? "Data inválida"
    : !type
      ? "Tipo deve ser entrada ou saída"
      : !nature
        ? "Natureza deve ser fixa ou variável"
        : description.length < 2
          ? "Descrição inválida"
          : !Number.isFinite(amount) || amount <= 0
            ? "Valor inválido"
            : !branch
              ? "Ramo inválido"
              : !paymentStatus
                ? "Situação inválida"
                : !movement
                  ? "Tipo de movimentação não encontrado"
                  : undefined;

  const member = memberName ? matchMember(memberName, catalog.members)?.member : undefined;
  const guardianHit = member ? matchGuardian(guardianName || memberName, member) : undefined;
  return {
    line,
    date: date ?? "",
    type: type ?? "income",
    nature: nature ?? "variable",
    movementTypeId: movement?.id ?? "",
    movementTypeName: movement?.name ?? movementName,
    description: description || `Linha ${line}`,
    amount: Number.isFinite(amount) ? amount : 0,
    branch: branch ?? "grupo",
    method,
    paymentStatus: paymentStatus ?? "paid",
    memberId: member?.id,
    memberName: member?.name ?? (memberName || undefined),
    memberGuardianId: guardianHit?.id,
    memberGuardianName: guardianHit?.name,
    confidence: error ? "low" : "high",
    hint: error ?? "Modelo da tesouraria",
    error,
  };
}

function fromBank(row: Record<string, string>, line: number, catalog: StatementCatalog): SuggestedTx | null {
  const description =
    pick(row, "historico", "descricao", "lancamento", "memo", "historico_completo", "identificador") ||
    Object.values(row).find((value) => value.length > 8) ||
    "";
  if (SKIP.test(fold(description))) return null;

  const date = parseIsoDate(pick(row, "data", "date", "data_movimento", "dt", "vencimento"));
  const signed = readSignedAmount(row);
  const flagged = parseDirection(pick(row, "tipo", "dc", "c_d", "natureza", "entrada_saida", "credito_debito"));
  const inferred = inferBankDirection(description);
  const type: TxType | null = flagged ?? inferred ?? (signed < 0 ? "expense" : signed > 0 ? "income" : null);
  const amount = Math.abs(signed);
  if (!date || !type || !Number.isFinite(amount) || amount <= 0) {
    return {
      line,
      date: date ?? "",
      type: type ?? "expense",
      nature: "variable",
      movementTypeId: "",
      movementTypeName: "",
      description: description || `Linha ${line}`,
      amount: Number.isFinite(amount) ? amount : 0,
      branch: "grupo",
      method: "pix",
      paymentStatus: "paid",
      confidence: "low",
      hint: !date ? "Data inválida" : "Valor ou direção inválidos",
      error: !date ? "Data inválida" : "Valor ou direção inválidos",
    };
  }

  const method = detectMethod(description);
  const memberHit = matchMember(
    description,
    catalog.members.filter((item) => item.status !== "inactive"),
  );
  const classified = classifyMovement(description, type, catalog.movementTypes);
  let movement = classified.type;
  let hint = classified.hint;
  let confidence: StatementConfidence = classified.confidence;

  if (!movement && memberHit && type === "income") {
    const pending = findPendingFee(catalog, memberHit.member.id, amount, date);
    if (pending) {
      movement =
        catalog.movementTypes.find((item) => item.id === pending.movementTypeId && item.active) ??
        findType(catalog.movementTypes, "Mensalidade");
      if (movement) {
        hint = "Mensalidade pendente será marcada como paga";
        confidence = "high";
      }
    }
  }

  if (!movement && memberHit && type === "income") {
    const feeMatch =
      feeNameForAmount(amount, catalog.fees) ?? (matchesMemberFee(memberHit.member, amount) ? "Mensalidade" : null);
    if (feeMatch) {
      movement = findType(catalog.movementTypes, feeMatch);
      if (movement) {
        hint = `${feeMatch} pelo valor e associado — marcar como paga`;
        confidence = "high";
      }
    }
  }

  if (!movement && type === "income" && memberHit && matchesMemberFee(memberHit.member, amount)) {
    movement = findType(catalog.movementTypes, "Mensalidade");
    if (movement) {
      hint = "Mensalidade pelo valor do associado — marcar como paga";
      confidence = "high";
    }
  }

  if (movement && memberHit && isMensalidadeName(movement.name)) {
    const pending = findPendingFee(catalog, memberHit.member.id, amount, date);
    if (pending) hint = "Mensalidade pendente será marcada como paga";
  }

  if (!movement && memberHit) {
    movement = catchAllType(catalog.movementTypes, type);
    hint = movement
      ? "Associado identificado — conferir o tipo no fluxo de caixa"
      : "Tipo de movimentação não encontrado";
    confidence = "medium";
  }

  if (!movement) {
    movement = catchAllType(catalog.movementTypes, type);
    hint = movement ? "Sem regra clara — conferir o tipo no fluxo de caixa" : "Tipo de movimentação não encontrado";
    confidence = "low";
  }

  if (memberHit && classified.confidence !== "low" && confidence === "medium") confidence = "high";
  if (!memberHit && confidence === "high" && classified.confidence !== "high") confidence = "medium";

  const branch = (memberHit?.member.branch as BranchId | undefined) ?? "grupo";
  const nature: TxNature = FIXED_TYPES.has(fold(movement?.name ?? "")) ? "fixed" : "variable";
  const guardian = memberHit?.guardian;

  return {
    line,
    date,
    type,
    nature,
    movementTypeId: movement?.id ?? "",
    movementTypeName: movement?.name ?? "",
    description: description.slice(0, 180),
    amount,
    branch,
    method,
    paymentStatus: "paid",
    memberId: memberHit?.member.id,
    memberName: memberHit?.member.name,
    memberGuardianId: guardian?.id,
    memberGuardianName: guardian?.name,
    confidence,
    hint: memberHit ? `${hint} · ${memberHit.member.name}${guardian ? ` · ${guardian.name}` : ""}` : hint,
    error: movement?.id ? undefined : "Tipo de movimentação não encontrado",
  };
}

function readSignedAmount(row: Record<string, string>): number {
  const credit = parseSignedAmount(pick(row, "credito", "credit", "entrada", "valor_credito"));
  const debit = parseSignedAmount(pick(row, "debito", "debit", "saida", "valor_debito"));
  if (Number.isFinite(credit) && credit > 0) return credit;
  if (Number.isFinite(debit) && debit !== 0) return -Math.abs(debit);
  return parseSignedAmount(pick(row, "valor", "amount", "valor_movimento", "vlr"));
}

function parseDirection(value: string): TxType | null {
  const key = fold(value).replace(/\s+/g, "");
  if (["entrada", "income", "credito", "c", "cr", "credit"].includes(key)) return "income";
  if (["saida", "expense", "debito", "d", "db", "debit"].includes(key)) return "expense";
  return null;
}

function parseNature(value: string): TxNature | null {
  const key = fold(value);
  if (["fixa", "fixed"].includes(key)) return "fixed";
  if (["variavel", "variable"].includes(key)) return "variable";
  return null;
}

function parseBranch(value: string, allowGrupo: boolean): BranchId | null {
  const key = fold(value).replace(/\s+/g, " ");
  const map: Record<string, BranchId> = {
    filhote: "filhote",
    filhotes: "filhote",
    lobinho: "lobinho",
    alcateia: "lobinho",
    escoteiro: "escoteiro",
    tropa: "escoteiro",
    senior: "senior",
    pioneiro: "pioneiro",
    "flor-de-lis": "flor-de-lis",
    "flor de lis": "flor-de-lis",
    clube: "flor-de-lis",
  };
  if (allowGrupo) {
    map.grupo = "grupo";
    map["grupo escoteiro"] = "grupo";
  }
  return map[key] ?? null;
}

function parseMethod(value: string): PaymentMethod | null {
  const key = fold(value);
  if (key === "pix") return "pix";
  if (["dinheiro", "cash", "especie"].includes(key)) return "cash";
  if (["transferencia", "transfer", "ted", "doc"].includes(key)) return "transfer";
  if (["cartao", "card", "credito", "debito"].includes(key)) return "card";
  if (["outro", "other"].includes(key)) return "other";
  return null;
}

function parsePaymentStatus(value: string): TxPaymentStatus | null {
  const key = fold(value);
  if (!key || ["pago", "paid", "conciliado"].includes(key)) return "paid";
  if (["pendente", "pending"].includes(key)) return "pending";
  return null;
}

function detectMethod(description: string): PaymentMethod {
  const key = fold(description);
  if (key.includes("pix")) return "pix";
  if (/\b(ted|doc|transferencia|transf)\b/.test(key)) return "transfer";
  if (key.includes("cartao") || key.includes("debito automatico")) return "card";
  if (key.includes("dinheiro") || key.includes("especie")) return "cash";
  return "pix";
}

function inferBankDirection(description: string): TxType | null {
  const key = fold(description);
  if (/\b(pix_cred|recebimento|pix recebido|ted recebida|deposito)\b/.test(key)) return "income";
  if (/\b(pix_deb|pix enviado|envio pix|tarifa|ted enviada)\b/.test(key)) return "expense";
  if (/\bpagamento\b/.test(key) && !/\brecebimento\b/.test(key)) return "expense";
  return null;
}

function classifyMovement(description: string, direction: TxType, types: StatementCatalog["movementTypes"]) {
  const key = fold(description);
  for (const rule of KEYWORDS) {
    if (rule.direction && rule.direction !== direction) continue;
    if (rule.needles.some((needle) => key.includes(needle))) {
      const type = findType(types, rule.typeName);
      if (type && (type.direction === "both" || type.direction === direction)) {
        return { type, hint: `Regra: ${rule.typeName}`, confidence: "high" as const };
      }
    }
  }
  const named = types
    .filter(
      (item) => item.active && item.name.length >= 4 && (item.direction === "both" || item.direction === direction),
    )
    .sort((a, b) => b.name.length - a.name.length)
    .find((item) => {
      const token = fold(item.name);
      return token.length >= 5 && key.includes(token);
    });
  if (named) {
    return { type: named, hint: `Tipo “${named.name}” no histórico`, confidence: "high" as const };
  }
  if (key.includes("evento")) {
    const name = direction === "income" ? "Evento (receita)" : "Eventos (despesa)";
    const type = findType(types, name);
    if (type) return { type, hint: `Regra: ${name}`, confidence: "medium" as const };
  }
  return { type: null, hint: "Sem classificação", confidence: "low" as const };
}

export function matchMember(text: string, members: StatementCatalog["members"]) {
  const key = fold(text);
  const compact = key.replace(/\s+/g, "");
  let best: {
    member: StatementCatalog["members"][number];
    score: number;
    guardian?: { id: string; name: string };
  } | null = null;
  let ties = 0;
  for (const member of members) {
    let score = 0;
    let guardian: { id: string; name: string } | undefined;
    const name = fold(member.name);
    if (name.length >= 5 && key.includes(name)) score = Math.max(score, 80);
    const parts = name.split(/\s+/).filter((part) => part.length > 2);
    if (parts.length >= 2 && parts.every((part) => key.includes(part))) score = Math.max(score, 70);
    const last = parts.at(-1);
    if (last && last.length > 4 && key.includes(last) && parts[0] && key.includes(parts[0])) {
      score = Math.max(score, 60);
    }
    const haystackDigits = onlyDigits(text);
    for (const account of member.accounts ?? []) {
      const holder = fold(account.holderName);
      if (holder.length >= 5 && key.includes(holder)) score = Math.max(score, 75);
      const pix = fold(account.pixKey ?? "").replace(/\s+/g, "");
      if (pix.length >= 6 && compact.includes(pix)) score = Math.max(score, 95);
      const document = onlyDigits(account.document ?? "");
      if (document.length >= 11 && haystackDigits.includes(document)) score = Math.max(score, 96);
      const pixDigits = onlyDigits(account.pixKey ?? "");
      if (pixDigits.length >= 11 && haystackDigits.includes(pixDigits)) score = Math.max(score, 95);
    }
    for (const item of member.guardians ?? []) {
      const guardianName = fold(item.name);
      const parts = guardianName.split(/\s+/).filter((part) => part.length > 2);
      if (guardianName.length >= 5 && key.includes(guardianName)) {
        score = Math.max(score, 76);
        guardian = item;
      } else if (parts.length >= 2 && parts.every((part) => key.includes(part))) {
        score = Math.max(score, 74);
        guardian = item;
      }
    }
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { member, score, guardian };
      ties = 1;
    } else if (score === best.score) {
      ties += 1;
    }
  }
  if (!best || best.score < 60 || ties > 1) return null;
  return best;
}

export function matchGuardian(text: string, member: StatementCatalog["members"][number]) {
  const key = fold(text);
  if (!key) return undefined;
  return (member.guardians ?? []).find((item) => {
    const name = fold(item.name);
    return name.length >= 5 && key.includes(name);
  });
}

export function findType(types: StatementCatalog["movementTypes"], name: string) {
  const key = fold(name);
  return types.find((item) => item.active && fold(item.name) === key) ?? null;
}

export function isMensalidadeName(name: string) {
  return fold(name).includes("mensalidade");
}

export function isUnidentifiedName(name: string) {
  return fold(name) === "a identificar";
}

function catchAllType(types: StatementCatalog["movementTypes"], direction: TxType) {
  for (const name of ["A identificar", "Outros"]) {
    const type = types.find(
      (item) =>
        item.active && fold(item.name) === fold(name) && (item.direction === "both" || item.direction === direction),
    );
    if (type) return type;
  }
  return types.find((item) => item.active && (item.direction === "both" || item.direction === direction)) ?? null;
}

function findPendingFee(catalog: StatementCatalog, memberId: string, amount: number, date: string) {
  const month = date.slice(0, 7);
  const member = catalog.members.find((item) => item.id === memberId);
  const mensalidadeIds = new Set(
    catalog.movementTypes.filter((item) => item.active && isMensalidadeName(item.name)).map((item) => item.id),
  );
  const matches = (catalog.pendingPayments ?? []).filter((item) => {
    if (item.memberId !== memberId) return false;
    if (!mensalidadeIds.has(item.movementTypeId)) return false;
    return near(item.amount, amount) || (member ? matchesMemberFee(member, amount) : false);
  });
  return matches.find((item) => item.date.startsWith(month)) ?? matches[0];
}

function matchesMemberFee(member: StatementCatalog["members"][number], amount: number) {
  return matchesMensalidadeAmount(
    { branch: member.branch, clubeLtc: Boolean(member.clubeLtc), monthlyFee: member.monthlyFee },
    amount,
  );
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function feeNameForAmount(amount: number, fees: StatementCatalog["fees"]) {
  const hit = (fees ?? []).find((fee) => near(amount, fee.amount));
  return hit?.name ?? null;
}

function near(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.05;
}
