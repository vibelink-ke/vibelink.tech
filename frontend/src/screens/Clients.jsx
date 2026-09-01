import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, font, radius, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { useAction, ActionResult } from '../ui/action';
import { api } from '../api/client';
import { parseCsv } from '../lib/csv';
import ExpiryCalendar from './clients/ExpiryCalendar';
import { Button, Empty, Field, Input, Modal, RowAction, RowActions, Screen, Select } from '../ui/primitives';

// KopoKopo is hotspot-only by policy (db kopokopo_hotspot_only constraint) —
// it can't actually charge a PPPoE customer, so it's not offered here.
const AUTOPAY_OPTIONS = [
  { value: '', label: 'Off' },
  { value: 'daraja', label: 'M-Pesa Paybill (Daraja)' },
  { value: 'bankstk', label: 'Bank STK push' },
];

/**
 * Usable host addresses in an IPv4 CIDR block — network and broadcast
 * excluded, capped at 254 results so a dropdown never has to render more
 * than that.
 *
 * Used to also refuse outright — return nothing at all — for any pool over
 * 256 addresses, on the theory that someone had typed a /16 by mistake. Real
 * pools routinely aren't /24s: the auto-created expired-customer pools are
 * /20 (4096 addresses), and an operator's own PPPoE pool is whatever size
 * they actually need. The dropdown read as having zero free addresses for
 * any of them — indistinguishable from the pool genuinely being full. The
 * loop itself was always bounded to `max` results; only the guard in front
 * of it was refusing to let it run. Iteration is still bounded (not just the
 * output) so a genuinely huge block someone did type by mistake — a /8 —
 * can't scan millions of addresses just to fill 254 dropdown rows.
 */
function hostsInCidr(cidr, max = 254) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(cidr ?? '').trim());
  if (!m) return [];
  const [, a, b, c, d, bits] = m.map(Number);
  const base = (a << 24) | (b << 16) | (c << 8) | d;
  const size = 2 ** (32 - bits);
  if (size < 2) return [];
  const scanLimit = Math.min(size - 1, 65536);
  const out = [];
  for (let i = 1; i < scanLimit && out.length < max; i++) {
    const ip = (base + i) >>> 0;
    out.push([(ip >>> 24) & 255, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.'));
  }
  return out;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  // Online means a live session, not "paid up" — those are different questions
  // and the tab claiming to answer the first was answering the second.
  { key: 'online', label: 'Online', match: (c) => !!c.online },
  { key: 'owing', label: 'Owing but online', match: (c) => !!c.online
      && ['expired', 'suspended', 'paused'].includes(c.status) },
  { key: 'grace', label: 'Grace period', match: (c) => c.status === 'grace' },
  { key: 'expired', label: 'Expired', match: (c) => c.status === 'expired' },
  // Paused and suspended are different states now, so they need different tabs —
  // otherwise a paused client appears nowhere but All.
  { key: 'paused', label: 'Paused', match: (c) => c.status === 'paused' },
  { key: 'suspended', label: 'Suspended', match: (c) => c.status === 'suspended' },
];

const STATUS_DOT = {
  active: color.mint,
  grace: color.amber,
  expired: '#c05a2e',
  paused: color.amberInk,
  suspended: color.rust,
};

/**
 * What this customer is, in the terms an operator acts on.
 *
 * Billing status alone could not tell these apart, and they need different
 * things done:
 *
 *   online          paid and connected — nothing to do
 *   active, offline paid but not connected — a fault, or they are simply out
 *   expired         not paid and not connected — a collection call
 *   expired, online not paid and still connected — the line should have been
 *                   cut and was not, which is money going out of the door
 */
function presence(c) {
  const paidUp = !['expired', 'suspended', 'paused'].includes(c.status);
  if (c.online && !paidUp) {
    return { label: `${c.status} · online`, colour: color.rust, weight: 700,
             note: 'still connected — not paid' };
  }
  if (c.online) return { label: 'online', colour: color.green, weight: 600, note: 'connected now' };
  if (!paidUp) return { label: c.status, colour: STATUS_DOT[c.status] ?? color.muted, weight: 600, note: 'offline' };
  return { label: c.status, colour: color.muted, weight: 500, note: 'offline' };
}

/** "3m ago", "2d ago" — a duration reads faster than a timestamp in a table. */
const seenAgo = (iso) => {
  if (!iso) return 'never seen';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const th = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.07em',
  color: color.muted,
  padding: '14px 12px 10px 0',
  whiteSpace: 'nowrap',
};
const td = { padding: '12px 12px 12px 0', borderTop: '1px solid #f1f3ef', verticalAlign: 'top' };
const action = { fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 };

const expiryLabel = (c) => {
  if (!c.expires_at) return ['—', ''];
  const d = new Date(c.expires_at);
  const days = Math.round((d - Date.now()) / 86400000);
  const note = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `in ${days}d`;
  return [d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }), note];
};

