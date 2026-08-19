import React, { useMemo, useState } from 'react';
import { color, font, radius } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { downloadCsv } from '../../lib/csv';
import { Badge, Button, Card, Field, Input, Modal, Screen, Select, Table, Toggle } from '../../ui/primitives';

const STATUSES = ['All status', 'unused', 'in_use', 'expired', 'compensated'];
// The raw column values stay the filter/query vocabulary; this is only what
// gets shown, in the words an operator actually uses over the phone.
const STATUS_LABEL = { unused: 'Active', in_use: 'Used', expired: 'Expired', compensated: 'Compensated' };
const TYPES = ['All types', 'Numeric', 'Mixed', 'Words'];

export default function Vouchers() {
  const store = useStore();
  const [filter, setFilter] = useState({ status: 'All status', type: 'All types', from: '', to: '' });
  const [selected, setSelected] = useState(() => new Set());
  const [autoPurge, setAutoPurge] = useState(true);

  const vouchers = store.vouchers ?? [];

  const visible = useMemo(
    () =>
      vouchers.filter((v) => {
        if (filter.status !== 'All status' && v.status !== filter.status) return false;
        if (filter.from && new Date(v.created_at) < new Date(filter.from)) return false;
        if (filter.to && new Date(v.created_at) > new Date(filter.to)) return false;
        return true;
      }),
    [vouchers, filter]
  );

  const set = (k) => (e) => setFilter((s) => ({ ...s, [k]: e.target.value }));
  const allSelected = visible.length > 0 && visible.every((v) => selected.has(v.id));

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const expiredCount = vouchers.filter((v) => v.status === 'expired').length;

  const [gen, setGen] = useState(null); // { planId, count, batch } when the modal is open
  const [busy, setBusy] = useState(false);

  const exportCsv = () => {
    const rows = [
      ['code', 'phone', 'batch', 'status', 'data_used_mb', 'starts_at', 'expires_at', 'created_at'],
      ...visible.map((v) => [v.code, v.phone, v.batch, v.status, v.data_used_mb, v.starts_at, v.expires_at, v.created_at]),
    ];
    const n = downloadCsv(`vouchers-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    store.toast(n ? `Exported ${n} voucher(s)` : 'Nothing to export');
  };

  /** Re-send each selected code to the number that bought it. */
  const resendSms = async () => {
    const picked = visible.filter((v) => selected.has(v.id));
    const withPhone = picked.filter((v) => v.phone);
    if (!withPhone.length) return store.toast('None of the selected codes have a phone number on file');
    const results = await Promise.allSettled(
      withPhone.map((v) => api.sendSms(v.phone, `Your WiFi code is ${v.code}.`))
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const skipped = picked.length - withPhone.length;
    store.toast(`Resent ${sent} code(s)${skipped ? `, ${skipped} had no phone number` : ''}`);
  };

  const generate = async () => {
    if (!gen.planId) return store.toast('Pick the bundle these codes are for');
    setBusy(true);
    try {
      const made = await api.createVouchers({
        planId: gen.planId,
        count: Number(gen.count) || 1,
        batch: gen.batch || null,
      });
      store.setCollection('vouchers', (vs) => [...made, ...vs]);
      store.toast(`Generated ${made.length} code(s)`);
      setGen(null);
    } catch (e) {
      store.toast(`Could not generate: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      actions={
        <>
          <Button onClick={exportCsv}>Export CSV</Button>
          <Button variant="primary" onClick={() => setGen({ planId: '', count: 10, batch: '' })}>
            + Generate batch
          </Button>
        </>
      }
    >
      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
          <Field label="Status">
            <Select
              value={filter.status}
              onChange={set('status')}
              options={STATUSES.map((s) => ({ value: s, label: s === 'All status' ? s : STATUS_LABEL[s] }))}
            />
          </Field>
          <Field label="Code type">
            <Select value={filter.type} onChange={set('type')} options={TYPES} />
          </Field>
          <Field label="From">
            <Input type="date" value={filter.from} onChange={set('from')} />
          </Field>
          <Field label="To">
            <Input type="date" value={filter.to} onChange={set('to')} />
          </Field>
          {/* Filtering is live as you change a field, so there is no Apply button —
              only a way back to the unfiltered list. */}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => {
                setFilter({ status: 'All status', type: 'All types', from: '', to: '' });
                store.toast('Filters reset');
              }}
            >
              Reset filters
            </Button>
          </div>
        </div>
      </Card>

      {selected.size > 0 && (
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
          <span style={{ fontSize: 13, color: '#4a524c' }}>{selected.size} selected</span>
          <Button size="sm" onClick={resendSms}>Resend SMS</Button>
          <Button
            size="sm"
            style={{ background: color.rust, borderColor: color.rust, color: '#fff', fontWeight: 600 }}
            onClick={async () => {
              const ids = [...selected];
              try {
                const { deleted } = await api.deleteVouchers(ids);
                store.setCollection('vouchers', (vs) => vs.filter((v) => !selected.has(v.id)));
                setSelected(new Set());
                store.toast(`Deleted ${deleted} voucher(s)`);
              } catch (e) {
                store.toast(`Could not delete: ${e.message}`);
              }
            }}
          >
            Delete selected
          </Button>
        </div>
      )}

      <Card
        title="Vouchers"
        subtitle={`${visible.length} of ${vouchers.length}`}
        actions={
          <Button
            size="sm"
            onClick={async () => {
              if (!expiredCount) return store.toast('Nothing to purge');
              try {
                const { deleted } = await api.purgeExpiredVouchers();
                store.setCollection('vouchers', (vs) => vs.filter((v) => v.status !== 'expired'));
                store.toast(`Purged ${deleted} expired voucher(s)`);
              } catch (e) {
                store.toast(`Could not purge: ${e.message}`);
              }
            }}
          >
            Purge expired
          </Button>
        }
      >
        <Table
          rowKey={(v) => v.id}
          empty="No vouchers issued yet — they are created when a hotspot payment lands"
          rows={visible}
          columns={[
            {
              key: 'sel',
              label: '',
              width: 26,
              render: (v) => (
                <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Select ${v.code}`} style={{ cursor: 'pointer' }} />
              ),
            },
            { key: 'code', label: 'Code', render: (v) => <span style={{ fontFamily: font.mono, fontWeight: 500 }}>{v.code}</span> },
            { key: 'phone', label: 'Phone', render: (v) => v.phone ?? '—' },
            { key: 'batch', label: 'Batch', render: (v) => v.batch ?? '—' },
            { key: 'status', label: 'Status', render: (v) => <Badge tone={v.status}>{STATUS_LABEL[v.status] ?? v.status}</Badge> },
            { key: 'data_used_mb', label: 'Used', align: 'right', render: (v) => `${v.data_used_mb ?? 0} MB` },
            {
              key: 'expires_at',
              label: 'Expires',
              render: (v) => (v.expires_at ? new Date(v.expires_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'on first login'),
            },
          ]}
        />
        <div style={{ borderTop: `1px solid ${color.line}`, marginTop: 12, paddingTop: 4 }}>
          <Toggle
            checked={autoPurge}
            onChange={setAutoPurge}
            label="Auto-purge expired vouchers"
            detail="The expireAndSuspend job marks them expired every 5 minutes"
          />
        </div>
      </Card>

      <Modal
        open={!!gen}
        title="Generate voucher batch"
        onClose={() => setGen(null)}
        footer={
          <>
            <Button onClick={() => setGen(null)}>Cancel</Button>
            <Button variant="primary" onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        {gen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Bundle" hint="Sets the speed, duration and data cap on every code">
              <Select
                value={gen.planId}
                onChange={(e) => setGen((g) => ({ ...g, planId: e.target.value }))}
                options={[
                  { value: '', label: store.hsPlans?.length ? 'Select a bundle…' : 'No hotspot bundles yet' },
                  ...(store.hsPlans ?? []).map((p) => ({ value: p.id, label: `${p.title} · KES ${p.price}` })),
                ]}
              />
            </Field>
            <Field label="How many" hint="Maximum 500 per batch">
              <Input
                type="number"
                min={1}
                max={500}
                value={gen.count}
                onChange={(e) => setGen((g) => ({ ...g, count: e.target.value }))}
              />
            </Field>
            <Field label="Batch label" hint="Optional — helps you find them later">
              <Input value={gen.batch} onChange={(e) => setGen((g) => ({ ...g, batch: e.target.value }))} placeholder="Duka la Mama Njeri" />
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
