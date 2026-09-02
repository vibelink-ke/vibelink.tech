import React, { useEffect, useState } from 'react';
import { color, font, radius } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { useAction, ActionResult } from '../../ui/action';
import { api } from '../../api/client';
import { Badge, Button, Card, Empty, Field, Input, Modal, Screen, Select, Table, Toggle } from '../../ui/primitives';

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
      // Payouts only. STK push and C2B work without these, so they are optional:
      // most tenants collect and never send, and demanding a credential they do
      // not have would block them setting up at all.
      { key: 'initiator_name', label: 'Initiator name', hint: 'Only for payouts and refunds', optional: true },
      { key: 'initiator_password', label: 'Initiator password', secret: true, optional: true },
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
  piggyback_till: {
    name: 'Buy Goods till (via platform)',
    blurb: 'Not live yet, pending the platform’s Safaricom aggregator approval. Once enabled: no Safaricom API app of your own needed — the platform’s own app dispatches the STK push, but the money settles directly on your till, never through the platform.',
    codeLabel: 'Till number',
    fields: [],
    services: { pppoe: false, hotspot: true },
    comingSoon: true,
  },
};

// For the dropdown label only — the paybill number itself is always typed in
// by the tenant, never looked up from this list, since a wrong paybill here
// would misdirect a real payout and this app has no way to verify one.
const KENYA_BANKS = [
  'KCB Bank', 'Equity Bank', 'Co-operative Bank', 'Absa Bank Kenya', 'Standard Chartered',
  'NCBA Bank', 'Diamond Trust Bank', 'I&M Bank', 'Family Bank', 'National Bank of Kenya',
  'Stanbic Bank', 'Housing Finance', 'Sidian Bank', 'Prime Bank', 'Bank of Africa',
  'Gulf African Bank', 'Credit Bank', 'Consolidated Bank', 'Guaranty Trust Bank', 'Ecobank',
];

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

  /**
   * Safaricom's B2C tariff — what a 'tiered'-mode tenant's payout is docked,
   * on top of settlement_commission_pct (Tenants.jsx). Platform-owner only:
   * editable here rather than hardcoded, since Safaricom updates this
   * periodically and a stale number moves real money incorrectly.
   */
  const [feeTiers, setFeeTiers] = useState(null);
  const [feeTiersLoading, setFeeTiersLoading] = useState(false);
  const [feeTiersBusy, setFeeTiersBusy] = useState(false);
  const loadFeeTiers = async () => {
    setFeeTiersLoading(true);
    try {
      const rows = await api.getB2cFeeTiers();
      setFeeTiers(rows.map((r) => ({ minAmount: String(r.min_amount), maxAmount: r.max_amount == null ? '' : String(r.max_amount), fee: String(r.fee) })));
    } catch (e) {
      store.toast(`Could not load fee tiers: ${e.message}`);
    } finally {
      setFeeTiersLoading(false);
    }
  };
  const saveFeeTiers = async () => {
    setFeeTiersBusy(true);
    try {
      await api.saveB2cFeeTiers(feeTiers);
      store.toast('B2C fee tiers saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setFeeTiersBusy(false);
    }
  };

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
    if (store.isPlatformOwner) loadFeeTiers();
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
  const action = useAction();

  const registerUrls = async (g) => {
    // A round trip to Safaricom, and the URL it registered is worth reading:
    // a wrong one means payments are taken and never confirmed, which nobody
    // notices until a customer says they paid.
    try {
      await action.run(`Registering callbacks for ${g.shortcode}`, () => api.registerGatewayUrls(g.id), {
        working: 'Asking Safaricom to send confirmations here…',
        describe: (out) => ({
          lines: [
            `Confirmation: ${out.confirmation}`,
            ...(out.validation ? [`Validation: ${out.validation}`] : []),
          ],
        }),
      });
    } catch {
      // Reported in the dialog.
    }
  };

  const save = async () => {
    const ch = CHANNELS[form.provider];
    if (!form.shortcode.trim()) return store.toast(`${ch.codeLabel} is required`);
    if (!form.id) {
      const missing = ch.fields
        .filter((f) => !f.optional)
        .filter((f) => !String(form.credentials[f.key] ?? '').trim());
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

  /**
   * Only ever takes effect on the platform-owner's own tenant — daraja.js
   * only looks this up against whichever tenant is_super_admin belongs to.
   * Kept separate from "Make default" on purpose: this paybill should not
   * also be the one used for our own SaaS billing, or a tenant's payments
   * and the platform's own traffic end up mixed on the same shortcode.
   */
  const togglePlatformCollect = async (g) => {
    try {
      await api.setGatewayPlatformCollect(g.id, !g.is_platform_collect);
      await load();
      store.toast(g.is_platform_collect
        ? `${g.label || g.shortcode} is no longer the platform-collect paybill`
        : `${g.label || g.shortcode} is now the platform-collect paybill`);
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

  const [settlementMethod, setSettlementMethod] = useState(store.session?.settlementMethod ?? 'phone');
  const [settlementPhone, setSettlementPhone] = useState(store.session?.settlementPhone ?? '');
  const [settlementTill, setSettlementTill] = useState(store.session?.settlementTill ?? '');
  const [settlementBankName, setSettlementBankName] = useState(store.session?.settlementBankName ?? '');
  const [settlementBankPaybill, setSettlementBankPaybill] = useState(store.session?.settlementBankPaybill ?? '');
  const [settlementAccountNumber, setSettlementAccountNumber] = useState(store.session?.settlementAccountNumber ?? '');
  const [settlementBusy, setSettlementBusy] = useState(false);
  const saveSettlementMethod = async () => {
    setSettlementBusy(true);
    try {
      const body = settlementMethod === 'phone' ? { method: 'phone', phone: settlementPhone }
        : settlementMethod === 'till' ? { method: 'till', till: settlementTill }
        : { method: 'bank', bankName: settlementBankName, bankPaybill: settlementBankPaybill, accountNumber: settlementAccountNumber };
      await api.updateSettlementMethod(body);
      store.signIn({
        ...store.session,
        settlementMethod, settlementPhone, settlementTill,
        settlementBankName, settlementBankPaybill, settlementAccountNumber,
      });
      store.toast('Settlement details saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setSettlementBusy(false);
    }
  };

  const setTierField = (i, key) => (e) =>
    setFeeTiers((rows) => rows.map((r, j) => (i === j ? { ...r, [key]: e.target.value } : r)));
  const addTier = () => setFeeTiers((rows) => [...rows, { minAmount: '', maxAmount: '', fee: '' }]);
  const removeTier = (i) => setFeeTiers((rows) => rows.filter((_, j) => j !== i));

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

      {store.isPlatformOwner && (
        <Card
          title="Safaricom B2C fee tiers"
          subtitle="What a payout costs to send, by amount — deducted from a 'tiered'-mode tenant's settlement (Tenants → edit). Safaricom updates this tariff periodically; keep it matched to your current Daraja tariff sheet."
        >
          {feeTiersLoading || !feeTiers ? (
            <Empty>{feeTiersLoading ? 'Loading…' : 'Could not load'}</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
                {feeTiers.map((t, i) => (
                  <React.Fragment key={i}>
                    <Input type="number" placeholder="Min (KES)" value={t.minAmount} onChange={setTierField(i, 'minAmount')} />
                    <Input type="number" placeholder="Max (blank = no limit)" value={t.maxAmount} onChange={setTierField(i, 'maxAmount')} />
                    <Input type="number" placeholder="Fee (KES)" value={t.fee} onChange={setTierField(i, 'fee')} />
                    <Button onClick={() => removeTier(i)}>Remove</Button>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={addTier}>+ Add tier</Button>
                <Button variant="primary" onClick={saveFeeTiers} disabled={feeTiersBusy}>
                  {feeTiersBusy ? 'Saving…' : 'Save tiers'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {store.session?.platformCollectEnabled && (
        <Card
          title="Settlement payout method"
          subtitle="We collect your customers' payments on our own paybill and pay you out nightly, net of commission. Choose where those payouts land — set it yourself; we never enter it for you."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Payout method">
              <Select
                value={settlementMethod}
                onChange={(e) => setSettlementMethod(e.target.value)}
                options={[
                  { value: 'phone', label: 'Phone number (M-Pesa)' },
                  { value: 'till', label: 'Till / paybill without API' },
                  { value: 'bank', label: 'Bank' },
                ]}
              />
            </Field>

            {settlementMethod === 'phone' && (
              <Field label="M-Pesa number">
                <Input
                  value={settlementPhone}
                  onChange={(e) => setSettlementPhone(e.target.value)}
                  placeholder="e.g. 0712345678"
                />
              </Field>
            )}

            {settlementMethod === 'till' && (
              <Field label="Till / paybill number">
                <Input
                  value={settlementTill}
                  onChange={(e) => setSettlementTill(e.target.value)}
                  placeholder="e.g. 123456"
                />
              </Field>
            )}

            {settlementMethod === 'bank' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <Field label="Bank">
                  <Select
                    value={settlementBankName}
                    onChange={(e) => setSettlementBankName(e.target.value)}
                    options={[{ value: '', label: 'Choose a bank…' }, ...KENYA_BANKS.map((b) => ({ value: b, label: b }))]}
                  />
                </Field>
                <Field label="Bank's paybill number">
                  <Input
                    value={settlementBankPaybill}
                    onChange={(e) => setSettlementBankPaybill(e.target.value)}
                    placeholder="e.g. 247247"
                  />
                </Field>
                <Field label="Your account number">
                  <Input
                    value={settlementAccountNumber}
                    onChange={(e) => setSettlementAccountNumber(e.target.value)}
                    placeholder="Account number at that bank"
                  />
                </Field>
              </div>
            )}

            <div>
              <Button variant="primary" onClick={saveSettlementMethod} disabled={settlementBusy}>
                {settlementBusy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {Object.entries(CHANNELS).map(([provider, ch]) => {
        const rows = gateways.filter((g) => g.provider === provider);
        return (
          <Card
            key={provider}
            title={
              ch.comingSoon ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {ch.name}
                  <Badge tone="pending">coming soon</Badge>
                </span>
              ) : ch.name
            }
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
                      {g.is_platform_collect && <Badge tone="pending">platform-collect</Badge>}
                    </span>
                  ),
                },
                { key: 'shortcode', label: ch.codeLabel, render: (g) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{g.shortcode}</span> },
                {
                  key: 'creds',
                  label: 'Credentials',
                  render: (g) => {
                    // Optional fields are excluded: a gateway that collects
                    // perfectly well would otherwise report itself incomplete
                    // for lacking payout credentials it never needs.
                    const need = ch.fields.filter((f) => !f.optional).map((f) => f.key);
                    const missing = need.filter((k) => !g.credentialKeys.includes(k));
                    const payouts = ch.fields.some((f) => f.optional)
                      && ch.fields.filter((f) => f.optional)
                        .every((f) => g.credentialKeys.includes(f.key));
                    if (!need.length) return <span style={{ color: color.muted }}>none needed</span>;
                    return missing.length ? (
                      <span style={{ color: color.rust, fontSize: 12 }}>missing {missing.length}</span>
                    ) : (
                      <span style={{ color: color.green, fontSize: 12 }}>
                        complete{payouts ? ' · payouts on' : ''}
                      </span>
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
                      {store.isPlatformOwner && g.provider === 'daraja' && (
                        <span
                          onClick={() => togglePlatformCollect(g)}
                          title="The paybill used when a gatewayless tenant collects on our behalf"
                          style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}
                        >
                          {g.is_platform_collect ? 'Stop platform-collect' : 'Use for platform-collect'}
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

      <ActionResult state={action.state} onClose={action.dismiss} />
    </div>
  );
}
