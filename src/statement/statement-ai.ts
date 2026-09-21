import { findType, type SuggestedTx, type StatementCatalog } from "./statement";
import { aiConfigured, chatJson } from "../shared/openai";

export { aiConfigured };

type AiHit = {
  line: number;
  movementTypeName?: string;
  memberName?: string;
  branch?: string;
  nature?: "fixed" | "variable";
  method?: string;
  reason?: string;
};

export async function enrichWithAi(
  rows: SuggestedTx[],
  catalog: StatementCatalog,
): Promise<{ rows: SuggestedTx[]; used: boolean }> {
  const pending = rows.filter((row) => !row.error && row.confidence === "low").slice(0, 40);
  if (!aiConfigured() || pending.length === 0) return { rows, used: false };

  const types = catalog.movementTypes.filter((item) => item.active).map((item) => item.name);
  const members = catalog.members.filter((item) => item.status !== "inactive").map((item) => item.name);
  const parsed = await chatJson<{ rows?: AiHit[] }>(
    'Você classifica lançamentos de extrato da tesouraria de um grupo escoteiro brasileiro. Responda só JSON no formato {"rows":[...]}. Use apenas tipos e associados da lista. Não invente valores nem datas.',
    {
      tipos: types,
      associados: members,
      ramos: ["filhote", "lobinho", "escoteiro", "senior", "pioneiro", "flor-de-lis", "grupo"],
      meios: ["pix", "cash", "transfer", "card", "other"],
      linhas: pending.map((row) => ({
        line: row.line,
        data: row.date,
        descricao: row.description,
        valor: row.amount,
        direcao: row.type,
      })),
    },
  );
  if (!parsed?.rows?.length) return { rows, used: false };
  const hits = new Map(parsed.rows.map((hit) => [hit.line, hit]));
  const next = rows.map((row) => applyHit(row, hits.get(row.line), catalog));
  return { rows: next, used: true };
}

function applyHit(row: SuggestedTx, hit: AiHit | undefined, catalog: StatementCatalog): SuggestedTx {
  if (!hit || row.error) return row;
  const movement = hit.movementTypeName ? findType(catalog.movementTypes, hit.movementTypeName) : null;
  const member = hit.memberName
    ? catalog.members.find((item) => foldName(item.name) === foldName(hit.memberName ?? ""))
    : undefined;
  const method = ["pix", "cash", "transfer", "card", "other"].includes(hit.method ?? "")
    ? (hit.method as SuggestedTx["method"])
    : row.method;
  const nature = hit.nature === "fixed" || hit.nature === "variable" ? hit.nature : row.nature;
  const branch =
    member?.branch ??
    (["filhote", "lobinho", "escoteiro", "senior", "pioneiro", "flor-de-lis", "grupo"].includes(hit.branch ?? "")
      ? (hit.branch as SuggestedTx["branch"])
      : row.branch);

  if (!movement && !member) return row;
  return {
    ...row,
    movementTypeId: movement?.id ?? row.movementTypeId,
    movementTypeName: movement?.name ?? row.movementTypeName,
    memberId: member?.id ?? row.memberId,
    memberName: member?.name ?? row.memberName,
    memberGuardianId:
      member?.guardians?.find(
        (item) => foldName(row.description).includes(foldName(item.name)) && item.name.length >= 5,
      )?.id ?? row.memberGuardianId,
    memberGuardianName:
      member?.guardians?.find(
        (item) => foldName(row.description).includes(foldName(item.name)) && item.name.length >= 5,
      )?.name ?? row.memberGuardianName,
    branch,
    method,
    nature,
    confidence: "medium",
    hint: hit.reason ? `Modelo: ${hit.reason}` : "Sugestão do modelo",
    error: (movement?.id ?? row.movementTypeId) ? undefined : row.error,
  };
}

function foldName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
