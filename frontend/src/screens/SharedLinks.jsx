import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Textarea, Toggle } from '../ui/primitives';

/**
 * Shared links: the radio, switch or ONU that several customers get service through. A fault shared by most of a group is the device's, not
 * the customers', so each link is read as a whole. An unmanaged switch or radio cannot be queried: it is judged from the customers behind it.
 */
const KINDS = [
  { value: 'ap', label: 'Access point (serves customers)' },
  { value: 'station', label: 'Station (receives the signal)' },
  { value: 'radio', label: 'Radio / sector (older)' },
  { value: 'switch', label: 'Switch' },
  { value: 'onu', label: 'Fibre ONU' },
  { value: 'other', label: 'Other' },
];
const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label ?? k;
const LEVEL = {
  ok: { label: 'Healthy', tone: 'active' },
  watch: { label: 'Watch', tone: 'pending' },
  down: { label: 'Down', tone: 'down' },
  unknown: { label: 'No data', tone: 'default' },
};
const BLANK = { name: '', kind: 'ap', managed: true, location: '', notes: '', parent_id: '' };

export default function SharedLinks() {
  const store = useStore();
  const can = (k) => !!store.session?.perms?.[k];
  const [links, setLinks] = useState(null);
  const [open, setOpen] = useState(null);         // link id shown in the drawer
  const [detail, setDetail] = useState(null);
  const [edit, setEdit] = useState(null);         // form for a new or edited link
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.sharedLinks().then(setLinks).catch((e) => store.toast(`Could not load: ${e.message}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const loadDetail = useCallback((id) => api.sharedLink(id).then(setDetail).catch((e) => store.toast(`Could not load: ${e.message}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open) { setDetail(null); loadDetail(open); } }, [open, loadDetail]);

  const refresh = () => Promise.all([load(), open ? loadDetail(open) : null]);

  const saveLink = async () => {
    setBusy(true);
    try {
      const body = { name: edit.name, kind: edit.kind, managed: edit.managed, location: edit.location, notes: edit.notes, parentId: edit.parent_id || null };
      const out = edit.id ? await api.updateSharedLink(edit.id, body) : await api.createSharedLink(body);
      setEdit(null);
      await refresh();
      store.toast(edit.id ? 'Saved' : 'Link added. Now add the customers behind it.');
      if (!edit.id) setOpen(out.id);
    } catch (e) { store.toast(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };
  const removeLink = async () => {
    if (!window.confirm(`Delete "${detail.name}"? The customers stay; they are just no longer grouped.`)) return;
    try { await api.deleteSharedLink(detail.id); setOpen(null); load(); store.toast('Link deleted'); }
    catch (e) { store.toast(`Could not delete: ${e.message}`); }
  };
  const members = async (body, done) => {
    try { await api.setLinkMembers(detail.id, body); await refresh(); store.toast(done); }
    catch (e) { store.toast(`Could not change: ${e.message}`); }
  };

  const worst = (links ?? []).filter((l) => (l.level === 'down' || l.level === 'watch') && !l.upstream);

  return (
    <Screen
      title="Shared links"
      subtitle="The radio, switch or ONU that several customers share. A fault most of a group has is the device's, not the customers'."
      actions={can('links.manage') && <Button variant="primary" onClick={() => setEdit({ ...BLANK })}>+ Add link</Button>}
    >
      <Grid min={200} gap={14}>
        <Stat label="Links" value={links?.length ?? '…'} hint="shared devices" />
        <Stat label="Needing a look" value={worst.length} tone={worst.length ? color.rust : undefined} hint="the cause, not the ones it takes down" />
        <Stat label="Customers grouped" value={(links ?? []).reduce((a, l) => a + l.customers, 0)} hint="on a shared link" />
        <Stat label="Unmanaged" value={(links ?? []).filter((l) => !l.managed).length} hint="judged from customers only" />
      </Grid>

      <Card title="Links" subtitle="Worst first. Open one to see its customers and what to check.">
        <Table
          rowKey={(l) => l.id}
          empty={links ? 'No shared links yet. Add one for each radio, switch or ONU that serves a group of customers.' : 'Loading…'}
          onRowClick={(l) => setOpen(l.id)}
          rows={[...(links ?? [])].sort((a, b) => ['down', 'watch', 'ok', 'unknown'].indexOf(a.level) - ['down', 'watch', 'ok', 'unknown'].indexOf(b.level) || a.name.localeCompare(b.name))}
          columns={[
            { key: 'name', label: 'Link', render: (l) => <span><b>{l.name}</b>{l.location ? <span style={{ color: color.muted }}> · {l.location}</span> : null}</span> },
            { key: 'kind', label: 'Type', render: (l) => <span>{kindLabel(l.kind)}{l.managed ? '' : <span style={{ color: color.muted }}> · unmanaged</span>}</span> },
            { key: 'parent', label: 'Fed from', render: (l) => (l.parent_id ? (links.find((x) => x.id === l.parent_id)?.name ?? '—') : '—') },
            { key: 'level', label: 'State', render: (l) => <Badge tone={LEVEL[l.level].tone}>{LEVEL[l.level].label}</Badge> },
            { key: 'customers', label: 'Online', render: (l) => (l.active ? `${l.online} of ${l.active}` : '—') },
            { key: 'drops', label: 'Drops (24h)', render: (l) => l.drops },
            { key: 'headline', label: 'What it looks like', render: (l) => <span style={{ fontSize: 12.5, color: color.inkSoft }}>{l.headline}</span> },
          ]}
        />
      </Card>

      <Drawer
        open={!!open}
        title={detail?.name ?? 'Link'}
        subtitle={detail ? `${kindLabel(detail.kind)}${detail.managed ? '' : ' · unmanaged'}${detail.location ? ` · ${detail.location}` : ''}` : ''}
        onClose={() => setOpen(null)}
        actions={detail && can('links.manage') && (
          <>
            <Button size="sm" onClick={() => setEdit({ ...detail })}>Edit</Button>
            <Button size="sm" onClick={removeLink}>Delete</Button>
          </>
        )}
        width={760}
      >
        {!detail ? <div style={{ color: color.muted }}>Loading…</div> : (
          <div style={{ display: 'grid', gap: 14 }}>
            <Verdict v={detail.verdict} />
            {detail.parent_name && <div style={{ fontSize: 13, color: color.inkSoft }}>Fed from <b>{detail.parent_name}</b></div>}
            {detail.children?.length > 0 && (
              <div style={{ fontSize: 13 }}>
                <b>Feeds</b>{' '}
                {detail.children.map((c) => <span key={c.id} style={{ marginRight: 10 }}>{c.name} <Badge tone={LEVEL[c.level].tone}>{LEVEL[c.level].label}</Badge></span>)}
              </div>
            )}
            {detail.notes && <div style={{ fontSize: 13, color: color.inkSoft, whiteSpace: 'pre-wrap' }}>{detail.notes}</div>}
            <Card
              title={`Customers (${detail.members.length})`}
              actions={can('links.manage') && <Button size="sm" onClick={() => setAdding(true)}>+ Add customers</Button>}
              pad={0}
            >
              <Table
                rowKey={(m) => m.id}
                empty="No customers on this link yet"
                rows={detail.members}
                columns={[
                  { key: 'name', label: 'Customer', render: (m) => <span><b>{m.name}</b><span style={{ color: color.muted, fontFamily: font.mono, fontSize: 11.5 }}> {m.account_code}</span></span> },
                  { key: 'via', label: 'On', render: (m) => `${m.direct ? 'this device' : (m.via ?? '—')}${m.via_ap ? ' (by access point)' : ''}` },
                  { key: 'status', label: 'Account', render: (m) => <Badge>{m.status}</Badge> },
                  { key: 'online', label: 'Line', render: (m) => (!m.pppoe_user ? '—' : m.online ? <Badge tone={m.line_state === 'unreachable' ? 'pending' : 'active'}>{m.line_state === 'unreachable' ? 'no traffic' : 'online'}</Badge> : <Badge tone="down">offline</Badge>) },
                  { key: 'drops', label: 'Drops', render: (m) => m.drops || '—' },
                  { key: 'signal', label: 'Signal', render: (m) => (m.signal == null ? '—' : `${m.signal} dBm`) },
                  { key: 'x', label: '', align: 'right', render: (m) => can('links.manage') && (
                    <Button size="sm" onClick={() => members({ remove: [m.id] }, `${m.name} taken off the link`)}>Remove</Button>
                  ) },
                ]}
              />
            </Card>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!edit}
        title={edit?.id ? 'Edit link' : 'Add a shared link'}
        onClose={() => setEdit(null)}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={saveLink} disabled={busy || !edit?.name?.trim()}>{busy ? 'Saving…' : 'Save'}</Button></>}
      >
        {edit && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Name" hint="Say what it is and where, for example: Mlima mast sector 1, or Plaza switch."><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Type"><Select options={KINDS} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} /></Field>
            <Toggle
              checked={!edit.managed} onChange={(v) => setEdit({ ...edit, managed: !v })}
              label="Unmanaged (cannot be logged into)"
              detail="A plain switch or a radio nobody can see inside. Billing can't read it, so it is judged only from the customers behind it."
            />
            <Field label="Fed from" hint="The link upstream of this one: a switch is fed from the radio that receives the signal, and a radio from the switch.">
              <Select
                options={[{ value: '', label: 'Nothing (the first device)' }, ...(links ?? []).filter((x) => x.id !== edit.id).map((x) => ({ value: x.id, label: x.name }))]}
                value={edit.parent_id ?? ''} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })}
              />
            </Field>
            <Field label="Location"><Input value={edit.location ?? ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} placeholder="Site, pole or building" /></Field>
            <Field label="Notes"><Textarea rows={3} value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Model, power source, who to call" /></Field>
          </div>
        )}
      </Modal>

      {adding && detail && (
        <AddCustomers
          link={detail}
          clients={store.clients ?? []}
          links={links ?? []}
          onClose={() => setAdding(false)}
          onAdd={async (ids) => { await members({ add: ids }, `${ids.length} customer${ids.length === 1 ? '' : 's'} added`); setAdding(false); }}
        />
      )}
    </Screen>
  );
}

