import React, { useEffect, useMemo, useState } from 'react';
import { color, font, radius } from '../theme/tokens';

/**
 * Lists in batches: "Show 20 / 50 / 100 entries" on the left, a search box on
 * the right, and a footer to move between batches. The size is remembered
 * across screens and visits, so an operator who prefers 100 sets it once.
 */
export const PAGE_SIZES = [20, 50, 100];
const SIZE_KEY = 'vibelink:page-size';

function readSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return PAGE_SIZES.includes(n) ? n : PAGE_SIZES[0];
  } catch {
    return PAGE_SIZES[0];
  }
}

/** Everything a row says as text, for the search box: its strings and numbers. */
const flatten = (row) =>
  Object.values(row ?? {})
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' ')
    .toLowerCase();

/**
 * Search + batches over a list. `text(row)` is what the search box looks in
 * (defaults to the row's own strings and numbers).
 */
export function useTable(rows, text = flatten) {
  const [query, setQuery] = useState('');
  const [size, setSizeState] = useState(readSize);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) => String(text(r)).toLowerCase().includes(q));
  }, [rows, query, text]);

  const pages = Math.max(1, Math.ceil(filtered.length / size));
  // A shorter list (a filter, a delete) can leave the current page past the end.
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const pageRows = filtered.slice(start, start + size);

  const setSize = (n) => {
    setSizeState(n);
    setPage(1);
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* not remembered */ }
  };
  const search = (q) => { setQuery(q); setPage(1); };

  return {
    query, search, size, setSize, page: current, setPage, pages,
    filtered, pageRows, from: filtered.length ? start + 1 : 0, to: start + pageRows.length,
  };
}

const control = {
  border: `1px solid ${color.line}`, borderRadius: radius.md ?? 8, background: color.cardBg,
  color: color.ink, fontSize: 13, padding: '6px 10px', fontFamily: 'inherit',
};

/**
 * "Show [20] entries" and "Search: [ ]". `extra` sits between them (selection
 * shortcuts). Hidden for a short list unless `always`, so small tables stay plain.
 */
export function TableToolbar({ t, total, always = false, extra = null }) {
  if (!always && total <= PAGE_SIZES[0] && !t.query) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '4px 0 12px' }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: color.muted }}>
        Show
        <select value={t.size} onChange={(e) => t.setSize(Number(e.target.value))} style={control} aria-label="Entries per page">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        entries
      </label>
      {extra}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: color.muted }}>
        Search:
        <input
          type="search"
          value={t.query}
          onChange={(e) => t.search(e.target.value)}
          placeholder="Search…"
          style={{ ...control, minWidth: 180 }}
        />
      </label>
    </div>
  );
}

const pageBtn = (on, disabled) => ({
  border: `1px solid ${on ? color.green : color.line}`, background: on ? color.green : color.cardBg,
  color: on ? '#fff' : color.ink, borderRadius: 6, padding: '4px 10px', fontSize: 12.5,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, fontFamily: font.sans ?? 'inherit',
});

/** "Showing 1 to 20 of 240 entries" and the way to the other batches. */
export function TableFooter({ t, total, always = false }) {
  if (!t.filtered.length) return null;
  if (!always && t.pages <= 1 && total <= PAGE_SIZES[0] && !t.query) return null;
  // A window of page numbers around the current one, always with the first and last.
  const nums = [];
  for (let n = 1; n <= t.pages; n++) {
    if (n === 1 || n === t.pages || Math.abs(n - t.page) <= 1) nums.push(n);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 0 4px', fontSize: 13, color: color.muted }}>
      <span>
        Showing {t.from} to {t.to} of {t.filtered.length} entries
        {t.filtered.length !== total ? ` (filtered from ${total})` : ''}
      </span>
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <button type="button" style={pageBtn(false, t.page <= 1)} disabled={t.page <= 1} onClick={() => t.setPage(t.page - 1)}>Previous</button>
        {nums.map((n, i) => (n === '…'
          ? <span key={`gap${i}`} style={{ padding: '0 4px' }}>…</span>
          : <button key={n} type="button" style={pageBtn(n === t.page, false)} onClick={() => t.setPage(n)}>{n}</button>))}
        <button type="button" style={pageBtn(false, t.page >= t.pages)} disabled={t.page >= t.pages} onClick={() => t.setPage(t.page + 1)}>Next</button>
      </div>
    </div>
  );
}

/**
 * Select-a-batch shortcuts: pick the rows on this page, every match, or none.
 * `ids(rows)` maps rows to the ids the screen tracks. Shown only once there is
 * something to say (a full page ticked, or anything selected).
 */
export function SelectionHint({ t, selected, setSelected, ids }) {
  const pageIds = ids(t.pageRows);
  const allIds = ids(t.filtered);
  const pageFull = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const linkStyle = { color: color.green, cursor: 'pointer', fontWeight: 600, background: 'none', border: 0, padding: 0, font: 'inherit' };
  if (!selected.size && !pageFull) return <span />;
  const allPicked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  return (
    <span style={{ fontSize: 13, color: color.muted, display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      {selected.size} selected
      {!allPicked && allIds.length > pageIds.length && (
        <button type="button" style={linkStyle} onClick={() => setSelected(new Set(allIds))}>Select all {allIds.length}</button>
      )}
      <button type="button" style={linkStyle} onClick={() => setSelected(new Set())}>Clear</button>
    </span>
  );
}
