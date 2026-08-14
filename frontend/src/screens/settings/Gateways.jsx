import React, { useEffect, useState } from 'react';
import { color, font, radius } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Input, Modal, Screen, Select, Table, Toggle } from '../../ui/primitives';

/**
 * Payment gateway manager.
 *
 * A tenant can hold several shortcodes per channel — ISPs commonly run more than
 * one paybill — so this is a list, not a single form. One row per channel is the
 * default and that is the one charges go through (see `config()` in db.js).
 *
 * Secrets are never sent back to the browser: the API returns only the *names* of
 * the credential keys that are set. Leaving a secret field blank on edit keeps
 * whatever is already stored.
 */

export const CHANNELS = {
  daraja: {
    name: 'M-Pesa Paybill (Daraja)',
    blurb: 'C2B confirmation plus STK push. Safaricom Daraja credentials.',
    codeLabel: 'Paybill / shortcode',
    fields: [
      { key: 'consumer_key', label: 'Consumer key', secret: true },
      { key: 'consumer_secret', label: 'Consumer secret', secret: true },
      { key: 'passkey', label: 'Passkey', secret: true },
    ],
    services: { pppoe: true, hotspot: true },
  },
  kopokopo: {
    name: 'KopoKopo',
    blurb: 'Till-based STK push. Hotspot only — the database rejects it for PPPoE.',
    codeLabel: 'Till number',
    fields: [
      { key: 'client_id', label: 'Client ID', secret: false },
      { key: 'client_secret', label: 'Client secret', secret: true },
      { key: 'api_key', label: 'API key', secret: true },
    ],
    services: { pppoe: false, hotspot: true },
  },
  bankstk: {
    name: 'Bank STK push',
    blurb: 'Equity Jenga, Co-op and KCB Buni share one adapter.',
    codeLabel: 'Merchant account',
    fields: [
      { key: 'bank', label: 'Bank (equity / coop / kcb)', secret: false },
      { key: 'account', label: 'Merchant account', secret: false },
      { key: 'token', label: 'API token', secret: true },
    ],
    services: { pppoe: true, hotspot: true },
  },
  manual_till: {
    name: 'Till / paybill without API',
    blurb: 'The companion Android app forwards M-Pesa SMS; we parse and apply them.',
    codeLabel: 'Till / paybill number',
    fields: [],
    services: { pppoe: true, hotspot: true },
  },
};

const blankFor = (provider) => ({
  provider,
  label: '',
  shortcode: '',
  credentials: {},
  enabledPppoe: CHANNELS[provider].services.pppoe,
  enabledHotspot: CHANNELS[provider].services.hotspot,
});

