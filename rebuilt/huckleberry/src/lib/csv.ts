/** Minimal RFC 4180 CSV reader/writer (quotes, escaped quotes, newlines in cells, BOM). */

export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t']) {
    // count delimiters outside quotes
    let n = 0;
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // drop fully blank rows
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function escapeCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  // guard against spreadsheet formula injection from free-text notes
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? "'" + s : s;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
