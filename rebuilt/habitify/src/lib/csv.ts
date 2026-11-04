/** Minimal RFC 4180 CSV reader/writer with delimiter sniffing and spreadsheet-formula guarding. */

export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  let best = ',', bestCount = 0;
  for (const d of [',', ';', '\t']) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCSV(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (c === delim) {
      endField();
      i++;
    } else if (c === '\r') {
      i++;
      if (text[i] === '\n') i++;
      endRow();
    } else if (c === '\n') {
      i++;
      endRow();
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Rows -> array of objects keyed by (trimmed) header names. */
export function parseCSVRecords(input: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCSV(input);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0]!.map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = r[idx] ?? '';
    });
    return rec;
  });
  return { headers, records };
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Text cells that a spreadsheet could execute as a formula get a leading apostrophe. */
export function guardCell(s: string): string {
  return FORMULA_START.test(s) ? "'" + s : s;
}
export function unguardCell(s: string): string {
  return s.length > 1 && s[0] === "'" && FORMULA_START.test(s.slice(1)) ? s.slice(1) : s;
}

export function escapeCell(v: string | number | boolean | undefined | null): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(headers: string[], rows: (string | number | boolean | undefined | null)[][]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const r of rows) lines.push(r.map(escapeCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
