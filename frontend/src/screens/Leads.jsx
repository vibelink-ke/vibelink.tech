import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const STAGES = ['new', 'contacted', 'won', 'lost'];
const SOURCES = ['manual', 'walk-in', 'referral', 'facebook', 'field visit', 'call'];

const stageTone = (s) =>
  s === 'won'
    ? { bg: '#e2ebe5', fg: color.green }
    : s === 'lost'
    ? { bg: color.rustBg, fg: color.rust }
    : s === 'contacted'
    ? { bg: color.amberBg, fg: color.amberInk }
    : { bg: color.tileBg, fg: color.neutralInk };

export default function Leads() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', source: 'manual' });
  const [busy, setBusy] = useState(false);

  const leads = store.leads ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const won = leads.filter((l) => l.status === 'won').length;
  const active = leads.filter((l) => l.status !== 'won' && l.status !== 'lost').length;
  const rate = leads.length ? Math.round((won / leads.length) * 100) : 0;

  const create = async () => {
    if (!f.name.trim() || !f.phone.trim()) return store.toast('Name and phone are required');
    setBusy(true);
    try {
      const created = await api.createLead(f);
      store.setCollection('leads', (ls) => [created, ...ls]);
      store.toast(`${created.name} added`);
      setOpen(false);
      setF({ name: '', phone: '', source: 'manual' });
    } catch (e) {
      store.toast(`Could not add the lead: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const changeStage = (l) => async (e) => {
    const status = e.target.value;
    const previous = l.status;
    store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? { ...x, status } : x)));
    try {
      const updated = await api.updateLead(l.id, { status });
      store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? updated : x)));
      store.toast(`${l.name} → ${status}`);
    } catch (err) {
      store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? { ...x, status: previous } : x)));
      store.toast(`Could not update: ${err.message}`);
    }
  };

  return (
    <Screen
      title="Leads"
      subtitle="Prospective subscribers, from first contact through to an installed line."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Add lead
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Active" value={active} hint="still in play" />
        <Stat label="Won" value={won} tone={won ? color.green : undefined} hint="converted to clients" />
        <Stat label="Lost" value={leads.filter((l) => l.status === 'lost').length} hint="closed out" />
        <Stat label="Conversion" value={`${rate}%`} hint="won / total" />
      </Grid>

      <Card title="Pipeline">
        <Table
          rowKey={(l) => l.id}
          empty="No leads yet"
          rows={leads}
          columns={[
            { key: 'name', label: 'Name', render: (l) => <span style={{ fontWeight: 600 }}>{l.name}</span> },
            { key: 'phone', label: 'Phone', render: (l) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{l.phone}</span> },
            { key: 'source', label: 'Source', render: (l) => l.source ?? '—' },
            {
              key: 'status',
              label: 'Stage',
              width: 140,
              render: (l) => (
                <select
                  value={l.status}
                  onChange={changeStage(l)}
                  style={{ padding: '4px 8px', border: `1px solid ${color.line}`, borderRadius: radius.sm, background: '#fff', fontSize: 12.5 }}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ),
            },
            { key: 'badge', label: '', render: (l) => <Badge tone={stageTone(l.status)}>{l.status}</Badge> },
            {
              key: 'created_at',
              label: 'Added',
              render: (l) => (l.created_at ? new Date(l.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }) : '—'),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="Add lead"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? 'Saving…' : 'Add lead'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Name">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set('phone')} placeholder="07xx xxx xxx" />
          </Field>
          <Field label="Source">
            <Select value={f.source} onChange={set('source')} options={SOURCES} />
          </Field>
        </div>
      </Modal>
    </Screen>
  );
}
