import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Bar, Button, Card, Drawer, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table, Tabs, Textarea } from '../ui/primitives';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'resolved'];

const prioTone = (p) =>
  p === 'high' || p === 'critical'
    ? { bg: color.rustBg, fg: color.rust }
    : p === 'medium'
    ? { bg: color.amberBg, fg: color.amberInk }
    : { bg: color.tileBg, fg: color.neutralInk };

const barTone = (s) => (s === 'resolved' ? color.mint : s === 'in_progress' ? color.amber : color.green);
const pctFor = (s) => (s === 'resolved' ? 100 : s === 'in_progress' ? 55 : 10);
const when = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

const overdue = (t) => t.due_at && t.status !== 'resolved' && new Date(t.due_at) < new Date();

export default function Tickets() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: '', subscriberId: '', priority: 'medium', description: '' });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('open');

  const [detail, setDetail] = useState(null);   // full ticket + notes
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');

  const tickets = store.tickets ?? [];
  const staff = store.staff ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const stats = {
    open: tickets.filter((t) => t.status !== 'resolved').length,
    unassigned: tickets.filter((t) => !t.assigned_to && t.status !== 'resolved').length,
    breaching: tickets.filter((t) => (t.priority === 'high' || t.priority === 'critical') && t.status !== 'resolved').length,
    overdue: tickets.filter(overdue).length,
  };

  const visible = tickets.filter((t) =>
    filter === 'all' ? true : filter === 'open' ? t.status !== 'resolved' : filter === 'overdue' ? overdue(t) : t.status === filter
  );

  const create = async () => {
    if (!f.subject.trim()) return store.toast('Give the ticket a subject');
    setBusy(true);
    try {
      const created = await api.createTicket({ subject: f.subject, subscriberId: f.subscriberId || null, priority: f.priority });
      if (f.description.trim()) await api.updateTicket(created.id, { description: f.description });
      store.setCollection('tickets', (ts) => [{ ...created, description: f.description || null }, ...ts]);
      store.toast(`${created.number} raised`);
      setOpen(false);
      setF({ subject: '', subscriberId: '', priority: 'medium', description: '' });
    } catch (e) {
      store.toast(`Could not raise the ticket: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  /** Optimistic field change straight from the table. */
  const quickPatch = (t, patch, label) => async () => {
    const before = { ...t };
    store.setCollection('tickets', (ts) => ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    try {
      const updated = await api.updateTicket(t.id, patch);
      store.setCollection('tickets', (ts) => ts.map((x) => (x.id === t.id ? updated : x)));
      if (label) store.toast(label);
    } catch (e) {
      store.setCollection('tickets', (ts) => ts.map((x) => (x.id === t.id ? before : x)));
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const openDetail = async (t) => {
    setDetail({ ...t, notes: [], loading: true });
    try {
      setDetail(await api.ticket(t.id));
    } catch (e) {
      store.toast(`Could not load: ${e.message}`);
      setDetail(null);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      const n = await api.addTicketNote(detail.id, note);
      setDetail((d) => ({ ...d, notes: [...(d.notes ?? []), n] }));
      setNote('');
      store.toast('Note added');
    } catch (e) {
      store.toast(`Could not add the note: ${e.message}`);
    }
  };

  const saveEdit = async () => {
    try {
      const updated = await api.updateTicket(editing.id, {
        subject: editing.subject,
        priority: editing.priority,
        status: editing.status,
        assigned_to: editing.assigned_to || null,
        description: editing.description || null,
        due_at: editing.due_at || null,
      });
      store.setCollection('tickets', (ts) => ts.map((x) => (x.id === updated.id ? updated : x)));
      if (detail?.id === updated.id) setDetail((d) => ({ ...d, ...updated }));
      store.toast(`${updated.number} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  const remove = async (t) => {
    try {
      await api.deleteTicket(t.id);
      store.setCollection('tickets', (ts) => ts.filter((x) => x.id !== t.id));
      store.toast(`${t.number} deleted`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const staffName = (id) => staff.find((s) => s.id === id)?.name;

  return (
    <Screen
      title="Tickets"
      subtitle="Faults raised by clients or opened automatically by the outage and install-follow-up rules."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Raise ticket
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Open" value={stats.open} hint="not yet resolved" />
        <Stat label="Unassigned" value={stats.unassigned} tone={stats.unassigned ? color.amberInk : undefined} hint="need an owner" />
        <Stat label="High priority" value={stats.breaching} tone={stats.breaching ? color.rust : undefined} hint="at risk of breaching SLA" />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? color.rust : undefined} hint="past their due date" />
      </Grid>

      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'open', label: `Open (${stats.open})` },
          { id: 'in_progress', label: 'In progress' },
          { id: 'overdue', label: `Overdue (${stats.overdue})` },
          { id: 'resolved', label: 'Resolved' },
          { id: 'all', label: 'All' },
        ]}
      />

      <Card title="Tickets" subtitle={`${visible.length} shown`}>
        <Table
          rowKey={(t) => t.id}
          empty={tickets.length ? 'Nothing in this view' : 'No tickets — nothing is broken right now'}
          rows={visible}
          columns={[
            { key: 'number', label: 'Ref', render: (t) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{t.number}</span> },
            {
              key: 'subject',
              label: 'Subject',
              render: (t) => (
                <span onClick={() => openDetail(t)} style={{ fontWeight: 600, color: color.green, cursor: 'pointer' }}>
                  {t.subject}
                </span>
              ),
            },
            { key: 'priority', label: 'Priority', render: (t) => <Badge tone={prioTone(t.priority)}>{t.priority}</Badge> },
            {
              key: 'assigned_to',
              label: 'Assignee',
              width: 150,
              render: (t) => (
                <select
                  value={t.assigned_to ?? ''}
                  onChange={(e) => quickPatch(t, { assigned_to: e.target.value || null }, 'Assignee updated')()}
                  style={{ padding: '4px 8px', border: `1px solid ${color.line}`, borderRadius: radius.sm, background: '#fff', fontSize: 12.5, maxWidth: 140 }}
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              width: 140,
              render: (t) => (
                <select
                  value={t.status}
                  onChange={(e) => quickPatch(t, { status: e.target.value }, `${t.number} → ${e.target.value.replace('_', ' ')}`)()}
                  style={{ padding: '4px 8px', border: `1px solid ${color.line}`, borderRadius: radius.sm, background: '#fff', fontSize: 12.5 }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              ),
            },
            {
              key: 'due_at',
              label: 'Due',
              render: (t) =>
                t.due_at ? (
                  <span style={{ color: overdue(t) ? color.rust : color.ink, fontWeight: overdue(t) ? 600 : 400 }}>
                    {when(t.due_at)}
                  </span>
                ) : (
                  <span style={{ color: color.muted }}>—</span>
                ),
            },
            { key: 'progress', label: 'Progress', width: 110, render: (t) => <Bar pct={pctFor(t.status)} tone={barTone(t.status)} /> },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (t) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span onClick={() => openDetail(t)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>View</span>
                  <span onClick={() => setEditing({ ...t, due_at: t.due_at ? String(t.due_at).slice(0, 10) : '' })} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                  <span onClick={() => remove(t)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                </span>
              ),
            },
          ]}
        />
      </Card>

      {/* ── detail ── */}
      <Drawer open={!!detail} title={detail?.number} onClose={() => setDetail(null)} width={460}>
        {detail && (
          <>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{detail.subject}</span>
            {detail.description && (
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: color.neutralInk, whiteSpace: 'pre-wrap' }}>
                {detail.description}
              </p>
            )}
            <KV k="Status" v={detail.status?.replace('_', ' ')} />
            <KV k="Priority" v={detail.priority} />
            <KV k="Assignee" v={detail.assignee_name ?? staffName(detail.assigned_to) ?? 'Unassigned'} />
            <KV k="Client" v={detail.subscriber_name ?? 'Not client-specific'} />
            {detail.subscriber_phone && <KV k="Phone" v={detail.subscriber_phone} />}
            <KV k="Raised" v={when(detail.created_at)} />
            <KV k="Last touched" v={when(detail.updated_at)} />
            <KV k="Due" v={detail.due_at ? when(detail.due_at) : 'No due date'} />
            <KV k="SLA policy" v={detail.sla_policy_name ?? `No policy configured for "${detail.priority}"`} />

            <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted }}>
                NOTES ({detail.notes?.length ?? 0})
              </span>
              {(detail.notes ?? []).length === 0 ? (
                <span style={{ fontSize: 12.5, color: color.muted }}>Nothing recorded yet.</span>
              ) : (
                detail.notes.map((n) => (
                  <div key={n.id} style={{ background: color.tileBg, borderRadius: 8, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: color.muted }}>
                      <span>{n.author ?? 'system'}</span>
                      <span>{when(n.at)}</span>
                    </div>
                    <span style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{n.body}</span>
                  </div>
                ))
              )}
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add an internal note…" />
              <Button variant="primary" onClick={addNote} style={{ alignSelf: 'flex-start' }}>
                Add note
              </Button>
            </div>
          </>
        )}
      </Drawer>

      {/* ── edit ── */}
      <Modal
        open={!!editing}
        title={`Edit ${editing?.number ?? ''}`}
        width={560}
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
            <Field label="Subject" span={2}>
              <Input value={editing.subject ?? ''} onChange={(e) => setEditing((s) => ({ ...s, subject: e.target.value }))} />
            </Field>
            <Field label="Priority">
              <Select value={editing.priority} onChange={(e) => setEditing((s) => ({ ...s, priority: e.target.value }))} options={PRIORITIES} />
            </Field>
            <Field label="Status">
              <Select value={editing.status} onChange={(e) => setEditing((s) => ({ ...s, status: e.target.value }))} options={STATUSES} />
            </Field>
            <Field label="Assignee">
              <Select
                value={editing.assigned_to ?? ''}
                onChange={(e) => setEditing((s) => ({ ...s, assigned_to: e.target.value }))}
                options={[{ value: '', label: staff.length ? 'Unassigned' : 'No staff yet' }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
            <Field label="Due date">
              <Input type="date" value={editing.due_at ?? ''} onChange={(e) => setEditing((s) => ({ ...s, due_at: e.target.value }))} />
            </Field>
            <Field label="Description" span={2}>
              <Textarea value={editing.description ?? ''} onChange={(e) => setEditing((s) => ({ ...s, description: e.target.value }))} rows={4} />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── raise ── */}
      <Modal
        open={open}
        title="Raise ticket"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? 'Raising…' : 'Raise ticket'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Subject">
            <Input value={f.subject} onChange={set('subject')} placeholder="No link at Kimumu tower" />
          </Field>
          <Field label="Client">
            <Select
              value={f.subscriberId}
              onChange={set('subscriberId')}
              options={[
                { value: '', label: 'Not client-specific' },
                ...(store.clients ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.account_code}` })),
              ]}
            />
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={set('priority')} options={PRIORITIES} />
          </Field>
          <Field label="Description">
            <Textarea value={f.description} onChange={set('description')} rows={4} placeholder="What did the client report?" />
          </Field>
        </div>
      </Modal>
    </Screen>
  );
}
