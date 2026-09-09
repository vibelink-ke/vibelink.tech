import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Input, Screen, Toggle } from '../ui/primitives';

/**
 * Channel definitions mirror the providers in backend/src/payments/*.
 * KopoKopo is hotspot-only — the database enforces it too
 * (constraint kopokopo_hotspot_only in schema.sql).
 */
const CHANNELS = [
  {
    id: 'daraja',
    name: 'M-Pesa Paybill (Daraja)',
    blurb: 'C2B confirmation + STK push. Used for PPPoE renewals and portal payments.',
    services: 'PPPoE · Hotspot',
    fields: [
      { key: 'shortcode', label: 'Paybill / shortcode' },
      { key: 'consumer_key', label: 'Consumer key' },
      { key: 'consumer_secret', label: 'Consumer secret', secret: true },
      { key: 'passkey', label: 'Passkey', secret: true },
    ],
  },
  {
    id: 'kopokopo',
    name: 'KopoKopo STK',
    blurb: 'Till-based STK push. Hotspot only, by policy and by database constraint.',
    services: 'Hotspot only',
    fields: [
      { key: 'shortcode', label: 'Till number' },
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client secret', secret: true },
    ],
  },
  {
    id: 'bankstk',
    name: 'Bank STK push',
    blurb: 'Equity Jenga, Co-op and KCB Buni share one adapter.',
    services: 'PPPoE · Hotspot',
    fields: [
      { key: 'bank', label: 'Bank (equity / coop / kcb)' },
      { key: 'account', label: 'Merchant account' },
      { key: 'token', label: 'API token', secret: true },
    ],
  },
  {
    id: 'manual_till',
    name: 'Till / paybill without API',
    blurb: 'The companion Android app forwards M-Pesa SMS; we parse and apply them.',
    services: 'PPPoE · Hotspot',
    fields: [{ key: 'shortcode', label: 'Till / paybill number' }],
  },
];

