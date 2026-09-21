import { extractText, extractTextItems } from "unpdf";
import { fold, parseSignedAmount } from "../shared/csv";

const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
const SKIP =
  /^(saldo\s+(anterior|atual|do dia|final)|sicredi fone|^sac\b|ouvidoria|periodo de|cooperativa:|associado:|^conta:|aplicacao automatica|rendimento de aplicacao)/;
const FOOTER = /\s+(sicredi fone|sac\b|ouvidoria)\b.*$/i;

export function looksLikeBankStatement(text: string): boolean {
  const key = fold(text);
  return (
    key.includes("saldo anterior") ||
    key.includes("pix_cred") ||
    key.includes("pix_deb") ||
    key.includes("recebimento pix") ||
    (key.includes("extrato") && (key.includes("valor") || key.includes("historico") || key.includes("descricao")))
  );
}

export function statementTextToCsv(text: string): string {
  const normalized = text.replace(/\u00a0/g, " ");
  const header = normalized.search(/data\s+descri[cç][aã]o/i);
  const body = header >= 0 ? normalized.slice(header) : normalized;
  const chunks = body
    .split(/(?=\d{2}\/\d{2}\/\d{4})/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const rows = ["data;historico;valor;tipo"];
  for (const chunk of chunks) {
    const match = chunk.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
    if (!match) continue;
    const date = match[1]!;
    let rest = match[2]!.replace(FOOTER, "").trim();
    if (SKIP.test(fold(rest))) continue;
    if (/^a\s+\d{2}\/\d{2}\/\d{4}/i.test(rest)) continue;

    const amounts = rest.match(MONEY) ?? [];
    if (amounts.length === 0) continue;

    let valueRaw: string;
    let description: string;
    if (amounts.length >= 2) {
      valueRaw = amounts[amounts.length - 2]!;
      const saldo = amounts[amounts.length - 1]!;
      const beforeSaldo = rest.slice(0, rest.lastIndexOf(saldo)).trim();
      const valueAt = beforeSaldo.lastIndexOf(valueRaw);
      description = (valueAt >= 0 ? beforeSaldo.slice(0, valueAt) : beforeSaldo).trim();
    } else {
      valueRaw = amounts[0]!;
      description = rest.slice(0, rest.lastIndexOf(valueRaw)).trim();
    }

    description = description.replace(/\s+/g, " ").trim();
    if (description.length < 3 || SKIP.test(fold(description))) continue;

    const signed = signedFromHistory(description, parseSignedAmount(valueRaw));
    if (!Number.isFinite(signed) || signed === 0) continue;
    const abs = Math.abs(signed).toFixed(2).replace(".", ",");
    const tipo = signed < 0 ? "saida" : "entrada";
    const line = `${date};${csvEscape(description)};${signed < 0 ? `-${abs}` : abs};${tipo}`;
    if (rows.includes(line)) continue;
    rows.push(line);
  }
  return rows.length > 1 ? rows.join("\n") : "";
}

export async function extractPdfText(data: Uint8Array): Promise<string> {
  try {
    const { items } = await extractTextItems(data);
    const pages = items.map((page) => {
      let line = "";
      const lines: string[] = [];
      for (const item of page) {
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.replace(/\s+/g, " ").trim());
          line = "";
        } else if (item.str && !line.endsWith(" ")) {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
      return lines.filter(Boolean).join("\n");
    });
    const joined = pages.join("\n").trim();
    if (joined) return joined;
  } catch {
    // fallback abaixo
  }
  const extracted = await extractText(data, { mergePages: true });
  return extracted.text.trim();
}

export async function pdfToStatementCsv(base64: string): Promise<string> {
  const bytes = decodePdfBase64(base64);
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
    throw new Error("Arquivo PDF inválido");
  }
  const text = await extractPdfText(bytes);
  if (!text) {
    throw new Error("Não foi possível ler o texto deste PDF");
  }
  if (!looksLikeBankStatement(text)) {
    throw new Error("Este PDF não parece um extrato bancário");
  }
  const csv = statementTextToCsv(text);
  if (!csv) {
    throw new Error("Nenhum lançamento encontrado no PDF");
  }
  return csv;
}

export function decodePdfBase64(value: string): Uint8Array {
  const cleaned = value.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  return Uint8Array.from(Buffer.from(cleaned, "base64"));
}

export function signedFromHistory(description: string, amount: number): number {
  if (!Number.isFinite(amount) || amount === 0) return amount;
  const abs = Math.abs(amount);
  const direction = inferBankDirection(description);
  if (direction === "expense") return -abs;
  if (direction === "income") return abs;
  return amount;
}

export function inferBankDirection(description: string): "income" | "expense" | null {
  const key = fold(description);
  if (/\b(pix_cred|recebimento|pix recebido|ted recebida|deposito)\b/.test(key)) return "income";
  if (/\b(pix_deb|pix enviado|envio pix|tarifa|ted enviada)\b/.test(key)) return "expense";
  if (/\bpagamento\b/.test(key) && !/\brecebimento\b/.test(key)) return "expense";
  return null;
}

function csvEscape(value: string): string {
  if (/[;"\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
