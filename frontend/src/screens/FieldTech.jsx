import React, { useMemo, useState } from 'react';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Screen } from '../ui/primitives';

const PRIORITY_COLOUR = { critical: color.rust, high: color.amberInk, medium: color.muted, low: color.muted };

/**
 * A mobile-first work queue for whoever's actually driving to a site — the
 * "field tech dispatch, route optimization, GPS tracking" every platform
 * reviewed for this offers as its own product surface. Route optimization
 * and live GPS tracking are a genuinely separate build (a location-sharing
 * background service, a routing engine) with nothing here to hang them on
 * yet; this is the achievable slice — the tickets already assigned to you,
 * with what a technician standing at their van actually needs: the
 * address, one tap to call, one tap to navigate, one tap to update status
 * — built on the same PWA install (manifest.json/sw.js) already in place,
 * so "the field tech app" is this same site added to a home screen rather
 * than a second codebase to maintain.
 */
export default function FieldTech() {
  const store = useStore();
  const [busyId, setBusyId] = useState(null);

  const clientById = useMemo(
    () => Object.fromEntries((store.clients ?? []).map((c) => [c.id, c])),
    [store.clients]
  );
  const routerById = useMemo(
    () => Object.fromEntries((store.routers ?? []).map((r) => [r.id, r])),
    [store.routers]
  );

  const mine = useMemo(() => {
    const myId = store.session?.id;
    return (store.tickets ?? [])
      .filter((t) => t.assigned_to === myId && t.status !== 'resolved')
      .map((t) => ({ ...t, client: clientById[t.subscriber_id] }))
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
      });
  }, [store.tickets, store.session, clientById]);

  const setStatus = async (t, status) => {
    setBusyId(t.id);
    try {
      const updated = await api.updateTicket(t.id, { status });
      store.setCollection('tickets', (ts) => ts.map((x) => (x.id === t.id ? updated : x)));
      store.toast(status === 'resolved' ? `${t.subject} marked resolved` : `${t.subject} started`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen title="My jobs" subtitle={`${mine.length} assigned to you, open`}>
      {mine.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: color.muted, fontSize: 13 }}>
          Nothing assigned to you right now.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {mine.map((t) => {
            const c = t.client;
            const router = routerById[c?.router_id];
            const lat = c?.lat ?? router?.lat;
            const lng = c?.lng ?? router?.lng;
            return (
              <div
                key={t.id}
                style={{
                  background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg,
                  padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{t.subject}</span>
                    <span style={{ fontSize: 12.5, color: color.muted }}>
                      {c?.name ?? 'No linked customer'} {c?.account_code ? `· ${c.account_code}` : ''}
                    </span>
                  </div>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto' }}>
                    <span style={{ width: 8, height: 8, borderRadius: radius.pill, background: PRIORITY_COLOUR[t.priority] ?? color.muted }} />
                    <Badge tone={t.status}>{t.status}</Badge>
                  </span>
                </div>

                {c?.location && <span style={{ fontSize: 13, color: color.ink }}>{c.location}</span>}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {c?.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      style={{ ...btnStyle, background: color.tileBg, color: color.ink }}
                    >
                      Call {c.phone}
                    </a>
                  )}
                  {lat != null && lng != null && (
                    <a
                      href={`https://www.google.com/maps?q=${lat},${lng}`}
                      target="_blank" rel="noreferrer"
                      style={{ ...btnStyle, background: color.tileBg, color: color.ink }}
                    >
                      Navigate
                    </a>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {t.status !== 'in_progress' && (
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => setStatus(t, 'in_progress')}
                      style={{ ...btnStyle, flex: 1, background: color.amber, color: '#3a2c05', border: 'none', fontWeight: 700 }}
                    >
                      Start
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => setStatus(t, 'resolved')}
                    style={{ ...btnStyle, flex: 1, background: color.green, color: '#fff', border: 'none', fontWeight: 700 }}
                  >
                    {busyId === t.id ? 'Saving…' : 'Mark resolved'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

const btnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '10px 14px', borderRadius: radius.md, fontSize: 13.5, fontWeight: 600,
  textDecoration: 'none', border: `1px solid ${color.line}`, cursor: 'pointer',
};
