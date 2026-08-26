import React, { useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table, Textarea } from '../ui/primitives';

const kes = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE')}`;

const commissionText = (r) =>
  r.commission_type === 'fixed' ? kes(r.commission_rate) : `${Number(r.commission_rate)}%`;

const BLANK = { name: '', phone: '', staffId: '', commissionType: 'percent', commissionRate: '', notes: '' };

/**
 * Who brought in each client, and what they're owed for it.
 *
 * A referrer is either one of the team (staffId links back to their staff
 * row) or someone entirely outside it — a shop owner, a happy customer —
 * who only ever exists in this table. Either way the commission itself is
 * one-time: it's credited automatically, server-side, the moment a referred
 * client's very first payment is applied (see settleSubscriber/
 * creditReferral in payments/apply.js) — nothing here computes or edits
 * that figure directly, only marks it paid once it's actually handed over.
 */
export default function Referrals() {
  const store = useStore();
  const referrers = store.referrers ?? [];
  const staff = store.staff ?? [];

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [commissions, setCommissions] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const totalOwed = referrers.reduce((sum, r) => sum + Number(r.owed ?? 0), 0);
  const totalPaid = referrers.reduce((sum, r) => sum + Number(r.paid ?? 0), 0);
  const totalClients = referrers.reduce((sum, r) => sum + Number(r.clients_referred ?? 0), 0);

  const openAdd = () => {
    setEdit(null);
    setF(BLANK);
    setOpen(true);
  };
  const openEdit = (r) => {
    setEdit(r);
    setF({
      name: r.name, phone: r.phone ?? '', staffId: r.staff_id ?? '',
      commissionType: r.commission_type, commissionRate: String(r.commission_rate), notes: r.notes ?? '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!f.name.trim()) return store.toast('Name is required');
    const rate = Number(f.commissionRate);
    if (!Number.isFinite(rate) || rate < 0) return store.toast('Enter a valid commission rate');
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), phone: f.phone.trim() || null,
        commissionType: f.commissionType, commissionRate: rate, notes: f.notes.trim() || null,
      };
      if (edit) {
        const updated = await api.updateReferrer(edit.id, body);
        store.setCollection('referrers', (rs) => rs.map((x) => (x.id === edit.id ? { ...x, ...updated } : x)));
        store.toast(`${updated.name} updated`);
      } else {
        const created = await api.createReferrer({ ...body, staffId: f.staffId || null });
        store.setCollection('referrers', (rs) => [created, ...rs]);
        store.toast(`${created.name} added as a referrer`);
      }
      setOpen(false);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const view = async (r) => {
    setViewing(r);
    setCommissions(null);
    try {
      setCommissions(await api.referrerCommissions(r.id));
    } catch (e) {
      store.toast(`Could not load commission history: ${e.message}`);
      setCommissions([]);
    }
  };

  const markPaid = async (c) => {
    try {
      const updated = await api.markCommissionPaid(c.id);
      setCommissions((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...updated } : x)));
      store.setCollection('referrers', (rs) => rs.map((x) => (x.id === viewing.id
        ? { ...x, owed: Number(x.owed) - Number(c.amount), paid: Number(x.paid) + Number(c.amount) }
        : x)));
      store.toast(`Marked ${kes(c.amount)} paid to ${viewing.name}`);
    } catch (e) {
      store.toast(`Could not mark as paid: ${e.message}`);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteReferrer(deleting.id);
      store.setCollection('referrers', (rs) => rs.filter((x) => x.id !== deleting.id));
      store.toast(`${deleting.name} removed`);
      setDeleting(null);
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  return (
    <Screen
      title="Referrals"
      subtitle="Whoever brings in a client — staff or not — and what they're owed for it. Commission is credited automatically on that client's first payment."
      actions={
        <Button variant="primary" onClick={openAdd}>
          + Add referrer
        </Button>
      }
    >
      <Grid min={190} gap={14}>
        <Stat label="Referrers" value={referrers.length} />
        <Stat label="Clients referred" value={totalClients} />
        <Stat label="Owed" value={kes(totalOwed)} tone={totalOwed ? color.amberInk : undefined} hint="not yet paid out" />
        <Stat label="Paid out" value={kes(totalPaid)} tone={color.green} />
      </Grid>

      <Card title="Referrers">
        <Table
          rowKey={(r) => r.id}
          empty="No referrers yet — add whoever sends you clients"
          rows={referrers}
          columns={[
            {
              key: 'name',
              label: 'Name',
              render: (r) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  {r.phone && <div style={{ fontSize: 12, color: color.muted, fontFamily: font.mono }}>{r.phone}</div>}
                </div>
              ),
            },
            {
              key: 'type',
              label: 'Type',
              render: (r) => (
                <Badge tone={r.staff_id ? { bg: color.tileBg, fg: color.neutralInk } : { bg: '#e2ebe5', fg: color.green }}>
                  {r.staff_id ? 'staff' : 'external'}
                </Badge>
              ),
            },
            { key: 'commission', label: 'Commission', render: (r) => commissionText(r) },
            { key: 'clients_referred', label: 'Clients', align: 'right', render: (r) => r.clients_referred ?? 0 },
            {
              key: 'owed',
              label: 'Owed',
              align: 'right',
              render: (r) => <span style={{ color: Number(r.owed) ? color.amberInk : color.muted, fontWeight: Number(r.owed) ? 600 : 400 }}>{kes(r.owed)}</span>,
            },
            { key: 'paid', label: 'Paid', align: 'right', render: (r) => kes(r.paid) },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (r) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button onClick={() => view(r)}>View</Button>
                  <Button onClick={() => openEdit(r)}>Edit</Button>
                  <Button onClick={() => setDeleting(r)}>Delete</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Add / edit */}
      <Modal
        open={open}
        title={edit ? `Edit ${edit.name}` : 'Add referrer'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : edit ? 'Save changes' : 'Add referrer'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Name">
            <Input value={f.name} onChange={set('name')} placeholder="Full name" />
          </Field>
          <Field label="Phone" hint="Optional — for paying out or reaching them">
            <Input value={f.phone} onChange={set('phone')} placeholder="07xx xxx xxx" />
          </Field>
          {!edit && (
            <Field label="Link to a staff member" hint="Leave blank for someone outside your team">
              <Select
                value={f.staffId}
                onChange={set('staffId')}
                options={[{ value: '', label: '— external —' }, ...staff.map((s) => ({ value: s.id, label: `${s.name} (${s.role})` }))]}
              />
            </Field>
          )}
          <Field label="Commission type">
            <Select
              value={f.commissionType}
              onChange={set('commissionType')}
              options={[
                { value: 'percent', label: '% of first payment' },
                { value: 'fixed', label: 'Flat amount (KES)' },
              ]}
            />
          </Field>
          <Field label={f.commissionType === 'fixed' ? 'Amount (KES)' : 'Percentage'}>
            <Input
              type="number"
              min="0"
              max={f.commissionType === 'percent' ? '100' : undefined}
              value={f.commissionRate}
              onChange={set('commissionRate')}
              placeholder={f.commissionType === 'fixed' ? '500' : '10'}
            />
          </Field>
          <Field label="Notes" hint="Optional">
            <Textarea value={f.notes} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </Modal>

      {/* View: commission history */}
      <Drawer open={!!viewing} title={viewing?.name} subtitle={viewing ? commissionText(viewing) : ''} onClose={() => setViewing(null)}>
        {viewing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <KV k="Type" v={viewing.staff_id ? 'Staff member' : 'External'} />
              <KV k="Phone" v={viewing.phone ?? '—'} />
              <KV k="Clients referred" v={viewing.clients_referred ?? 0} />
              <KV k="Owed" v={kes(viewing.owed)} />
              <KV k="Paid out" v={kes(viewing.paid)} />
              {viewing.notes && <KV k="Notes" v={viewing.notes} />}
            </div>

            <div>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: color.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 8px' }}>
                Commission history
              </p>
              {commissions === null ? (
                <p style={{ fontSize: 13, color: color.muted }}>Loading…</p>
              ) : !commissions.length ? (
                <p style={{ fontSize: 13, color: color.muted }}>No clients referred yet.</p>
              ) : (
                <Table
                  rowKey={(c) => c.id}
                  rows={commissions}
                  columns={[
                    {
                      key: 'client',
                      label: 'Client',
                      render: (c) => (
                        <div>
                          <div style={{ fontWeight: 600 }}>{c.subscriber_name}</div>
                          <div style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>{c.account_code}</div>
                        </div>
                      ),
                    },
                    { key: 'basis_amount', label: 'On payment of', align: 'right', render: (c) => kes(c.basis_amount) },
                    { key: 'amount', label: 'Commission', align: 'right', render: (c) => kes(c.amount) },
                    {
                      key: 'status',
                      label: '',
                      align: 'right',
                      render: (c) =>
                        c.status === 'paid' ? (
                          <Badge tone={{ bg: '#e2ebe5', fg: color.green }}>paid</Badge>
                        ) : (
                          <Button onClick={() => markPaid(c)}>Mark paid</Button>
                        ),
                    },
                  ]}
                />
              )}
            </div>
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
            <Button variant="danger" onClick={confirmDelete}>Remove referrer</Button>
          </>
        }
      >
        <p style={{ fontSize: 13.5, color: color.muted, margin: 0 }}>
          Clients they already referred keep their history, and any commission already recorded stays exactly
          as it is. This only stops them from being offered for new referrals going forward.
        </p>
      </Modal>
    </Screen>
  );
}
