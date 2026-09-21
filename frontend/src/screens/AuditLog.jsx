import React, { useCallback, useEffect, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Input, Modal, Screen, Select, Table } from '../ui/primitives';

/**
 * Audit log: who changed what, and when. Every change made in the dashboard is written down as it happens
 * (reads are not), together with sign-ins and failed sign-ins. The platform owner can widen it to every tenant.
 */
const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function AuditLog() {
  const store = useStore();
  const owner = !!store.session?.superAdmin && store.session?.role === 'owner';
  const [days, setDays] = useState('14');
  const [result, setResult] = useState('all');
  const [scope, setScope] = useState('mine');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ days, scope, limit: '1000' });
    if (result !== 'all') p.set('result', result);
    if (q.trim()) p.set('q', q.trim());
    api.audit(p.toString()).then(setRows).catch((e) => { setRows([]); store.toast(e.message); });
  }, [days, result, scope, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load]);

  const showTenant = owner && scope !== 'mine';
  return (
    <Screen
      title="Audit log"
      subtitle="Who changed what, and when. Every change made in the dashboard is recorded, along with sign-ins."
      actions={<Button onClick={load}>Refresh</Button>}
    >
      <Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <Select value={days} onChange={(e) => setDays(e.target.value)} options={[
            { value: '1', label: 'Last 24 hours' }, { value: '7', label: 'Last 7 days' }, { value: '14', label: 'Last 14 days' },
            { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '400', label: 'Everything kept' }]} />
          <Select value={result} onChange={(e) => setResult(e.target.value)} options={[
            { value: 'all', label: 'Worked or failed' }, { value: 'ok', label: 'Worked' }, { value: 'failed', label: 'Failed' }]} />
          {owner && (
            <Select value={scope} onChange={(e) => setScope(e.target.value)} options={[
              { value: 'mine', label: 'My own tenant' }, { value: 'platform', label: 'Platform actions' }, { value: 'all', label: 'All tenants' }]} />
          )}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, action or tenant" style={{ width: 260 }} />
        </div>
        {rows === null ? <div style={{ color: color.muted }}>Loading…</div> : (
          <Table
            rowKey={(r) => r.id}
            rows={rows}
            empty="Nothing recorded in this period"
            onRowClick={setOpen}
            columns={[
              { key: 'at', label: 'When', render: (r) => <span style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>{when(r.at)}</span> },
              ...(showTenant ? [{ key: 'tenant_name', label: 'Tenant', render: (r) => r.tenant_name ?? '—' }] : []),
              { key: 'actor', label: 'Who', render: (r) => (<div><span style={{ fontWeight: 600 }}>{r.actor}</span>{r.role && <div style={{ fontSize: 11.5, color: color.muted }}>{r.role}</div>}</div>) },
              { key: 'action', label: 'What', render: (r) => r.action },
              { key: 'status', label: 'Result', render: (r) => (r.status < 400
                ? <Badge tone={{ bg: '#e2ebe5', fg: color.green }}>Worked</Badge>
                : <Badge tone={{ bg: color.rustBg, fg: color.rust }}>Failed · {r.status}</Badge>) },
              { key: 'ip', label: 'From', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.muted }}>{r.ip ?? ''}</span> },
            ]}
          />
        )}
      </Card>

      <Modal open={!!open} title={open?.action ?? ''} onClose={() => setOpen(null)} width={640}
        footer={<Button variant="primary" onClick={() => setOpen(null)}>Close</Button>}>
        {open && (
          <div style={{ display: 'grid', gap: 10, fontSize: 13.5 }}>
            <div><b>{open.actor}</b>{open.role ? ` (${open.role})` : ''}{open.tenant_name ? ` · ${open.tenant_name}` : ''}</div>
            <div style={{ color: color.muted }}>{when(open.at)} · {open.method} <span style={{ fontFamily: font.mono }}>{open.path}</span> · {open.status}{open.ip ? ` · ${open.ip}` : ''}</div>
            <div style={{ fontSize: 12, color: color.muted }}>What was sent and what came back (passwords and keys are masked):</div>
            <pre style={{ margin: 0, padding: 12, background: color.tileBg, borderRadius: 8, fontFamily: font.mono, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto' }}>
              {JSON.stringify(open.detail ?? {}, null, 2)}
            </pre>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
