import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Screen, Select, Table } from '../ui/primitives';

/**
 * Issues: everything that has gone wrong lately, in one list — payments that did not match a client, M-Pesa
 * prompts that failed, messages that did not send, routers that are down or could not be set up, SmartOLT
 * trouble and failed sign-ins. Each row links to where it can be fixed.
 */
const KINDS = {
  payment: 'Unmatched payment', stk: 'M-Pesa prompt', sms: 'Message', router: 'Router',
  smartolt: 'SmartOLT', login: 'Sign-in', job: 'Background job',
};
const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Issues() {
  const store = useStore();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [kind, setKind] = useState('all');
  const [days, setDays] = useState('14');

  const load = () => api.issues(days).then(setRows).catch((e) => { setRows([]); store.toast(e.message); });
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (rows ?? []).filter((r) => kind === 'all' || r.kind === kind);
  const kinds = [...new Set((rows ?? []).map((r) => r.kind))];
  return (
    <Screen title="Issues" subtitle="What has failed or not matched lately, and where to fix it." actions={<Button onClick={load}>Refresh</Button>}>
      <Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={[
            { value: 'all', label: `Everything (${rows?.length ?? 0})` },
            ...kinds.map((k) => ({ value: k, label: KINDS[k] ?? k }))]} />
          <Select value={days} onChange={(e) => setDays(e.target.value)} options={[
            { value: '3', label: 'Last 3 days' }, { value: '14', label: 'Last 14 days' }, { value: '30', label: 'Last 30 days' }]} />
        </div>
        {rows === null ? <div style={{ color: color.muted }}>Loading…</div> : (
          <Table
            rows={shown}
            rowKey={(r, i) => `${r.kind}-${r.at}-${i}`}
            empty="Nothing has gone wrong in this period"
            columns={[
              { key: 'at', label: 'When', render: (r) => <span style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>{when(r.at)}</span> },
              { key: 'kind', label: 'Type', render: (r) => <Badge tone={{ bg: color.amberBg, fg: color.amberInk }}>{KINDS[r.kind] ?? r.kind}</Badge> },
              { key: 'title', label: 'What happened', render: (r) => (<div><span style={{ fontWeight: 600 }}>{r.title}</span>{r.detail && <div style={{ fontSize: 12, color: color.muted }}>{r.detail}</div>}</div>) },
              { key: 'link', label: '', align: 'right', render: (r) => r.link && <Button size="sm" onClick={() => navigate(r.link)}>Open</Button> },
            ]}
          />
        )}
      </Card>
    </Screen>
  );
}
