import { fold } from "../shared/csv";
import { type DatabaseShape } from "../shared/types";
import { loadDb, mutate } from "../shared/persistence/finance-store";
import { ensureIdentifyType } from "./ingest";
import { interpretStatement, type StatementCatalog } from "./statement";
import { aiConfigured, enrichWithAi } from "./statement-ai";
import { remapImportCsv, type FieldMapping } from "./import-map";
import { pdfToStatementCsv } from "./statement-pdf";

export function catalogFromDb(db: DatabaseShape): StatementCatalog {
  return {
    movementTypes: db.movementTypes,
    members: db.members.map((member) => ({
      id: member.id,
      name: member.name,
      branch: member.branch,
      monthlyFee: member.monthlyFee,
      clubeLtc: member.clubeLtc,
      status: member.status,
      accounts: db.memberAccounts
        .filter((account) => account.memberId === member.id && account.active)
        .map((account) => ({
          holderName: account.holderName,
          pixKey: account.pixKey,
          document: account.document,
        })),
      guardians: (db.memberGuardians ?? [])
        .filter((guardian) => guardian.memberId === member.id)
        .map((guardian) => ({ id: guardian.id, name: guardian.name })),
    })),
    fees: db.fees,
    pendingPayments: db.transactions
      .filter((tx) => tx.paymentStatus === "pending" && tx.type === "income")
      .map((tx) => ({
        id: tx.id,
        memberId: tx.memberId,
        amount: tx.amount,
        date: tx.date,
        movementTypeId: tx.movementTypeId,
      })),
  };
}

export async function interpretUploadedStatement(
  input: {
    csv?: string;
    pdf?: string;
    mapping?: FieldMapping;
    lineOffset?: number;
    enrichAi?: boolean;
    convertOnly?: boolean;
  },
  userId: string,
) {
  let csv = input.csv ?? "";
  if (input.pdf) {
    csv = await pdfToStatementCsv(input.pdf);
  }
  if (input.convertOnly) {
    return {
      csv,
      convertOnly: true as const,
      layout: "bank" as const,
      aiUsed: false,
      aiAvailable: aiConfigured(),
      aiMapped: false,
      mapping: {},
      sample: undefined,
      review: undefined,
      truncated: false,
      headerIndex: 0,
      rows: [],
    };
  }
  const current = await loadDb();
  if (!current.movementTypes.some((item) => item.active && fold(item.name) === "a identificar")) {
    await mutate((db) => {
      ensureIdentifyType(db, userId);
    });
  }
  const db = await loadDb();
  const catalog = catalogFromDb(db);
  const givenMapping = input.mapping && Object.keys(input.mapping).length ? input.mapping : undefined;
  const remapped = await remapImportCsv(csv, "statement", {
    mapping: givenMapping,
    review: !givenMapping,
  });
  const interpreted = interpretStatement(remapped.csv, catalog);
  const offset = input.lineOffset ?? 0;
  const shifted = offset
    ? interpreted.rows.map((row) => ({ ...row, line: row.line + offset }))
    : interpreted.rows;
  const enriched = input.enrichAi === false ? { rows: shifted, used: false } : await enrichWithAi(shifted, catalog);
  return {
    csv: remapped.csv,
    layout: interpreted.layout,
    aiUsed: enriched.used || remapped.usedAi,
    aiAvailable: aiConfigured(),
    aiMapped: remapped.usedAi,
    mapping: remapped.mapping,
    sample: remapped.sample,
    review: remapped.review,
    truncated: false,
    headerIndex: remapped.headerIndex,
    rows: enriched.rows,
  };
}
