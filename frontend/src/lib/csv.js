/** Quote a value for CSV: wrap in quotes and double any embedded quotes. */
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Trigger a browser download of `rows` (array of arrays) as a .csv file. */
export function downloadCsv(filename, rows) {
  const body = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  // BOM so Excel opens UTF-8 (Swahili names, the KES sign) correctly.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  return rows.length - 1; // data rows, excluding the header
}

/**
 * Parse a CSV file into objects keyed by header.
 * Handles quoted fields and embedded commas/newlines — enough for a spreadsheet
 * export, not a full RFC 4180 implementation.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const cleaned = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!cleaned.length) return [];
  const header = cleaned[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return cleaned.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
