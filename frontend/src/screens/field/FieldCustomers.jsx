import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { color } from '../../theme/tokens';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { Btn, Chip, Dot, getAccuratePosition, mapsLink, page, panel, timeAgo } from './fieldKit';
import { useField } from './fieldContext';

/** Look a customer up: who they are, whether they are online, what speed they are on. Never money. */
export function FieldCustomers() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (q.trim().length < 2) { setRows(null); setError(''); return undefined; }
    let stop = false;
    const t = setTimeout(() => {
      api.fieldCustomers(q.trim()).then((r) => { if (!stop) { setRows(r); setError(''); } }).catch((e) => { if (!stop) setError(e.message); });
    }, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [q]);

  return (
    <div style={page}>
      <h2 style={{ margin: 0, fontSize: 20 }}>Customers</h2>
      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or account number" autoFocus
        style={{ width: '100%', boxSizing: 'border-box', height: 48, borderRadius: 12, border: `1px solid ${color.line}`, padding: '0 14px', fontSize: 16 }}
      />
      {error && <div style={{ ...panel, color: color.rust }}>{error}</div>}
      {rows && !rows.length && <div style={{ ...panel, color: color.muted }}>Nobody matches “{q}”.</div>}
      {(rows ?? []).map((c) => (
        <div key={c.id} style={{ ...panel, cursor: 'pointer', gap: 4 }} onClick={() => navigate(`/field/customers/${c.id}`)}>
          <div style={{ fontWeight: 600 }}><Dot on={c.online} />{c.name}{c.line_label ? ` — ${c.line_label}` : ''}</div>
          <div style={{ fontSize: 13, color: '#4a524c' }}>{c.account_code} · {c.phone}</div>
          <div style={{ fontSize: 12.5, color: color.muted }}>{c.state}{c.plan_title ? ` · ${c.plan_title}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

export function FieldCustomer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useStore();
  const { me } = useField();
  const [c, setC] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.fieldCustomer(id).then(setC).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateLocation = async () => {
    setBusy(true);
    try {
      store.toast('Getting the location…');
      const here = await getAccuratePosition({ targetM: 30, maxWaitMs: 20000 });
      if (!window.confirm(`Save this spot as ${c.name}'s location? (accuracy about ${Math.round(here.accuracy)} m)`)) return;
      await api.fieldSetLocation(id, here);
      store.toast('Location saved');
      await load();
    } catch (e) { store.toast(e.message); }
    finally { setBusy(false); }
  };

  const reconnect = async () => {
    if (!window.confirm(`Drop ${c.name}'s connection so their router dials in again? They will be offline for a few seconds.`)) return;
    setBusy(true);
    try { await api.fieldReconnect(id); store.toast('Connection reset — give it a few seconds'); }
    catch (e) { store.toast(e.message); }
    finally { setBusy(false); }
  };

  if (error) return <div style={page}><div style={{ ...panel, color: color.rust }}>{error}</div><Btn tone="quiet" onClick={() => navigate(-1)}>Back</Btn></div>;
  if (!c) return <div style={page}><div style={{ color: color.muted }}>Loading…</div></div>;
  const nav = mapsLink(c.lat != null ? Number(c.lat) : null, c.lng != null ? Number(c.lng) : null, c.location);

  return (
    <div style={page}>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: color.green, fontWeight: 600, fontSize: 14, textAlign: 'left', padding: 0, cursor: 'pointer' }}>← Back</button>
      <div style={panel}>
        <div style={{ fontWeight: 700, fontSize: 18 }}><Dot on={c.online} />{c.name}</div>
        <div style={{ fontSize: 13.5, color: '#4a524c' }}>Account {c.account_code}{c.line_label ? ` · ${c.line_label}` : ''}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip tone={c.online ? 'green' : 'neutral'}>{c.online ? 'Online now' : 'Not online'}</Chip>
          <Chip tone={c.status === 'active' || c.status === 'grace' ? 'green' : 'amber'}>{c.state}</Chip>
        </div>
        <div style={{ fontSize: 14 }}>
          {c.plan_title ? <div>Package: <b>{c.plan_title}</b>{c.rate_down ? ` (${Math.round(c.rate_down / 1000)}/${Math.round(c.rate_up / 1000)} Mbps)` : ''}</div> : null}
          {c.router_name ? <div>Tower: {c.router_name}</div> : null}
          {c.last_ip ? <div>Address: <span style={{ fontFamily: 'monospace' }}>{c.last_ip}</span></div> : null}
          {c.last_seen ? <div>Last seen: {timeAgo(c.last_seen)}</div> : null}
          {c.location ? <div>Location: {c.location}</div> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {c.phone && <Btn href={`tel:${c.phone}`} tone="quiet" style={{ flex: 1 }}>Call</Btn>}
          {nav && <Btn href={nav} tone="quiet" style={{ flex: 1 }}>Navigate</Btn>}
        </div>
        {me?.can?.location && (
          <Btn tone="quiet" busy={busy} onClick={updateLocation}>{c.lat != null ? 'Update location to where I am' : 'Set location to where I am'}</Btn>
        )}
        {me?.can?.ticket && (
          <Btn tone="quiet" onClick={() => navigate(`/field/new?customer=${c.id}&name=${encodeURIComponent(c.name)}`)}>Raise a ticket</Btn>
        )}
        {c.pppoe_user && c.service === 'pppoe' && (
          <Btn tone="quiet" busy={busy} onClick={reconnect}>Reset their connection</Btn>
        )}
      </div>
      {c.jobs?.length > 0 && (
        <div style={panel}>
          <div style={{ fontWeight: 600 }}>Recent jobs</div>
          {c.jobs.map((j) => (
            <div key={j.id} style={{ fontSize: 13.5, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{j.subject}</span>
              <span style={{ color: color.muted, whiteSpace: 'nowrap' }}>{j.status === 'resolved' ? 'Closed' : 'Open'} · {timeAgo(j.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