export default function PaymentMethods() {
  const store = useStore();
  const [creds, setCreds] = useState({});
  const [forwarder, setForwarder] = useState(false);
  const [extra, setExtra] = useState({});

  const allMethods = store.paymentMethods ?? [];
  const configured = Object.fromEntries(allMethods.map((m) => [m.provider, m]));
  const byProvider = (id) => allMethods.filter((m) => m.provider === id);

  const [busy, setBusy] = useState(false);

  const setExtraField = (channel, key) => (e) =>
    setExtra((c) => ({ ...c, [channel]: { ...(c[channel] ?? {}), [key]: e.target.value } }));

  const addExtra = async (ch) => {
    const entered = extra[ch.id] ?? {};
    const { label, shortcode, ...rest } = entered;
    if (!label) return store.toast('Give this paybill a label first');
    setBusy(true);
    try {
      await api.addPaymentMethod({
        provider: ch.id, label, shortcode: shortcode ?? null, credentials: rest,
        enabledPppoe: ch.id !== 'kopokopo', enabledHotspot: true,
      });
      setExtra((c) => ({ ...c, [ch.id]: {} }));
      await store.reload();
      store.toast(`${label} added`);
    } catch (e) {
      store.toast(`Could not add: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (row) => {
    try {
      await api.setDefaultPaymentMethod(row.id);
      await store.reload();
      store.toast(`${row.label ?? row.shortcode ?? row.provider} is now the default`);
    } catch (e) {
      store.toast(`Could not set default: ${e.message}`);
    }
  };

  const removeMethod = async (row) => {
    if (!window.confirm(`Remove ${row.label ?? row.shortcode ?? row.provider}?`)) return;
    try {
      await api.deletePaymentMethod(row.id);
      await store.reload();
      store.toast('Removed');
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  const set = (channel, key) => (e) =>
    setCreds((c) => ({ ...c, [channel]: { ...(c[channel] ?? {}), [key]: e.target.value } }));

  /**
   * Checks the saved configuration is complete. Deliberately does not call the
   * provider — a live STK push would charge a real customer.
   */
  const test = async (ch) => {
    try {
      const r = await api.testPaymentMethod(ch.id);
      store.toast(r.ok ? `${ch.name}: all required credentials present (${r.shortcode})` : `${ch.name}: missing ${r.missing.join(', ')}`);
    } catch (e) {
      store.toast(`${ch.name}: ${e.message}`);
    }
  };

  const save = async (ch) => {
    const entered = creds[ch.id] ?? {};
    const { shortcode, ...rest } = entered;
    setBusy(true);
    try {
      await api.savePaymentMethod(ch.id, {
        shortcode: shortcode ?? null,
        credentials: rest,
        // KopoKopo is hotspot-only; the route and a CHECK constraint both reject
        // enabling it for PPPoE, so never offer it here.
        enabledPppoe: ch.id !== 'kopokopo',
        enabledHotspot: true,
      });
      store.toast(`${ch.name} credentials saved`);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Payment methods"
      subtitle="Per-tenant credentials. These live in tenant_payment_config and are what the webhooks authenticate against."
    >
      <div
        style={{
          background: '#fff9ec',
          border: '1px solid #ecd9a8',
          borderRadius: radius.md,
          padding: '11px 14px',
          fontSize: 12.5,
          color: color.amberInk,
        }}
      >
        Credentials are written straight to the backend. Enter them here only on a trusted machine —
        nothing on this screen is masked once saved.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, alignItems: 'start' }}>
        {CHANNELS.map((ch) => {
          const live = configured[ch.id];
          return (
            <Card
              key={ch.id}
              title={ch.name}
              subtitle={ch.blurb}
              actions={<Badge tone={live ? 'active' : 'unused'}>{live ? 'Connected' : 'Not set'}</Badge>}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: color.muted }}>
                  <span>{ch.services}</span>
                  {live?.shortcode && <span style={{ fontFamily: font.mono }}>· {live.shortcode}</span>}
                </div>

                {ch.fields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Input
                      type={f.secret ? 'password' : 'text'}
                      autoComplete="off"
                      value={creds[ch.id]?.[f.key] ?? ''}
                      onChange={set(ch.id, f.key)}
                    />
                  </Field>
                ))}

                {ch.id === 'manual_till' && (
                  <Toggle
                    checked={forwarder}
                    onChange={setForwarder}
                    label="SMS forwarder connected"
                    detail="The Android companion app POSTs to /webhooks/forwarder/sms"
                  />
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" onClick={() => save(ch)} disabled={busy}>
                    {busy ? 'Saving…' : 'Save credentials'}
                  </Button>
                  <Button onClick={() => test(ch)}>Test</Button>
                </div>

                {byProvider(ch.id).length > 1 && (
                  <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted }}>
                      ALL PAYBILLS FOR THIS PROVIDER
                    </span>
                    {byProvider(ch.id).map((row) => (
                      <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <Badge tone={row.is_default ? 'active' : 'unused'}>{row.is_default ? 'Default' : 'Site-only'}</Badge>
                        <span>{row.label || row.shortcode || '(unlabeled)'}</span>
                        {row.shortcode && <span style={{ fontFamily: font.mono, color: color.muted }}>· {row.shortcode}</span>}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                          {!row.is_default && <Button size="sm" onClick={() => makeDefault(row)}>Make default</Button>}
                          <Button size="sm" onClick={() => removeMethod(row)}>Remove</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12.5, color: color.muted }}>
                    Add another {ch.name} paybill (for a specific site)
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                    <Field label="Label (e.g. site name)">
                      <Input value={extra[ch.id]?.label ?? ''} onChange={setExtraField(ch.id, 'label')} />
                    </Field>
                    {ch.fields.map((f) => (
                      <Field key={f.key} label={f.label}>
                        <Input
                          type={f.secret ? 'password' : 'text'}
                          autoComplete="off"
                          value={extra[ch.id]?.[f.key] ?? ''}
                          onChange={setExtraField(ch.id, f.key)}
                        />
                      </Field>
                    ))}
                    <Button onClick={() => addExtra(ch)} disabled={busy}>Add paybill</Button>
                  </div>
                </details>
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="Callback health">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          {[
            ['Last callback', configured.daraja?.last_callback_at ?? '—'],
            ['STK success rate', '—'],
            ['Parsed SMS today', '0'],
            ['Auto-matched', '0'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted }}>{k.toUpperCase()}</span>
              <span style={{ fontFamily: font.mono, fontSize: 18 }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </Screen>
  );
}
