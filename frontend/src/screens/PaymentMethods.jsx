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

  const configured = Object.fromEntries((store.paymentMethods ?? []).map((m) => [m.provider, m]));

  const [busy, setBusy] = useState(false);

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
