import React, { useMemo, useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Field, Input, Screen, Select, Table, Tabs, Textarea } from '../ui/primitives';

// "By location" is absent on purpose: subscribers has no location column in
// schema.sql, so the server could not narrow the audience and would silently
// message everyone. Add the column first, then the option.
const AUDIENCES = ['All clients', 'By router', 'By package', 'Expiring soon', 'Expired'];
const TEMPLATES = {
  'Blank message': '',
  Reminder: 'Hi {name}, your internet expires {expires}. Pay Paybill {paybill} acc {account}.',
  Outage: 'Outage at {site}. Engineers are on it, ETA {eta}. Sorry for the trouble.',
  Promo: 'Refer a neighbour and get 5 free days. Reply YES for your code.',
};

export default function Messaging() {
  const store = useStore();
  const [tab, setTab] = useState('bulk');
  const [sms, setSms] = useState({ audience: 'All clients', router: '', location: '', pkg: '', template: 'Blank message', body: '', singleClient: '' });
  const [busy, setBusy] = useState(false);

  const clients = store.clients ?? [];
  const set = (k) => (e) => setSms((s) => ({ ...s, [k]: e.target.value }));

  const recipients = useMemo(() => {
    switch (sms.audience) {
      case 'By router':
        return clients.filter((c) => !sms.router || c.router_id === sms.router).length;
      case 'By package':
        return clients.filter((c) => !sms.pkg || c.plan_id === sms.pkg).length;
      case 'Expiring soon':
        return clients.filter((c) => c.expires_at && new Date(c.expires_at) - Date.now() < 3 * 86400000).length;
      case 'Expired':
        return clients.filter((c) => c.status === 'expired').length;
      default:
        return clients.length;
    }
  }, [clients, sms.audience, sms.router, sms.pkg]);

  const len = sms.body.length;
  const parts = Math.max(1, Math.ceil(len / 160));
  const credits = (tab === 'single' ? 1 : recipients) * parts;
  const balance = store.smsCredits?.credits ?? 0;
  const after = Math.max(0, balance - credits);

  const pickTemplate = (e) => {
    const t = e.target.value;
    setSms((s) => ({ ...s, template: t, body: TEMPLATES[t] ?? s.body }));
  };

  const send = async () => {
    if (!sms.body.trim()) return store.toast('Write a message first');
    if (tab === 'single' && !sms.singleClient) return store.toast('Pick a client');
    setBusy(true);
    try {
      if (tab === 'single') {
        await api.sendMessage({ subscriberId: sms.singleClient, body: sms.body, channel: 'sms' });
        store.toast('Message sent');
      } else {
        const audience = {
          'All clients': 'all',
          'By router': 'router',
          'By package': 'package',
          'Expiring soon': 'expiring',
          Expired: 'expired',
        }[sms.audience] ?? 'all';
        const { queued } = await api.sendBulkSms({
          audience,
          routerId: sms.router || null,
          planId: sms.pkg || null,
          body: sms.body,
        });
        store.toast(`Queued for ${queued} recipient(s)`);
      }
    } catch (e) {
      store.toast(`Send failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const testSms = async () => {
    try {
      await api.sendTestSms('254712000000');
      store.toast('Test SMS sent to +254 712 000 000');
    } catch (e) {
      store.toast(`Test failed: ${e.message}`);
    }
  };

  const composer = (
    <Card
      title={tab === 'single' ? 'Message one client' : 'Bulk SMS'}
      subtitle="Sent through the tenant's primary gateway, with failover down the configured list."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tab === 'single' ? (
          <Field label="Client">
            <Select
              value={sms.singleClient}
              onChange={set('singleClient')}
              options={[
                { value: '', label: clients.length ? 'Select a client…' : 'No clients loaded' },
                ...clients.map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` })),
              ]}
            />
          </Field>
        ) : (
          <>
            <Field label="Audience" hint={`${recipients.toLocaleString()} recipient(s)`}>
              <Select value={sms.audience} onChange={set('audience')} options={AUDIENCES} />
            </Field>
            {sms.audience === 'By router' && (
              <Field label="Router">
                <Select
                  value={sms.router}
                  onChange={set('router')}
                  options={[{ value: '', label: 'All routers' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
                />
              </Field>
            )}
            {sms.audience === 'By package' && (
              <Field label="Package">
                <Select
                  value={sms.pkg}
                  onChange={set('pkg')}
                  options={[{ value: '', label: 'All packages' }, ...(store.tariffs ?? []).map((t) => ({ value: t.id, label: t.title }))]}
                />
              </Field>
            )}
          </>
        )}

        <Field label="Template">
          <Select value={sms.template} onChange={pickTemplate} options={Object.keys(TEMPLATES)} />
        </Field>

        <Field label="Message" hint="Placeholders like {name}, {expires}, {account} are filled per recipient">
          <Textarea value={sms.body} onChange={set('body')} rows={5} />
        </Field>

        <div
          style={{
            display: 'flex',
            gap: 18,
            flexWrap: 'wrap',
            fontSize: 12.5,
            color: color.neutralInk,
            borderTop: `1px solid ${color.line}`,
            paddingTop: 12,
          }}
        >
          <span>
            <span style={{ color: len > 440 ? color.rust : color.muted }}>{len}</span> chars · {parts} part(s)
          </span>
          <span>
            Credits needed <strong style={{ fontFamily: font.mono }}>{credits.toLocaleString()}</strong>
          </span>
          <span>
            Balance after <strong style={{ fontFamily: font.mono, color: after ? color.ink : color.rust }}>{after.toLocaleString()}</strong>
          </span>
        </div>

        {!store.smsCredits?.configured && (
          <div style={{ fontSize: 12.5, color: color.amberInk, background: '#fff9ec', border: '1px solid #ecd9a8', borderRadius: radius.md, padding: '10px 13px' }}>
            No SMS gateway is configured yet. Add credentials under Settings → SMS before sending.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : tab === 'single' ? 'Send message' : `Send to ${recipients.toLocaleString()}`}
          </Button>
          <Button onClick={testSms}>Send test</Button>
        </div>
      </div>
    </Card>
  );

  return (
    <Screen title="Messaging" subtitle="Bulk and one-to-one SMS, plus everything already sent.">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'bulk', label: 'Bulk SMS' },
          { id: 'single', label: 'Single client' },
          { id: 'history', label: 'History' },
        ]}
      />

      {tab === 'history' ? (
        <Card title="Sent messages">
          <Table
            rowKey={(h, i) => h.id ?? i}
            empty="Nothing sent yet"
            rows={store.smsHistory ?? []}
            columns={[
              { key: 'at', label: 'When', render: (h) => (h.at ? new Date(h.at).toLocaleString('en-KE') : '—') },
              { key: 'phone', label: 'To', render: (h) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{h.phone}</span> },
              { key: 'provider', label: 'Gateway' },
              { key: 'body', label: 'Message' },
              { key: 'status', label: 'Status' },
            ]}
          />
        </Card>
      ) : (
        composer
      )}
    </Screen>
  );
}
