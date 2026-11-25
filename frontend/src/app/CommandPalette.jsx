import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { NAV_SECTIONS } from './nav';
import { useSearchResults } from './searchResults';

/**
 * Ctrl K (Cmd K on a Mac), or a tap on the search box: one box that finds anything and goes there.
 *
 * Three sources, shown together: what this screen already has loaded (instant), what the server finds that is not loaded
 * (any payment by M-Pesa code, invoices, leads, every voucher), and pages and actions by name. Arrow keys move, Enter
 * opens, Esc closes. Everything listed is something this staff member's role may open.
 */
const ACTIONS = [
  { title: 'Add a client', to: '/clients/new', perm: 'clients.create', words: 'add new client customer create' },
  { title: 'Reconcile a statement', to: '/payments?reconcile=1', perm: 'payments.apply', words: 'reconcile statement mpesa paste' },
  { title: 'Send a message', to: '/messaging', perm: 'messaging.send', words: 'sms message broadcast send bulk' },
  { title: 'Make vouchers', to: '/hotspot/vouchers', perm: 'hotspot.vouchers', words: 'vouchers generate print hotspot codes' },
  { title: 'Buy SMS credit', to: '/settings?tab=sms', perm: null, words: 'sms credit buy top up balance' },
];
const MPESA = /^[A-Z0-9]{10}$/;

function pagesOf(perms) {
  const out = [];
  const add = (it, parent) => {
    if (it.perm && !perms?.[it.perm]) return;
    if (it.to) out.push({ title: it.label, to: it.to, detail: parent ?? 'Page' });
    (it.children ?? []).forEach((c) => add(c, it.label));
  };
  NAV_SECTIONS.forEach((s) => s.items.forEach((it) => add(it, null)));
  return out;
}

export default function CommandPalette({ open, onClose }) {
  const store = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const perms = store.session?.perms ?? {};
  const local = useSearchResults(q, store);

  useEffect(() => { if (open) { setQ(''); setRemote([]); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  // The server is asked once typing pauses, and an answer that arrives after a newer question is dropped.
  useEffect(() => {
    if (!open) return undefined;
    const needle = q.trim();
    if (needle.length < 2) { setRemote([]); setLoading(false); return undefined; }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(needle).then((r) => { if (live) setRemote(r); }).catch(() => { if (live) setRemote([]); }).finally(() => { if (live) setLoading(false); });
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pages = pagesOf(perms);
    const acts = ACTIONS.filter((a) => !a.perm || perms[a.perm] || store.session?.is_super_admin);
    if (!needle) {
      return [{ name: 'Actions', items: acts.map((a) => ({ ...a, kind: 'Action' })) }, { name: 'Pages', items: pages.slice(0, 8).map((p) => ({ ...p, kind: 'Page' })) }];
    }
    // The same thing found both on screen and on the server is listed once.
    const seen = new Set();
    const found = [...local, ...remote].filter((r) => { const k = `${r.kind}|${r.to}|${r.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const upper = q.trim().toUpperCase();
    const extra = [];
    if (MPESA.test(upper) && (perms['payments.apply'] || store.session?.is_super_admin) && !found.some((r) => r.kind === 'Payment' && String(r.title).toUpperCase().startsWith(upper))) {
      extra.push({ kind: 'Action', title: `Confirm ${upper} with M-Pesa`, detail: 'Not in billing yet: check it and apply it', to: `/payments?reconcile=${upper}` });
    }
    const matchText = (s) => String(s).toLowerCase().includes(needle);
    const actHits = acts.filter((a) => matchText(a.title) || matchText(a.words)).map((a) => ({ ...a, kind: 'Action' }));
    const pageHits = pages.filter((p) => matchText(p.title)).slice(0, 6).map((p) => ({ ...p, kind: 'Page' }));
    return [
      { name: 'Found', items: [...extra, ...found].slice(0, 30) },
      { name: 'Actions', items: actHits },
      { name: 'Pages', items: pageHits },
    ].filter((g) => g.items.length);
  }, [q, local, remote, perms, store.session]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${sel}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;
  const go = (item) => { if (!item) return; onClose(); navigate(item.to); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let i = -1;
  return createPortal(
    <div
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(18,23,21,.35)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '10vh 12px 12px' }}
    >
      <div role="dialog" aria-modal="true" aria-label="Search" style={{ width: '100%', maxWidth: 560, background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: 12, boxShadow: '0 24px 60px rgba(18,23,21,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '75vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${color.line}` }}>
          <span aria-hidden="true" style={{ color: color.mutedSoft, fontSize: 16 }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Name, phone, account, M-Pesa code, invoice, voucher, page…"
            aria-label="Search"
            aria-activedescendant={flat.length ? `cp-${sel}` : undefined}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: color.ink }}
          />
          {loading && <span style={{ fontSize: 11.5, color: color.muted }}>Searching…</span>}
          <kbd style={{ font: `500 11px ${font.mono}`, padding: '2px 6px', border: `1px solid ${color.line}`, borderRadius: 5, color: color.muted }}>Esc</kbd>
        </div>
        <div ref={listRef} role="listbox" style={{ overflowY: 'auto', padding: '4px 0 8px' }}>
          {groups.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: color.muted }}>{loading ? 'Searching…' : `Nothing found for "${q}".`}</div>
          )}
          {groups.map((g) => (
            <div key={g.name}>
              <div style={{ padding: '10px 14px 4px', fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: color.muted }}>{g.name}</div>
              {g.items.map((it) => {
                i += 1;
                const me = i;
                const on = me === sel;
                return (
                  <div
                    key={`${g.name}-${me}`}
                    id={`cp-${me}`}
                    data-i={me}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => setSel(me)}
                    onClick={() => go(it)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: on ? '#e7f5ef' : 'transparent' }}
                  >
                    <span style={{ width: 26, height: 26, flex: 'none', borderRadius: 6, background: color.subtleBg, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: color.green }}>
                      {it.kind === 'Action' ? '→' : it.kind === 'Page' ? '#' : it.kind[0]}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                      {it.detail && <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.detail}</span>}
                    </span>
                    <span style={{ fontSize: 11, color: color.neutralInk, background: color.tileBg, padding: '2px 8px', borderRadius: radius.pill, fontWeight: 600, flex: 'none' }}>{it.kind}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${color.line}`, padding: '7px 14px', fontSize: 11.5, color: color.muted, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>↑ ↓ to move</span><span>Enter to open</span><span>Ctrl K to open from anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
