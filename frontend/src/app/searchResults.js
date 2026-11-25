import { useMemo } from 'react';
import { cur } from '../theme/tokens';

/**
 * Global search across the loaded collections — the React version of
 * searchMatches() in the mockup.
 */
export function useSearchResults(q, store) {
  return useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hit = (v) => String(v ?? '').toLowerCase().includes(needle);
    const out = [];

    for (const c of store.clients) {
      if (hit(c.name) || hit(c.phone) || hit(c.account_code) || hit(c.static_ip) || hit(c.pppoe_user))
        out.push({ kind: 'Client', title: c.name, detail: `${c.account_code ?? ''} · ${c.phone ?? ''}`, to: `/clients/${c.id}` });
    }
    for (const p of store.unmatched) {
      if (hit(p.provider_ref) || hit(p.payer_phone) || hit(p.payer_name) || hit(p.raw_account))
        out.push({ kind: 'Payment', title: p.provider_ref, detail: `${cur()} ${p.amount} · ${p.payer_phone ?? ''}`, to: `/payments?open=${p.id}` });
    }
    for (const t of store.tickets) {
      if (hit(t.subject) || hit(t.number))
        out.push({ kind: 'Ticket', title: t.subject, detail: t.number, to: `/tickets?open=${t.id}` });
    }
    for (const r of store.routers) {
      if (hit(r.name) || hit(r.host) || hit(r.nas_identifier))
        out.push({ kind: 'Router', title: r.name, detail: String(r.host ?? ''), to: `/routers?open=${r.id}` });
    }
    for (const v of store.vouchers) {
      if (hit(v.code) || hit(v.phone))
        out.push({ kind: 'Voucher', title: v.code, detail: v.status, to: `/hotspot/vouchers?open=${encodeURIComponent(v.code)}` });
    }
    for (const i of store.inventory ?? []) {
      if (hit(i.name) || hit(i.mac_address) || hit(i.serial_number) || hit(i.category))
        out.push({ kind: 'Inventory', title: i.name, detail: i.mac_address || i.serial_number || `${i.quantity ?? 1}${i.unit ? ` ${i.unit}` : ''}`, to: `/inventory?open=${i.id}` });
    }
    return out.slice(0, 40);
  }, [q, store.clients, store.unmatched, store.tickets, store.routers, store.vouchers, store.inventory]);
}