export default function Clients() {
  const store = useStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [checking, setChecking] = useState(false);
  // 'list' or 'calendar'. The list answers "who is next"; the calendar answers
  // "what does this week look like".
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);

  const clients = store.clients ?? [];
  // subscribers.plan_id references plans, not tariffs.
  const planById = useMemo(
    () => Object.fromEntries((store.plans ?? []).map((p) => [p.id, p])),
    [store.plans]
  );
  const routerById = useMemo(
    () => Object.fromEntries((store.routers ?? []).map((r) => [r.id, r])),
    [store.routers]
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.key, f.match ? clients.filter(f.match).length : clients.length])
      ),
    [clients]
  );

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    return f?.match ? clients.filter(f.match) : clients;
  }, [clients, filter]);

  // One row per account, not one per line — a customer with several PPPoE
  // connections is one account paying one bill, not several strangers who
  // happen to share a number. The primary line (no line_label, or just the
  // first) carries the row; the rest show as a "N services" count that
  // opens the same account's Services tab.
  const visibleAccounts = useMemo(() => {
    const groups = new Map();
    for (const c of visible) {
      if (!groups.has(c.account_code)) groups.set(c.account_code, []);
      groups.get(c.account_code).push(c);
    }
    return [...groups.values()].map((lines) => ({
      primary: lines.find((l) => !l.line_label) ?? lines[0],
      lines,
    }));
  }, [visible]);

  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected((s) => {
      if (allSelected) return new Set();
      const n = new Set(s);
      visible.forEach((c) => n.add(c.id));
      return n;
    });

  const count = selected.size;
  const selectedClients = () => visible.filter((c) => selected.has(c.id));

  /** Flip every selected client between suspended and active. */
  const bulkPause = async () => {
    const picked = selectedClients();
    if (!picked.length) return store.toast('Select at least one client first');
    const results = await Promise.allSettled(
      picked.map((c) => api.setSubscriberAccess(c.id, c.status === 'active' ? 'pause' : 'resume'))
    );
    const done = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    store.setCollection('clients', (cs) => cs.map((c) => done.find((d) => d.id === c.id) ?? c));
    const failed = picked.length - done.length;
    store.toast(failed ? `Updated ${done.length}, ${failed} failed` : `Updated ${done.length} client(s)`);
    setSelected(new Set());
  };

  const bulkSms = async () => {
    const picked = selectedClients();
    if (!picked.length) return store.toast('Select at least one client first');
    const body = window.prompt(`Message to send to ${picked.length} client(s):`);
    if (!body?.trim()) return;
    const results = await Promise.allSettled(
      picked.map((c) => api.sendMessage({ subscriberId: c.id, body, channel: 'sms' }))
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    store.toast(sent === picked.length ? `Sent to ${sent} client(s)` : `Sent ${sent} of ${picked.length}`);
  };

  const bulkCompensate = async () => {
    const picked = selectedClients();
    if (!picked.length) return store.toast('Select at least one client first');
    const raw = window.prompt(`Free days to add to ${picked.length} client(s):`, '1');
    if (raw === null) return;
    const days = Number(raw);
    if (!Number.isFinite(days) || days <= 0) return store.toast('Enter a positive number of days');
    try {
      const out = await api.compensateSubscribers(picked.map((c) => c.id), days);
      store.setCollection('clients', (cs) =>
        cs.map((c) => {
          const hit = out.rows?.find((r) => r.id === c.id);
          return hit ? { ...c, expires_at: hit.expires_at } : c;
        })
      );
      store.toast(`Added ${out.days} day(s) to ${out.compensated} client(s)`);
      setSelected(new Set());
    } catch (e) {
      store.toast(`Could not compensate: ${e.message}`);
    }
  };

  const action = useAction();

  /** CSV import. Expected headers: name, phone, account_code, plan, static_ip. */
  const importCsv = () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.csv,text/csv';
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) return;
      const rows = parseCsv(await file.text());
      if (!rows.length) return store.toast('That file had no rows');

      const planByTitle = new Map((store.plans ?? []).map((p) => [p.title.toLowerCase(), p.id]));
      const results = await Promise.allSettled(
        rows.map((r) =>
          api.createSubscriber({
            name: r.name,
            phone: r.phone,
            accountCode: r.account_code || r.account || r.phone,
            service: (r.service || 'pppoe').toLowerCase(),
            planId: planByTitle.get(String(r.plan ?? '').toLowerCase()) ?? null,
            staticIp: r.static_ip || null,
          })
        )
      );
      const made = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      store.setCollection('clients', (cs) => [...made, ...cs]);
      const failed = results.filter((r) => r.status === 'rejected');

      // A partial import is the normal case with a spreadsheet somebody
      // maintained by hand, and "3 rejected" in a toast that disappears tells
      // nobody which three or why.
      action.run('Importing clients', async () => ({ made: made.length, rows: rows.length, failed }), {
        describe: (r) => ({
          lines: [
            `${r.made} of ${r.rows} row(s) imported`,
            ...(r.failed.length
              ? [`${r.failed.length} rejected:`,
                 ...r.failed.slice(0, 5).map((f) => f.reason?.message ?? 'unknown reason')]
              : []),
          ],
        }),
      });
    };
    picker.click();
  };

  const saveEdit = async () => {
    const patch = {
      name: editing.name,
      phone: editing.phone,
      static_ip: editing.static_ip || null,
      plan_id: editing.plan_id || null,
      status: editing.status,
      // Moving a customer between towers. Their credentials travel with them —
      // RADIUS is scoped to the tenant, not the router — so this decides which
      // pool they draw an address from and which tower an engineer is sent to.
      router_id: editing.router_id || null,
      credit: editing.credit === '' || editing.credit == null ? 0 : Number(editing.credit),
      expires_at: editing.expires_at || null,
      autopay: editing.autopay || null,
      location: editing.location || null,
    };
    try {
      const updated = await api.updateSubscriber(editing.id, patch);
      // Wallet is pooled per account_code — refresh every sibling line's
      // cached wallet_balance too, not just the row just edited.
      store.setCollection('clients', (cs) => cs.map((c) => {
        if (c.id === updated.id) return updated;
        if (c.account_code === updated.account_code) return { ...c, wallet_balance: updated.wallet_balance };
        return c;
      }));
      store.toast(`${updated.name} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  /**
   * Pause, suspend and resume are three different things.
   *
   * Pause is an admin stopping the service on purpose — automation leaves those
   * alone. Suspend is a block, normally for non-payment, which a payment clears.
   * They used to be one button writing the same status, so nobody could tell the
   * two situations apart afterwards. Both are admin-only.
   */
  const setAccess = async (c, action) => {
    try {
      const updated = await api.setSubscriberAccess(c.id, action);
      store.setCollection('clients', (cs) => cs.map((x) => (x.id === c.id ? updated : x)));
      store.toast(`${c.name} ${{ pause: 'paused', suspend: 'suspended', resume: 'resumed' }[action]}`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const removeClient = async (c) => {
    try {
      await api.deleteSubscriber(c.id);
      store.setCollection('clients', (cs) => cs.filter((x) => x.id !== c.id));
      store.toast(`${c.name} deleted`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  /**
   * Ask the routers directly.
   *
   * Presence normally comes from RADIUS accounting, which is silent whenever
   * the tunnel is down or accounting was never enabled — and a customer who is
   * plainly connected then reads as offline with no way to argue. This asks the
   * router itself and says what came back, including which sites could not be
   * reached, because "0 online" means something quite different when half the
   * routers did not answer.
   */
  const checkOnline = async () => {
    setChecking(true);
    try {
      const res = await api.refreshPresence();
      await store.reload({ quiet: true });
      const parts = [`${res.online} connected on ${res.asked} router${res.asked === 1 ? '' : 's'}`];
      if (res.unreachable?.length) parts.push(`could not reach ${res.unreachable.join(', ')}`);
      if (res.noCredentials) parts.push(`${res.noCredentials} not configured yet`);
      store.toast(parts.join(' — '));
    } catch (e) {
      store.toast(`Could not ask the routers: ${e.message}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen
      title="Clients"
      subtitle="PPPoE only — monthly home & business lines. Hotspot pay-as-you-go users live under Hotspot → Vouchers."
      actions={
        <>
          <Button
            onClick={checkOnline}
            disabled={checking}
            title="Ask each router who is connected, instead of waiting for RADIUS accounting"
          >
            {checking ? 'Asking routers…' : 'Check who is online'}
          </Button>
          <Button
            onClick={() => setView((v) => (v === 'list' ? 'calendar' : 'list'))}
            title="See when every line runs out, by month"
          >
            {view === 'list' ? 'Expiry calendar' : 'Back to list'}
          </Button>
          <Button onClick={importCsv} title="CSV headers: name, phone, account_code, plan, service, static_ip">
            Bulk import CSV
          </Button>
          <Button variant="primary" onClick={() => navigate('/clients/new')}>
            + Add client
          </Button>
        </>
      }
    >
      {view === 'calendar' && (
        <div style={{
          background: '#fff', border: `1px solid ${color.line}`,
          borderRadius: radius.lg, padding: 18,
        }}>
          <ExpiryCalendar clients={clients} onOpen={(c) => navigate(`/clients/${c.id}`)} />
        </div>
      )}

      {view === 'list' && (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <div
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '6px 13px',
                borderRadius: radius.pill,
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
                background: on ? color.green : '#fff',
                color: on ? '#fff' : color.inkSoft,
                border: `1px solid ${on ? color.green : color.line}`,
              }}
            >
              {f.label} · {counts[f.key]}
            </div>
          );
        })}
      </div>
      )}

      {view === 'list' && count > 0 && (
        <div
          style={{
            background: '#fff',
            border: `1px solid ${color.line}`,
            borderRadius: radius.lg,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: '#4a524c' }}>{count} selected</span>
          <Button size="sm" onClick={bulkPause}>Pause / resume</Button>
          <Button size="sm" onClick={bulkSms}>Send SMS</Button>
          <Button size="sm" onClick={bulkCompensate}>Compensate</Button>
          <Button
            size="sm"
            style={{ background: color.rust, borderColor: color.rust, color: '#fff', fontWeight: 600 }}
            onClick={async () => {
              const ids = [...selected];
              const results = await Promise.allSettled(ids.map((id) => api.deleteSubscriber(id)));
              const gone = ids.filter((_, i) => results[i].status === 'fulfilled');
              store.setCollection('clients', (cs) => cs.filter((c) => !gone.includes(c.id)));
              setSelected(new Set());
              const failed = ids.length - gone.length;
              store.toast(failed ? `Deleted ${gone.length}, ${failed} failed` : `Deleted ${gone.length} client${gone.length > 1 ? 's' : ''}`);
            }}
          >
            Delete selected
          </Button>
        </div>
      )}

      {view === 'list' && (
      <div style={{ background: '#fff', border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '4px 20px 8px' }} className="scroll-x">
        {visibleAccounts.length === 0 ? (
          <Empty action={<Button variant="primary" onClick={() => navigate('/clients/new')}>+ Add your first client</Button>}>
            {clients.length === 0 ? 'No clients yet' : `No ${filter} clients`}
          </Empty>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ padding: '14px 10px 10px 0', width: 26 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" style={{ cursor: 'pointer' }} />
                </th>
                <th style={th}>ACCOUNT</th>
                <th style={th}>PLAN</th>
                <th style={th}>ROUTER / IP</th>
                <th style={th}>EXPIRY</th>
                <th style={th}>WALLET</th>
                <th style={th}>AUTO-PAY</th>
                <th style={th}>STATUS</th>
                <th style={{ padding: '14px 0 10px' }} />
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.map(({ primary: c, lines }) => {
                const multi = lines.length > 1;
                const plan = planById[c.plan_id];
                const rtr = routerById[c.router_id];
                const [exp, note] = expiryLabel(c);
                return (
                  <tr key={c.account_code}>
                    <td style={{ padding: '13px 10px 13px 0', borderTop: '1px solid #f1f3ef' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={`Select ${c.name}`}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span onClick={() => navigate(`/clients/${c.id}`)} style={{ fontSize: 13.5, fontWeight: 600, cursor: 'pointer', color: color.green }}>
                          {c.name}
                        </span>
                        <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted }}>
                          {c.account_code}{' · '}{c.phone}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: 13.5 }}>
                      {/* An account with several connections collapses to a
                          count here — the per-line plan/price/status/MAC each
                          has is what the Services tab on its own page is for,
                          not something this list can show N of at once. */}
                      {multi ? (
                        <span
                          onClick={() => navigate(`/clients/${c.id}?tab=services`)}
                          style={{
                            display: 'inline-flex', padding: '3px 10px', borderRadius: radius.pill,
                            fontSize: 11.5, fontWeight: 600, background: color.tileBg, color: color.green, cursor: 'pointer',
                          }}
                        >
                          {lines.length} services
                        </span>
                      ) : (
                        <>
                          {plan?.title ?? '—'}
                          <br />
                          <span style={{ fontSize: 11.5, color: color.muted }}>KES {kes(plan?.price)} / mo</span>
                        </>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: font.mono, fontSize: 12, color: '#4a524c' }}>
                      {multi ? <span style={{ color: color.muted }}>—</span> : (
                        <>
                          {rtr?.name ?? '—'}
                          <br />
                          {/* The address the router actually gave them, falling back
                              to the one assigned here. Showing only the assigned one
                              hid the case that matters: a customer connected on a
                              different address from the one on file. */}
                          {c.current_ip ? (
                            <span title="Address on the live session">{c.current_ip}</span>
                          ) : c.static_ip ? (
                            <span style={{ color: color.muted }} title="Assigned here; not connected">
                              {c.static_ip}
                            </span>
                          ) : '—'}
                          {c.current_ip && c.static_ip && c.current_ip !== String(c.static_ip).split('/')[0] && (
                            <span style={{ display: 'block', color: color.amberInk, fontSize: 11 }}
                                  title={`Assigned ${c.static_ip}`}>
                              not the assigned IP
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 13.5 }}>
                      {multi ? <span style={{ color: color.muted }}>—</span> : (
                        <>
                          {exp}
                          <br />
                          <span style={{ fontSize: 11.5, color: color.muted }}>{note}</span>
                        </>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 13.5, fontWeight: 600 }}>
                      {/* Money actually sitting on the account — pooled per
                          account_code (account_wallets), so every line
                          under a multi-service account already reports the
                          same number; take it from any one of them rather
                          than summing, which would count it once per line. */}
                      KES {kes(lines[0]?.wallet_balance ?? 0)}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-flex',
                          padding: '3px 9px',
                          borderRadius: radius.pill,
                          fontSize: 11.5,
                          fontWeight: 600,
                          background: c.autopay ? '#e2ebe5' : color.tileBg,
                          color: c.autopay ? color.green : color.neutralInk,
                        }}
                      >
                        {c.autopay ?? 'Off'}
                      </span>
                    </td>
                    <td style={td}>
                      {multi ? (
                        <span style={{ fontSize: 12.5, color: color.muted }}>
                          {lines.filter((l) => l.online).length} online
                        </span>
                      ) : (() => {
                        const p = presence(c);
                        return (
                          <>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                                           fontSize: 13, fontWeight: p.weight, color: p.colour }}>
                              <span style={{ width: 7, height: 7, borderRadius: radius.pill, background: p.colour }} />
                              {p.label}
                            </span>
                            <span style={{ display: 'block', fontSize: 11.5, color: color.muted, marginTop: 2 }}>
                              {c.online ? p.note : seenAgo(c.last_seen)}
                            </span>
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '13px 0', borderTop: '1px solid #f1f3ef', textAlign: 'right' }}>
                      <RowActions>
                      <RowAction onClick={() => navigate(`/clients/${c.id}`)}>View</RowAction>
                      {/* PPPoE: Pause/Suspend/Send STK/Edit/Delete now live under
                          that account's own Services tab on its own page — each
                          line's own row there, not duplicated here too. Hotspot
                          has no such tab, so a single-line hotspot row keeps
                          them here. */}
                      {c.service !== 'pppoe' && !multi && (
                        <>
                          <RowAction tone={color.amberInk} onClick={() => setAccess(c, c.status === 'active' ? 'pause' : 'resume')}>
                            {c.status === 'active' ? 'Pause' : 'Resume'}
                          </RowAction>
                          {store.isAdmin && c.status !== 'suspended' && (
                            <RowAction
                              tone={color.rust}
                              onClick={() => setAccess(c, 'suspend')}
                              title="Block this customer — a payment clears it"
                            >
                              Suspend
                            </RowAction>
                          )}
                          <RowAction tone={color.green} onClick={() => setEditing({ ...c, credit: c.wallet_balance ?? 0 })}>Edit</RowAction>
                          <RowAction tone={color.rust} onClick={() => removeClient(c)}>
                            Delete
                          </RowAction>
                        </>
                      )}
                      </RowActions>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      <Modal
        open={!!editing}
        title={`Edit ${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save changes</Button>
          </>
        }
      >
        {editing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" span={2}>
              <Input value={editing.name ?? ''} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} />
            </Field>
            <Field label="Phone">
              <Input value={editing.phone ?? ''} onChange={(e) => setEditing((s) => ({ ...s, phone: e.target.value }))} />
            </Field>
            <Field label="Router" hint="Which tower this line is on">
              <Select
                value={editing.router_id ?? ''}
                onChange={(e) => setEditing((v) => ({ ...v, router_id: e.target.value }))}
                options={[
                  { value: '', label: 'Not assigned' },
                  ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </Field>
            <Field label="Static IP" hint={editing.router_id ? undefined : 'Pick a router first for a pool to choose from'}>
              {(() => {
                // Every free address in this router's pool, minus whoever
                // else already holds one — typing an IP by hand risked
                // handing two lines the same address with nothing to catch
                // it until the router did, silently, to whichever session
                // reconnected second.
                // Not the expired-customers pool, even when it's the only
                // other one on this router — that range exists to be
                // firewalled off, not handed to an active client by editing
                // their static IP.
                const pool = (store.ipPools ?? [])
                  .find((p) => p.router_id === editing.router_id && p.service !== 'hotspot' && p.purpose !== 'expired');
                const taken = new Set(
                  clients.filter((c) => c.id !== editing.id && c.static_ip).map((c) => c.static_ip)
                );
                const free = pool ? hostsInCidr(pool.cidr).filter((ip) => !taken.has(ip)) : [];
                if (!pool) {
                  return (
                    <Input
                      value={editing.static_ip ?? ''}
                      onChange={(e) => setEditing((s) => ({ ...s, static_ip: e.target.value }))}
                      placeholder="10.10.0.5"
                    />
                  );
                }
                return (
                  <Select
                    value={editing.static_ip ?? ''}
                    onChange={(e) => setEditing((s) => ({ ...s, static_ip: e.target.value }))}
                    options={[
                      { value: '', label: 'No static IP' },
                      // The address already on the account stays selectable
                      // even if this pass computed it as "taken" — by itself.
                      ...(editing.static_ip && !free.includes(editing.static_ip)
                        ? [{ value: editing.static_ip, label: `${editing.static_ip} (current)` }] : []),
                      ...free.map((ip) => ({ value: ip, label: ip })),
                    ]}
                  />
                );
              })()}
            </Field>
            <Field label="Location">
              <Input
                value={editing.location ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, location: e.target.value }))}
                placeholder="Kilimani, Block C"
              />
            </Field>
            <Field label="Auto-pay" hint="Charge this gateway automatically before expiry">
              <Select
                value={editing.autopay ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, autopay: e.target.value }))}
                options={AUTOPAY_OPTIONS}
              />
            </Field>
            <Field label="Plan">
              <Select
                value={editing.plan_id ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, plan_id: e.target.value }))}
                options={[
                  { value: '', label: 'No plan' },
                  // Only this client's own service — a hotspot bundle offered
                  // to a PPPoE line (or the reverse) doesn't mean anything:
                  // issueVoucherAccess/activateSubscriber each only ever
                  // provision the one they're built for.
                  ...(store.plans ?? [])
                    .filter((p) => p.service === editing.service)
                    .map((p) => ({ value: p.id, label: p.title })),
                ]}
              />
            </Field>
            <Field label="Status">
              <Select
                value={editing.status ?? 'active'}
                onChange={(e) => setEditing((s) => ({ ...s, status: e.target.value }))}
                options={['active', 'grace', 'expired', 'suspended']}
              />
            </Field>
            <Field label="Wallet balance (KES)" hint="Shared across every line on this account, not just this one — positive credits it, negative is what they still owe">
              <Input
                type="number"
                value={editing.credit ?? 0}
                onChange={(e) => setEditing((s) => ({ ...s, credit: e.target.value }))}
              />
            </Field>
            <Field label="Expires" span={2} hint="When this line stops working without a payment">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Input
                  type="date"
                  value={editing.expires_at ? new Date(editing.expires_at).toISOString().slice(0, 10) : ''}
                  onChange={(e) => setEditing((s) => ({ ...s, expires_at: e.target.value || null }))}
                  style={{ maxWidth: 170 }}
                />
                {/* Extend from today rather than the current expiry, which may already
                    be in the past — "give them 7 more days" should mean 7 days from now,
                    not 7 days past an expiry that already lapsed. */}
                {[7, 30].map((days) => (
                  <Button
                    key={days}
                    size="sm"
                    onClick={() => setEditing((s) => ({
                      ...s,
                      expires_at: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10),
                    }))}
                  >
                    +{days}d from today
                  </Button>
                ))}
              </div>
            </Field>

            <div style={{ gridColumn: '1 / -1', borderTop: `1px solid ${color.line}`, marginTop: 4, paddingTop: 10 }}>
              <span style={{ fontSize: 12.5, color: color.muted }}>Invoices</span>
              {(() => {
                const invoices = (store.invoices ?? []).filter((i) => i.subscriber_id === editing.id);
                if (!invoices.length) {
                  return <div style={{ fontSize: 12.5, color: color.neutralInk, marginTop: 6 }}>No invoices raised for this account.</div>;
                }
                return (
                  <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                    {invoices.slice(0, 6).map((inv) => (
                      <div key={inv.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontFamily: font.mono }}>{inv.number}</span>
                          <span style={{ color: color.muted }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '—'}</span>
                          <span>KES {kes(inv.paid)} / {kes(inv.amount)}</span>
                          <span style={{ fontWeight: 600, color: inv.status === 'paid' ? color.green : color.rust }}>{inv.status}</span>
                        </div>
                        {inv.reason && <span style={{ color: color.muted, fontSize: 11.5 }}>{inv.reason}</span>}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </Modal>
      <ActionResult state={action.state} onClose={action.dismiss} />
    </Screen>
  );
}
