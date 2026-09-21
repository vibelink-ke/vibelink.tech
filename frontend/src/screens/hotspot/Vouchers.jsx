import React, { useEffect, useMemo, useState } from 'react';
import { color, font, radius } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { exportTable } from '../../lib/export';
import ExportMenu from '../../ui/ExportMenu';
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
  // Backed by hotspot_settings.auto_purge_vouchers now, not local-only
  // state — this used to reset to "on" on every visit and do nothing when
  // flipped either way, which read as already working when it never was.
  const autoPurge = store.hotspotSettings?.auto_purge_vouchers ?? true;
  const setAutoPurge = async (enabled) => {
    store.setHotspotSettings((s) => ({ ...s, auto_purge_vouchers: enabled }));
    try {
      await api.setAutoPurgeVouchers(enabled);
    } catch (e) {
      store.setHotspotSettings((s) => ({ ...s, auto_purge_vouchers: !enabled }));
      store.toast(`Could not save: ${e.message}`);
    }
  };

  const vouchers = store.vouchers ?? [];

  // Live usage: the list is re-read every 10 seconds while the tab is showing, so each
  // visitor's used data (and who is online) stays current without a refresh.
  useEffect(() => {
    let busy = false;
    const id = setInterval(async () => {
      if (document.hidden || busy) return;
      busy = true;
      try { store.setCollection('vouchers', await api.vouchers()); } catch { /* try again next tick */ }
      busy = false;
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const expiredCount = vouchers.filter((v) => v.status === 'expired').length;

  const [gen, setGen] = useState(null); // { planId, count, batch, sendTo } when the modal is open
  const [busy, setBusy] = useState(false);

  const exportCsv = async (format = 'csv') => {
    const rows = [
      ['code', 'phone', 'plan', 'mpesa_ref', 'batch', 'device_label', 'device_mac', 'online', 'status', 'data_used_mb', 'starts_at', 'expires_at', 'created_at'],
      ...visible.map((v) => [v.code, v.phone, v.plan_title, v.mpesa_ref, v.batch, v.device_label, v.device_mac, v.online, v.status, v.data_used_mb, v.starts_at, v.expires_at, v.created_at]),
    ];
    const n = await exportTable(format, 'vouchers', rows, { title: 'Vouchers', subtitle: `${visible.length} of ${vouchers.length}` });
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

  /** Text the selected codes to a number typed in — for somebody who is not the buyer. */
  const sendToNumber = async () => {
    const picked = visible.filter((v) => selected.has(v.id));
    if (!picked.length) return store.toast('Select at least one voucher first');
    const phone = window.prompt(`Send ${picked.length} code(s) by SMS to which phone number?`, '');
    if (!phone) return;
    try {
      const out = await api.sendVoucherSms(picked.map((v) => v.id), phone.trim());
      store.toast(out.sent ? `Sent ${out.codes} code(s) in ${out.sent} message(s)` : 'The SMS could not be sent');
    } catch (e) {
      store.toast(`Could not send: ${e.message}`);
    }
  };

  /** Give the selected codes extra time — after an outage, say. Only codes whose clock has started can be extended. */
  const compensate = async () => {
    const picked = visible.filter((v) => selected.has(v.id));
    if (!picked.length) return store.toast('Select at least one voucher first');
    const raw = window.prompt(`Extra time to add to ${picked.length} voucher(s), in hours:`, '1');
    if (raw === null) return;
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) return store.toast('Enter a positive number of hours');
    try {
      const out = await api.compensateVouchers(picked.map((v) => v.id), hours);
      store.setCollection('vouchers', (vs) =>
        vs.map((v) => {
          const hit = out.rows?.find((r) => r.id === v.id);
          return hit ? { ...v, status: hit.status, expires_at: hit.expires_at } : v;
        })
      );
      store.toast(`Added ${hours} hour(s) to ${out.compensated} voucher(s)${out.skipped ? `, ${out.skipped} not started yet` : ''}`);
      setSelected(new Set());
    } catch (e) {
      store.toast(`Could not compensate: ${e.message}`);
    }
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
      let smsNote = '';
      if (gen.sendTo?.trim()) {
        try {
          const out = await api.sendVoucherSms(made.map((v) => v.id), gen.sendTo.trim());
          smsNote = out.sent ? ` and sent to ${gen.sendTo.trim()}` : ', but the SMS could not be sent';
        } catch (e) {
          smsNote = `, but the SMS failed: ${e.message}`;
        }
      }
      store.toast(`Generated ${made.length} code(s)${smsNote}`);
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
          <ExportMenu onExport={exportCsv} />
          <Button variant="primary" onClick={() => setGen({ planId: '', count: 1, batch: '', sendTo: '' })}>
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
          <Button size="sm" onClick={sendToNumber}>Send to a number…</Button>
          <Button size="sm" onClick={compensate}>Compensate</Button>
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
        subtitle={`${visible.length} of ${vouchers.length} · live, updates every 10 seconds`}
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
          toolbar="always"
          select={{ selected, setSelected, id: (v) => v.id }}
          columns={[
            { key: 'code', label: 'Code', render: (v) => <span style={{ fontFamily: font.mono, fontWeight: 500 }}>{v.code}</span> },
            { key: 'phone', label: 'Phone', render: (v) => v.phone ?? '—' },
            {
              key: 'plan',
              label: 'Bundle',
              render: (v) => v.plan_title
                ? <span>{v.plan_title}{v.rate_down ? <span style={{ color: color.muted }}> · {Math.round(v.rate_down / 1000)}/{Math.round(v.rate_up / 1000)} Mbps</span> : null}</span>
                : '—',
            },
            {
              key: 'mpesa_ref',
              label: 'M-Pesa ref',
              render: (v) => v.mpesa_ref ? <span style={{ fontFamily: font.mono, fontSize: 12 }}>{v.mpesa_ref}</span> : '—',
            },
            { key: 'batch', label: 'Batch', render: (v) => v.batch ?? '—' },
            {
              // A device added via "Adding a TV or console?" is never a
              // hotspot login — it's a static ip-binding, so nothing else on
              // this screen names it. Label first (what the guest typed),
              // MAC as the fallback for a device nobody named.
              key: 'device',
              label: 'Device',
              render: (v) => v.device_mac
                ? <span>{v.device_label || <span style={{ fontFamily: font.mono, fontSize: 12 }}>{v.device_mac}</span>}</span>
                : '—',
            },
            {
              key: 'online',
              label: 'Online',
              render: (v) => v.online
                ? <Badge tone={{ bg: '#eef7f1', fg: color.green }}>online</Badge>
                : <span style={{ color: color.muted }}>—</span>,
            },
            { key: 'status', label: 'Status', render: (v) => <Badge tone={v.status}>{STATUS_LABEL[v.status] ?? v.status}</Badge> },
            {
              key: 'data_used_mb',
              label: 'Used',
              align: 'right',
              render: (v) => {
                const used = Number(v.data_used_mb ?? 0);
                const cap = Number(v.data_cap_mb ?? 0);
                const show = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`);
                return (
                  <span title={cap ? `of a ${show(cap)} cap` : 'no data cap on this bundle'} style={{ fontFamily: font.mono, fontSize: 12.5, color: cap && used >= cap ? color.rust : undefined }}>
                    {show(used)}{cap ? <span style={{ color: color.muted }}> / {show(cap)}</span> : null}
                  </span>
                );
              },
            },
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
            detail="Deletes them, and their RADIUS access, a day after they expire — off leaves them for Purge expired above"
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
            <Field label="Send the codes by SMS to" hint="Optional — a phone number to text the new codes to right away, e.g. 0712 345 678">
              <Input
                type="tel"
                value={gen.sendTo ?? ''}
                onChange={(e) => setGen((g) => ({ ...g, sendTo: e.target.value }))}
                placeholder="07XX XXX XXX"
              />
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