export default function Gateways() {
  const store = useStore();
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setGateways(await api.paymentGateways());
    } catch (e) {
      store.toast(`Could not load gateways: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = (provider) => setForm(blankFor(provider));
  const openEdit = (g) =>
    setForm({
      id: g.id,
      provider: g.provider,
      label: g.label ?? '',
      shortcode: g.shortcode ?? '',
      credentials: {},                 // blank = keep what is stored
      credentialKeys: g.credentialKeys ?? [],
      enabledPppoe: g.enabled_pppoe,
      enabledHotspot: g.enabled_hotspot,
    });

  /**
   * Pull the stored values into the open form.
   *
   * The list only ever reports which keys are set, so a saved gateway showed
   * empty boxes and looked like it had not saved at all. Fetched on request
   * rather than with every page load.
   */
  const [revealing, setRevealing] = useState(false);
  const reveal = async () => {
    setRevealing(true);
    try {
      const { credentials } = await api.gatewayCredentials(form.id);
      setForm((f) => ({ ...f, credentials: { ...f.credentials, ...credentials } }));
      store.toast('Saved values loaded into the form');
    } catch (e) {
      store.toast(`Could not read them: ${e.message}`);
    } finally {
      setRevealing(false);
    }
  };

  /**
   * Point Safaricom's C2B callbacks at us for this paybill. Without it a customer
   * pays and the confirmation goes nowhere, which looks like the payment failed.
   */
  const registerUrls = async (g) => {
    try {
      const out = await api.registerGatewayUrls(g.id);
      store.toast(`Callbacks registered for ${g.shortcode} → ${out.confirmation}`);
    } catch (e) {
      store.toast(`Safaricom refused: ${e.message}`);
    }
  };

  const save = async () => {
    const ch = CHANNELS[form.provider];
    if (!form.shortcode.trim()) return store.toast(`${ch.codeLabel} is required`);
    if (!form.id) {
      const missing = ch.fields.filter((f) => !String(form.credentials[f.key] ?? '').trim());
      if (missing.length) return store.toast(`Fill in ${missing.map((m) => m.label).join(', ')}`);
    }
    setBusy(true);
    try {
      if (form.id) await api.updateGateway(form.id, form);
      else await api.createGateway(form);
      await load();
      store.toast(form.id ? 'Gateway updated' : `${ch.name} added`);
      setForm(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async (g) => {
    try {
      await api.makeGatewayDefault(g.id);
      await load();
      store.toast(`${g.label || g.shortcode} is now the default for ${CHANNELS[g.provider].name}`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const remove = async (g) => {
    try {
      await api.deleteGateway(g.id);
      await load();
      store.toast(`${g.label || g.shortcode} removed`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  const test = async (g) => {
    try {
      const r = await api.testPaymentMethod(g.provider);
      store.toast(r.ok ? `${CHANNELS[g.provider].name}: credentials complete` : `Missing ${r.missing.join(', ')}`);
    } catch (e) {
      store.toast(e.message);
    }
  };

  const setCred = (key) => (e) =>
    setForm((s) => ({ ...s, credentials: { ...s.credentials, [key]: e.target.value } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
        Credentials are stored against this tenant and used to charge real customers.
        Secrets are write-only — once saved they are never sent back to the browser.
      </div>

      {Object.entries(CHANNELS).map(([provider, ch]) => {
        const rows = gateways.filter((g) => g.provider === provider);
        return (
          <Card
            key={provider}
            title={ch.name}
            subtitle={ch.blurb}
            actions={
              <Button size="sm" variant="primary" onClick={() => openNew(provider)}>
                + Add {provider === 'kopokopo' ? 'till' : 'paybill'}
              </Button>
            }
          >
            <Table
              rowKey={(g) => g.id}
              empty={loading ? 'Loading…' : 'None configured for this channel'}
              rows={rows}
              columns={[
                {
                  key: 'label',
                  label: 'Name',
                  render: (g) => (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{g.label || '—'}</span>
                      {g.is_default && <Badge tone="active">default</Badge>}
                    </span>
                  ),
                },
                { key: 'shortcode', label: ch.codeLabel, render: (g) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{g.shortcode}</span> },
                {
                  key: 'creds',
                  label: 'Credentials',
                  render: (g) => {
                    const need = ch.fields.map((f) => f.key);
                    const missing = need.filter((k) => !g.credentialKeys.includes(k));
                    if (!need.length) return <span style={{ color: color.muted }}>none needed</span>;
                    return missing.length ? (
                      <span style={{ color: color.rust, fontSize: 12 }}>missing {missing.length}</span>
                    ) : (
                      <span style={{ color: color.green, fontSize: 12 }}>complete</span>
                    );
                  },
                },
                {
                  key: 'services',
                  label: 'Used for',
                  render: (g) =>
                    [g.enabled_pppoe && 'PPPoE', g.enabled_hotspot && 'Hotspot'].filter(Boolean).join(' · ') || (
                      <span style={{ color: color.muted }}>disabled</span>
                    ),
                },
                {
                  key: 'act',
                  label: '',
                  align: 'right',
                  render: (g) => (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {g.provider === 'daraja' && (
                        <span
                          onClick={() => registerUrls(g)}
                          title="Tell Safaricom where to post payments for this paybill"
                          style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}
                        >
                          Register URLs
                        </span>
                      )}
                      {!g.is_default && (
                        <span onClick={() => makeDefault(g)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>
                          Make default
                        </span>
                      )}
                      <span onClick={() => test(g)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Test</span>
                      <span onClick={() => openEdit(g)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Edit</span>
                      <span onClick={() => remove(g)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        );
      })}

      <Modal
        open={!!form}
        title={form ? `${form.id ? 'Edit' : 'Add'} — ${CHANNELS[form.provider].name}` : ''}
        width={560}
        onClose={() => setForm(null)}
        footer={
          <>
            {form?.id && (
              <Button onClick={reveal} disabled={revealing}>
                {revealing ? 'Reading…' : 'Show saved values'}
              </Button>
            )}
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : form?.id ? 'Save changes' : 'Add gateway'}
            </Button>
          </>
        }
      >
        {form && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" span={2} hint="How you refer to this shortcode, e.g. “Main paybill” or “Eldoret till”">
              <Input value={form.label} onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))} placeholder="Main paybill" />
            </Field>

            <Field label={CHANNELS[form.provider].codeLabel} span={2}>
              <Input
                value={form.shortcode}
                onChange={(e) => setForm((s) => ({ ...s, shortcode: e.target.value }))}
                placeholder="4098221"
                style={{ fontFamily: font.mono }}
              />
            </Field>

            {CHANNELS[form.provider].fields.map((fld) => {
              const stored = form.credentialKeys?.includes(fld.key);
              return (
                <Field
                  key={fld.key}
                  label={fld.label}
                  span={2}
                  hint={form.id ? (stored ? 'Saved — leave blank to keep it' : 'Not set yet') : undefined}
                >
                  <Input
                    type={fld.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={form.credentials[fld.key] ?? ''}
                    onChange={setCred(fld.key)}
                    placeholder={stored ? '••••••••' : ''}
                  />
                </Field>
              );
            })}

            <div style={{ gridColumn: '1 / -1', borderTop: `1px solid ${color.line}`, paddingTop: 4 }}>
              {CHANNELS[form.provider].services.pppoe ? (
                <Toggle
                  checked={!!form.enabledPppoe}
                  onChange={(v) => setForm((s) => ({ ...s, enabledPppoe: v }))}
                  label="Use for PPPoE"
                  detail="Monthly subscriber renewals and auto-charge"
                />
              ) : (
                <div style={{ fontSize: 12.5, color: color.amberInk, padding: '9px 0' }}>
                  KopoKopo is hotspot-only — enforced by the API and a CHECK constraint.
                </div>
              )}
              <Toggle
                checked={!!form.enabledHotspot}
                onChange={(v) => setForm((s) => ({ ...s, enabledHotspot: v }))}
                label="Use for hotspot"
                detail="Captive-portal bundle purchases"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