function Verdict({ v }) {
  const l = LEVEL[v.level];
  const tint = v.level === 'down' ? color.rustBg : v.level === 'watch' ? color.amberBg : color.tileBg;
  return (
    <div style={{ background: tint, borderRadius: 10, padding: 14, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Badge tone={l.tone}>{l.label}</Badge><b style={{ fontSize: 14 }}>{v.headline}</b></div>
      {v.detail.map((d) => <div key={d} style={{ fontSize: 13, color: color.inkSoft }}>{d}</div>)}
      {v.outliers.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <b>{v.level === 'ok' ? 'Individual customers to look at' : 'Also'}:</b>{' '}
          {v.outliers.map((o) => `${o.name} (${o.why})`).join('; ')}
        </div>
      )}
      {v.steps.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <b>Check on site</b>
          <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>{v.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
      )}
    </div>
  );
}

function AddCustomers({ link, clients, links, onClose, onAdd }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const here = useMemo(() => new Set(link.members.map((m) => m.id)), [link]);
  const elsewhere = useMemo(() => {
    const m = new Map();
    for (const l of links) for (const id of l.memberIds ?? []) if (l.id !== link.id) m.set(id, l.name);
    return m;
  }, [links, link]);
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    return clients.filter((c) => !here.has(c.id) && (!t || [c.name, c.account_code, c.phone, c.pppoe_user].some((x) => String(x ?? '').toLowerCase().includes(t)))).slice(0, 40);
  }, [clients, q, here]);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal
      open
      title={`Add customers to ${link.name}`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!picked.size || busy} onClick={async () => { setBusy(true); try { await onAdd([...picked]); } finally { setBusy(false); } }}>{busy ? 'Adding…' : `Add ${picked.size || ''}`}</Button></>}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, account number, phone or PPPoE user" autoFocus />
        <div style={{ maxHeight: 340, overflow: 'auto', display: 'grid' }}>
          {found.map((c) => (
            <label key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 2px', borderTop: `1px solid ${color.line}`, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              <span style={{ flex: 1 }}><b>{c.name}</b> <span style={{ color: color.muted, fontFamily: font.mono, fontSize: 11.5 }}>{c.account_code}</span></span>
              {elsewhere.has(c.id) && <span style={{ color: color.amberInk, fontSize: 12 }}>on {elsewhere.get(c.id)}: will move</span>}
            </label>
          ))}
          {!found.length && <div style={{ color: color.muted, fontSize: 13 }}>No customers match.</div>}
        </div>
        <div style={{ fontSize: 12, color: color.muted }}>A customer is on one link at a time. Adding one that is already on another link moves them here.</div>
      </div>
    </Modal>
  );
}
