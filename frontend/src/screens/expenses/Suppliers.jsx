import React, { useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Select, Stat, Table, Textarea } from '../../ui/primitives';

const blank = () => ({
  name: '', category: '', contactName: '', phone: '', email: '', paybill: '', tillNumber: '', accountRef: '', kraPin: '', notes: '',
});

const kes = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE')}`;
const link = { fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 };

/**
 * Who the business pays. Kept beside the expense log because that is where a
 * supplier earns its keep: pick one on an expense and their totals — paid to
 * date, and what is logged against them but not yet paid — update here.
 */
export default function Suppliers({ suppliers, reload, categories, canEdit }) {
  const store = useStore();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const save = async () => {
    if (!form.name.trim()) return store.toast('A supplier needs a name');
    setBusy(true);
    try {
      if (form.id) await api.updateSupplier(form.id, form);
      else await api.createSupplier(form);
      await reload();
      store.toast(form.id ? 'Supplier updated' : 'Supplier added');
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const archive = async (s) => {
    try {
      await api.updateSupplier(s.id, { ...toForm(s), active: !s.active });
      await reload();
    } catch (e) { store.toast(`Could not update: ${e.message}`); }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete ${s.name}?`)) return;
    try {
      await api.deleteSupplier(s.id);
      await reload();
    } catch (e) { store.toast(e.message); }
  };

  const toForm = (s) => ({
    id: s.id, name: s.name, category: s.category ?? '', contactName: s.contact_name ?? '', phone: s.phone ?? '',
    email: s.email ?? '', paybill: s.paybill ?? '', tillNumber: s.till_number ?? '', accountRef: s.account_ref ?? '',
    kraPin: s.kra_pin ?? '', notes: s.notes ?? '',
  });

  const outstanding = suppliers.reduce((n, s) => n + Number(s.outstanding), 0);
  const paid = suppliers.reduce((n, s) => n + Number(s.paid_total), 0);

  return (
    <>
      <Grid min={200} gap={14}>
        <Stat label="Suppliers" value={String(suppliers.filter((s) => s.active).length)} />
        <Stat label="Owed to suppliers" value={kes(outstanding)} />
        <Stat label="Paid to suppliers" value={kes(paid)} />
      </Grid>

      <Card
        title="Suppliers"
        actions={canEdit && <Button variant="primary" onClick={() => setForm(blank())}>+ Add supplier</Button>}
      >
        <Table
          rowKey={(s) => s.id}
          empty="No suppliers yet — add the people you pay for fuel, rent, bandwidth and equipment"
          rows={suppliers}
          columns={[
            {
              key: 'name', label: 'Supplier',
              render: (s) => (
                <div style={{ display: 'flex', flexDirection: 'column', opacity: s.active ? 1 : 0.55 }}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  {s.category && <span style={{ fontSize: 11.5, color: color.muted }}>{s.category}</span>}
                </div>
              ),
            },
            {
              key: 'contact', label: 'Contact',
              render: (s) => (s.contact_name || s.phone || s.email)
                ? <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12.5 }}>
                    {s.contact_name && <span>{s.contact_name}</span>}
                    {s.phone && <span style={{ fontFamily: font.mono, color: color.muted }}>{s.phone}</span>}
                  </div>
                : <span style={{ color: color.muted }}>—</span>,
            },
            {
              key: 'pay', label: 'Pay via',
              render: (s) => (s.paybill || s.till_number)
                ? <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>
                    {s.paybill ? `Paybill ${s.paybill}${s.account_ref ? ` · ${s.account_ref}` : ''}` : `Till ${s.till_number}`}
                  </span>
                : <span style={{ color: color.muted }}>—</span>,
            },
            {
              key: 'outstanding', label: 'Owed', align: 'right',
              render: (s) => <span style={{ fontFamily: font.mono, color: Number(s.outstanding) > 0 ? color.rust : color.muted }}>{kes(s.outstanding)}</span>,
            },
            {
              key: 'paid', label: 'Paid to date', align: 'right',
              render: (s) => <span style={{ fontFamily: font.mono }}>{kes(s.paid_total)}</span>,
            },
            { key: 'active', label: '', render: (s) => !s.active && <Badge tone="default">archived</Badge> },
            {
              key: 'act', label: '', align: 'right',
              render: (s) => canEdit && (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span onClick={() => setForm(toForm(s))} style={{ ...link, color: color.green }}>Edit</span>
                  <span onClick={() => archive(s)} style={{ ...link, color: color.ink }}>{s.active ? 'Archive' : 'Restore'}</span>
                  {s.expense_count === 0 && <span onClick={() => remove(s)} style={{ ...link, color: color.rust, marginRight: 0 }}>Delete</span>}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!form}
        title={form?.id ? `Edit ${form.name}` : 'Add a supplier'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save supplier'}</Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" span={2}>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Safaricom Business" />
            </Field>
            <Field label="Usually supplies">
              <Select value={form.category} onChange={set('category')} options={[{ value: '', label: '—' }, ...categories]} />
            </Field>
            <Field label="Contact person">
              <Input value={form.contactName} onChange={set('contactName')} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={set('email')} />
            </Field>
            <Field label="M-Pesa paybill" hint="Number you pay to">
              <Input value={form.paybill} onChange={set('paybill')} />
            </Field>
            <Field label="Account number" hint="To quote on that paybill">
              <Input value={form.accountRef} onChange={set('accountRef')} />
            </Field>
            <Field label="Till number" hint="If they take a till instead">
              <Input value={form.tillNumber} onChange={set('tillNumber')} />
            </Field>
            <Field label="KRA PIN">
              <Input value={form.kraPin} onChange={set('kraPin')} />
            </Field>
            <Field label="Notes" span={2}>
              <Textarea rows={2} value={form.notes} onChange={set('notes')} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
