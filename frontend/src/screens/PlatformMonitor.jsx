import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { color, font, radius, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Empty, Screen } from '../ui/primitives';

/**
 * Every tenant on one screen, ordered by who needs attention.
 *
 * Sorted by trouble rather than by name or size on purpose: a list in
 * alphabetical order asks the reader to scan all of it every time, and this is
 * the screen most likely to be glanced at rather than studied.
 */

const th = {
  textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '.07em',
  color: color.muted, padding: '12px 10px 8px 0', whiteSpace: 'nowrap',
};
const td = { padding: '11px 10px 11px 0', borderTop: `1px solid ${color.line}`, verticalAlign: 'top' };

const ago = (iso) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/**
 * What is wrong with this tenant, worst first.
 *
 * Only things somebody would act on. "No customers yet" is a new signup, not a
 * problem, and listing it alongside a tower being down would train the reader
 * to ignore the column.
 */
function troubles(t) {
  const out = [];
  const subs = Number(t.subscribers) || 0;
  const online = Number(t.online) || 0;
  const down = Number(t.routers_down) || 0;
  const routers = Number(t.routers) || 0;

  if (t.status === 'suspended') out.push({ level: 3, text: 'suspended' });
  if (t.status === 'readonly') out.push({ level: 2, text: 'read-only — unpaid' });

  if (routers && down === routers) out.push({ level: 3, text: 'every router down' });
  else if (down) out.push({ level: 2, text: `${down} router${down === 1 ? '' : 's'} down` });

  // Customers but nobody connected: an outage that has not been reported.
  if (subs > 0 && routers > 0 && online === 0) out.push({ level: 2, text: 'nobody online' });

  if (t.licence_ends) {
    const days = Math.round((new Date(t.licence_ends) - Date.now()) / 86400000);
    if (days < 0) out.push({ level: 3, text: `licence expired ${Math.abs(days)}d ago` });
    else if (days <= 7) out.push({ level: 1, text: `licence ends in ${days}d` });
  }

  // Only once they have customers — a tenant still setting up has no revenue yet
  // and does not need chasing.
  if (subs > 0 && !t.last_payment_at) out.push({ level: 1, text: 'never collected' });
  else if (subs > 0 && t.last_payment_at
    && (Date.now() - new Date(t.last_payment_at)) > 7 * 86400000) {
    out.push({ level: 2, text: `no payment in ${ago(t.last_payment_at).replace(' ago', '')}` });
  }

  return out.sort((a, b) => b.level - a.level);
}

const LEVEL_COLOUR = { 3: color.rust, 2: '#c05a2e', 1: color.amberInk };

