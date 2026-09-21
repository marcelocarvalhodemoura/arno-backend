export type CsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export function csvLines(text: string): string[] {
  const raw = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return splitCsvLines(raw);
}

export function csvCells(line: string): string[] {
  return splitCsvRow(line, detectDelimiter(line));
}

export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function uniquifyHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = (seen.get(header) ?? 0) + 1;
    seen.set(header, count);
    return count === 1 ? header : `${header}_${count}`;
  });
}

export function parseCsv(text: string, headerIndex = 0): CsvTable {
  const raw = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!raw) return { headers: [], rows: [] };
  const lines = splitCsvLines(raw);
  if (lines.length === 0) return { headers: [], rows: [] };
  const start = Math.min(Math.max(headerIndex, 0), lines.length - 1);
  const usable = lines.slice(start);
  const delimiter = detectDelimiter(usable[0] ?? "");
  const headers = uniquifyHeaders(splitCsvRow(usable[0] ?? "", delimiter).map(normalizeHeader));
  const rows = usable.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cells = splitCsvRow(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    if (Object.values(row).every((value) => !value)) return [];
    return [row];
  });
  return { headers, rows };
}

export function pick(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const value = row[key];
    if (value) return value;
  }
  return "";
}

export function parseIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return trimmed;
  const br = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (br) {
    const day = br[1]!.padStart(2, "0");
    const month = br[2]!.padStart(2, "0");
    const year = br[3]!;
    const stamp = `${year}-${month}-${day}`;
    const date = new Date(`${stamp}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return stamp;
  }
  const serial = Number(trimmed.replace(",", "."));
  if (Number.isFinite(serial) && serial >= 20000 && serial < 80000) {
    const utc = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  return null;
}

export function parseSignedAmount(value: string): number {
  const trimmed = value
    .trim()
    .replace(/^r\$\s*/i, "")
    .replace(/\s/g, "");
  if (!trimmed) return Number.NaN;
  const wrapped = /^\(.*\)$/.test(trimmed);
  const negative = wrapped || trimmed.startsWith("-");
  const raw = trimmed.replace(/[()]/g, "").replace(/^[-+]/, "");
  let amount: number;
  if (raw.includes(",") && raw.includes(".")) {
    amount = Number(raw.replace(/\./g, "").replace(",", "."));
  } else if (raw.includes(",")) {
    amount = Number(raw.replace(",", "."));
  } else {
    amount = Number(raw);
  }
  if (!Number.isFinite(amount)) return Number.NaN;
  return negative ? -Math.abs(amount) : amount;
}

export function normalizeHeader(value: string): string {
  return fold(value)
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_|_$/g, "");
}

function detectDelimiter(headerLine: string): "," | ";" {
  return (headerLine.match(/;/g)?.length ?? 0) >= (headerLine.match(/,/g)?.length ?? 0) ? ";" : ",";
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === "\n" && !quoted) {
      lines.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) lines.push(current);
  return lines;
}

function splitCsvRow(line: string, delimiter: "," | ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}
