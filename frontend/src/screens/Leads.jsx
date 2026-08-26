import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const STAGES = ['new', 'contacted', 'won', 'lost'];
const CHANNELS = ['manual', 'walk-in', 'referral', 'facebook', 'field visit', 'call'];

const stageTone = (s) =>
  s === 'won'
    ? { bg: '#e2ebe5', fg: color.green }
    : s === 'lost'
    ? { bg: color.rustBg, fg: color.rust }
    : s === 'contacted'
    ? { bg: color.amberBg, fg: color.amberInk }
    : { bg: color.tileBg, fg: color.neutralInk };

const BLANK = { name: '', phone: '', source: 'manual', referrerId: '' };

export default function Leads() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const leads = store.leads ?? [];
  const referrers = store.referrers ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const won = leads.filter((l) => l.status === 'won').length;
  const active = leads.filter((l) => l.status !== 'won' && l.status !== 'lost').length;
  const rate = leads.length ? Math.round((won / leads.length) * 100) : 0;

  const openAdd = () => {
    setEdit(null);
    setF(BLANK);
    setOpen(true);
  };
  const openEdit = (l) => {
    setEdit(l);
    setF({ name: l.name, phone: l.phone, source: l.source ?? 'manual', referrerId: l.referrer_id ?? '' });
    setOpen(true);
  };

  const save = async () => {
    if (!f.name.trim() || !f.phone.trim()) return store.toast('Name and phone are required');
    setBusy(true);
    try {
      if (edit) {
        const updated = await api.updateLead(edit.id, {
          name: f.name.trim(), phone: f.phone.trim(), source: f.source, referrer_id: f.referrerId || null,
        });
        store.setCollection('leads', (ls) => ls.map((x) => (x.id === edit.id ? { ...x, ...updated } : x)));
        store.toast(`${updated.name} updated`);
      } else {
        const created = await api.createLead({
          name: f.name.trim(), phone: f.phone.trim(), source: f.source, referrerId: f.referrerId || null,
        });
        store.setCollection('leads', (ls) => [created, ...ls]);
        store.toast(`${created.name} added`);
      }
      setOpen(false);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
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

  const confirmDelete = async () => {
    try {
      await api.deleteLead(deleting.id);
      store.setCollection('leads', (ls) => ls.filter((x) => x.id !== deleting.id));
      store.toast(`${deleting.name} removed`);
      setDeleting(null);
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  return (
    <Screen
      title="Leads"
      subtitle="Prospective subscribers, from first contact through to an installed line."
      actions={
        <Button variant="primary" onClick={openAdd}>
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
            {
              key: 'source',
              label: 'Channel',
              render: (l) => (
                <div>
                  <div>{l.source ?? '—'}</div>
                  {l.referrer_name && <div style={{ fontSize: 11.5, color: color.muted }}>via {l.referrer_name}</div>}
                </div>
              ),
            },
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
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (l) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button onClick={() => setViewing(l)}>View</Button>
                  <Button onClick={() => openEdit(l)}>Edit</Button>
                  <Button onClick={() => setDeleting(l)}>Delete</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Add / edit */}
      <Modal
        open={open}
        title={edit ? `Edit ${edit.name}` : 'Add lead'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : edit ? 'Save changes' : 'Add lead'}
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
          <Field label="Channel" hint="How this lead reached you">
            <Select value={f.source} onChange={set('source')} options={CHANNELS} />
          </Field>
          {/* Meaningful mainly when the channel above is "referral", but not
              locked to it — a walk-in can still mention who sent them. */}
          <Field label="Referred by" hint="Optional — who to credit and pay commission to">
            <Select
              value={f.referrerId}
              onChange={set('referrerId')}
              options={[
                { value: '', label: '— none —' },
                ...referrers.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </Field>
        </div>
      </Modal>

      {/* View */}
      <Drawer open={!!viewing} title={viewing?.name} onClose={() => setViewing(null)}>
        {viewing && (
          <div>
            <KV k="Phone" v={viewing.phone} />
            <KV k="Channel" v={viewing.source ?? '—'} />
            <KV k="Referred by" v={viewing.referrer_name ?? '—'} />
            <KV k="Stage" v={<Badge tone={stageTone(viewing.status)}>{viewing.status}</Badge>} />
            <KV
              k="Added"
              v={viewing.created_at ? new Date(viewing.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
            />
          </div>
        )}
      </Drawer>

      {/* Delete confirmation */}
      <Modal
        open={!!deleting}
        title={`Remove ${deleting?.name ?? ''}?`}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>Remove lead</Button>
          </>
        }
      >
        <p style={{ fontSize: 13.5, color: color.muted, margin: 0 }}>
          This removes the lead from the pipeline. It has no effect on any client account already created from it.
        </p>
      </Modal>
    </Screen>
  );
}