export default function PlatformMonitor() {
  const store = useStore();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [at, setAt] = useState(null);
  const [health, setHealth] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.platformOverview());
      // Separate call, and a failure here must not blank the tenant table: the
      // server describing itself is useful, not essential.
      api.platformHealth().then(setHealth).catch(() => setHealth(null));
      setAt(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    // A minute: slow enough to be free, fast enough that a tower going down
    // shows up while somebody is still looking at the screen.
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const ranked = useMemo(() => {
    if (!rows) return [];
    return rows
      .map((t) => ({ ...t, _t: troubles(t) }))
      .sort((a, b) => {
        const worst = (x) => (x._t[0]?.level ?? 0);
        if (worst(b) !== worst(a)) return worst(b) - worst(a);
        return (b._t.length - a._t.length) || String(a.name).localeCompare(String(b.name));
      });
  }, [rows]);

  const totals = useMemo(() => (rows ?? []).reduce((acc, t) => ({
    tenants: acc.tenants + 1,
    subscribers: acc.subscribers + Number(t.subscribers || 0),
    online: acc.online + Number(t.online || 0),
    down: acc.down + Number(t.routers_down || 0),
    collected: acc.collected + Number(t.collected_this_month || 0),
  }), { tenants: 0, subscribers: 0, online: 0, down: 0, collected: 0 }), [rows]);

  const needing = ranked.filter((t) => t._t.length).length;

  return (
    <Screen
      title="Platform monitor"
      subtitle="Every ISP on Vibelink, worst first"
      actions={<Button onClick={load}>Refresh</Button>}
    >
      {error && (
        <div style={{ fontSize: 13, color: color.rust, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
        {[
          ['Tenants', totals.tenants, needing ? `${needing} need attention` : 'all healthy'],
          ['Subscribers', totals.subscribers, `${totals.online} online now`],
          ['Routers down', totals.down, totals.down ? 'customers affected' : 'none'],
          ['Collected this month', `KES ${kes(totals.collected)}`, 'across all tenants'],
        ].map(([label, value, note]) => (
          <Card key={label}>
            <div style={{ fontSize: 11, letterSpacing: '.07em', color: color.muted }}>{String(label).toUpperCase()}</div>
            <div style={{ fontSize: 24, fontWeight: 600, margin: '4px 0 2px' }}>{value}</div>
            <div style={{ fontSize: 12, color: color.muted }}>{note}</div>
          </Card>
        ))}
      </div>


      {/* The machine everything else runs on. When a VPS fills its disk or the
          database starts answering slowly, every screen degrades in ways that
          look like unrelated faults — payments not landing, pushes timing out —
          and nobody thinks to check the host until late. */}
      {health && (
        <Card title="This server" subtitle="The VPS running Vibelink">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            {(() => {
              const gb = (b) => `${(b / 1e9).toFixed(1)} GB`;
              const pct = (used, total) => Math.round((used / total) * 100);
              const memUsed = health.memory.totalBytes - health.memory.freeBytes;
              const diskUsed = health.disk ? health.disk.totalBytes - health.disk.freeBytes : null;
              // Load is per core: over 1.0 each means work is queueing rather
              // than the machine merely being busy.
              const loadPer = health.load.one / (health.load.cores || 1);
              const days = Math.floor(health.hostUptimeSeconds / 86400);
              const hours = Math.floor((health.hostUptimeSeconds % 86400) / 3600);

              const tiles = [
                ['Database', health.db.ok ? `${health.db.ms} ms` : 'not answering',
                 health.db.ok ? 'responding' : (health.db.error ?? 'failed'),
                 health.db.ok ? null : color.rust],
                ['Memory', `${pct(memUsed, health.memory.totalBytes)}%`,
                 `${gb(memUsed)} of ${gb(health.memory.totalBytes)}`,
                 pct(memUsed, health.memory.totalBytes) > 90 ? color.rust : null],
                ['Disk', health.disk ? `${pct(diskUsed, health.disk.totalBytes)}%` : 'unknown',
                 health.disk ? `${gb(health.disk.freeBytes)} free` : 'not reported by this host',
                 health.disk && pct(diskUsed, health.disk.totalBytes) > 90 ? color.rust : null],
                ['Load', health.load.one.toFixed(2),
                 `${health.load.cores} core(s)`, loadPer > 1 ? color.amberInk : null],
                ['Tunnels', health.tunnels ?? '—', 'routers dialled in', null],
                ['Uptime', days ? `${days}d ${hours}h` : `${hours}h`, 'since last reboot', null],
              ];

              return tiles.map(([label, value, note, tone]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, letterSpacing: '.07em', color: color.muted }}>
                    {label.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 21, fontWeight: 600, margin: '3px 0 2px', color: tone ?? color.ink }}>
                    {value}
                  </div>
                  <div style={{ fontSize: 12, color: color.muted }}>{note}</div>
                </div>
              ));
            })()}
          </div>
        </Card>
      )}

      <Card title="Tenants">
        {!rows ? <Empty text="Loading…" /> : !rows.length ? <Empty text="No tenants yet" /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>ISP</th>
                  <th style={th}>BILLING ID</th>
                  <th style={{ ...th, textAlign: 'right' }}>CLIENTS</th>
                  <th style={{ ...th, textAlign: 'right' }}>ONLINE</th>
                  <th style={{ ...th, textAlign: 'right' }}>ROUTERS</th>
                  <th style={{ ...th, textAlign: 'right' }}>THIS MONTH</th>
                  <th style={th}>LAST PAYMENT</th>
                  <th style={th}>NEEDS ATTENTION</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((t) => (
                  <tr key={t.id}>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{t.name}</span>
                      <span style={{ display: 'block', fontSize: 12, color: color.muted, fontFamily: font.mono }}>
                        {t.subdomain}
                      </span>
                    </td>
                    <td style={{ ...td, fontFamily: font.mono, fontSize: 12 }}>{t.billing_ref ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {t.subscribers}
                      <span style={{ display: 'block', fontSize: 11.5, color: color.muted }}>
                        {t.active_subscribers} active
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: font.mono }}>{t.online}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {Number(t.routers_down)
                        ? <span style={{ color: color.rust }}>{t.routers_down}/{t.routers} down</span>
                        : <span style={{ color: color.muted }}>{t.routers} up</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: font.mono }}>
                      {kes(t.collected_this_month)}
                    </td>
                    <td style={{ ...td, fontSize: 12.5, color: color.muted }}>{ago(t.last_payment_at)}</td>
                    <td style={td}>
                      {!t._t.length ? (
                        <span style={{ fontSize: 12.5, color: color.muted }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {t._t.map((x) => (
                            <span
                              key={x.text}
                              style={{
                                fontSize: 12, padding: '3px 8px', borderRadius: 999,
                                color: LEVEL_COLOUR[x.level], background: color.tileBg,
                                border: `1px solid ${color.line}`,
                              }}
                            >
                              {x.text}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {at && (
          <div style={{ marginTop: 10, fontSize: 12, color: color.muted }}>
            Updated {at.toLocaleTimeString('en-KE')}, refreshing every minute.
          </div>
        )}
      </Card>
    </Screen>
  );
}
