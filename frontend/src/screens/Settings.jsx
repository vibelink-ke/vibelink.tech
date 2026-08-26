import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import Gateways from './settings/Gateways';
import { Badge, Button, Card, Field, Input, Screen, Select, Tabs } from '../ui/primitives';

const CURRENCIES = ['KES — Kenyan shilling', 'UGX — Ugandan shilling', 'TZS — Tanzanian shilling', 'USD — US dollar'];
const TIMEZONES = ['Africa/Nairobi (EAT)', 'Africa/Kampala (EAT)', 'Africa/Dar_es_Salaam (EAT)', 'UTC'];
const SECURITY = ['TLS (587)', 'SSL (465)', 'None (25)'];

/**
 * Fallback field definitions, used only if the API has not answered yet.
 * The real list comes from GET /api/sms/gateways → `fields`, which is generated
 * from PROVIDER_FIELDS in backend/src/sms.js — the same object credentialsComplete()
 * validates against, so the form cannot ask for a different set than the server checks.
 */
const FALLBACK_FIELDS = {
  hostpinnacle: [
    { key: 'userid', label: 'Username', required: true },
    { key: 'password', label: 'Password', required: true, secret: true },
    { key: 'sender_id', label: 'Sender ID', required: true },
    { key: 'api_key', label: 'API key', required: true, secret: true },
  ],
  africastalking: [
    { key: 'username', label: 'Username', required: true },
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'sender_id', label: 'Sender ID', required: true },
  ],
  textsms: [
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'partner_id', label: 'Partner ID', required: true },
    { key: 'sender_id', label: 'Sender ID / shortcode', required: true },
  ],
  ujumbe: [
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'email', label: 'Account email', required: true },
    { key: 'sender_id', label: 'Sender ID', required: true },
  ],
  mobitech: [
    { key: 'api_key', label: 'API key', required: true, secret: true },
    { key: 'sender_id', label: 'Sender name', required: true },
  ],
  twilio: [
    { key: 'account_sid', label: 'Account SID', required: true },
    { key: 'auth_token', label: 'Auth token', required: true, secret: true },
    { key: 'from', label: 'From number', required: true },
  ],
  custom: [
    { key: 'url', label: 'Send URL', required: true },
    { key: 'body_template', label: 'Body template', required: false },
    { key: 'balance_url', label: 'Balance URL', required: false },
  ],
};

/**
 * The browser-tab icon shown on this tenant's sign-in screen, dashboard and
 * hotspot pages — the last piece of branding that still said "the platform"
 * rather than "this ISP" once every page/title/notice already carried the
 * tenant's own name (see App.jsx's own comment on the /api/public/brand
 * fetch that applies whatever gets uploaded here).
 *
 * `version` bumps from the parent on every successful save/remove — the
 * server sends this a day-long Cache-Control, so without a change to the
 * URL itself the <img> preview would keep showing whatever the browser
 * already had cached for /api/public/favicon rather than what was just
 * uploaded or removed.
 */
function FaviconCard({ store, onChanged, version }) {
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024) {
      store.toast('That file is too large — keep it under 50KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      try {
        await api.saveFavicon(reader.result);
        setBroken(false);
        onChanged();
        store.toast('Favicon updated');
      } catch (err) {
        store.toast(`Could not save: ${err.message}`);
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteFavicon();
      setBroken(true);
      onChanged();
      store.toast('Favicon removed — back to the default');
    } catch (err) {
      store.toast(`Could not remove: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Browser tab icon">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: color.muted }}>
          Shown in the browser tab on your sign-in screen, dashboard and hotspot pages.
          PNG, ICO, SVG, JPEG or WebP, under 50KB.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!broken ? (
            <img
              src={`/api/public/favicon?v=${version}`}
              alt=""
              width={32}
              height={32}
              style={{ borderRadius: 6, border: `1px solid ${color.line}`, objectFit: 'contain' }}
              onError={() => setBroken(true)}
            />
          ) : (
            <div
              style={{
                width: 32, height: 32, borderRadius: 6, border: `1px dashed ${color.line}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9.5, color: color.muted, textAlign: 'center', lineHeight: 1.1,
              }}
            >
              none
            </div>
          )}
          <label
            style={{
              padding: '7px 13px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              cursor: busy ? 'default' : 'pointer', border: `1px solid ${color.line}`,
              background: color.cardBg, color: color.ink, opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Working…' : 'Upload'}
            <input
              type="file"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/jpeg,image/webp"
              onChange={onFile}
              disabled={busy}
              style={{ display: 'none' }}
            />
          </label>
          {!broken && (
            <Button onClick={remove} disabled={busy}>Remove</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Settings() {
  const store = useStore();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') ?? 'general');

  const [faviconVersion, setFaviconVersion] = useState(0);
  const [org, setOrg] = useState({ name: '', domain: '', currency: CURRENCIES[0], timezone: TIMEZONES[0], kraPin: '', whatsapp: '' });
  const [smtp, setSmtp] = useState({ host: '', port: '587', security: SECURITY[0], user: '', pass: '', from: '', fromName: '' });
  const [prefs, setPrefs] = useState({ hotspotPay: 'KopoKopo STK', pppoePay: 'M-Pesa Paybill', grace: '24 hours at 2 Mbps' });
  const [saving, setSaving] = useState(false);

  // Seed the forms once the server payload lands.
  useEffect(() => {
    const s = store.settings;
    if (!s?.org) return;
    setOrg((cur) => ({
      ...cur,
      name: s.org.name ?? cur.name,
      domain: s.org.subdomain ?? cur.domain,
      kraPin: s.org.kra_pin ?? cur.kraPin,
      whatsapp: s.org.support_phone ?? cur.whatsapp,
      currency: CURRENCIES.find((c) => c.startsWith(s.org.currency)) ?? cur.currency,
      timezone: TIMEZONES.find((t) => t.startsWith(s.org.timezone)) ?? cur.timezone,
    }));
    if (Object.keys(s.smtp ?? {}).length) setSmtp((cur) => ({ ...cur, ...s.smtp }));
    if (Object.keys(s.prefs ?? {}).length) setPrefs((cur) => ({ ...cur, ...s.prefs }));
  }, [store.settings]);

  const persist = async (patch, label) => {
    setSaving(true);
    try {
      await api.saveSettings(patch);
      store.setSettings((s) => ({ ...s, ...patch }));
      store.toast(`${label} saved`);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveOrg = () =>
    persist(
      {
        org: {
          name: org.name,
          currency: org.currency.slice(0, 3),
          timezone: org.timezone.split(' ')[0],
          kra_pin: org.kraPin,
          support_phone: org.whatsapp,
        },
      },
      'Organisation'
    );

  const [creds, setCreds] = useState({});
  const [priority, setPriority] = useState('1');
  const [busy, setBusy] = useState(false);

  /**
   * Load the gateway list here rather than leaning on the store's one-shot fetch.
   * The store loads once at sign-in; if that request failed — backend restarting,
   * say — nothing ever retried it and the provider dropdown stayed empty for the
   * rest of the session. Fetching on mount means opening the tab is the retry.
   */
  const [gw, setGw] = useState(store.smsGateways ?? null);
  const loadGateways = useCallback(async () => {
    try {
      setGw(await api.smsGateways());
    } catch {
      /* leave whatever we had; the tab can be reopened to retry */
    }
  }, []);

  useEffect(() => {
    if (tab === 'sms') loadGateways();
  }, [tab, loadGateways]);

  const fieldsByProvider = gw?.fields ?? FALLBACK_FIELDS;
  // `?? ` is wrong here: the initial value is an empty array, which is not nullish,
  // so the fallback would never fire. Check for content instead.
  const available = gw?.available?.length ? gw.available : Object.keys(fieldsByProvider);
  const configured = gw?.configured ?? [];

  const [provider, setProvider] = useState('hostpinnacle');
  const providerFields = fieldsByProvider[provider] ?? [];
  const savedKeys = configured.find((g) => g.provider === provider)?.credentialKeys ?? [];

  const setO = (k) => (e) => setOrg((s) => ({ ...s, [k]: e.target.value }));
  const setS = (k) => (e) => setSmtp((s) => ({ ...s, [k]: e.target.value }));

  const [me, setMeState] = useState({
    name: store.session?.name ?? '', email: store.session?.email ?? '', phone: '',
  });
  const [pw, setPwState] = useState({ current: '', next: '', again: '' });
  const setMe = (k) => (e) => setMeState((v) => ({ ...v, [k]: e.target.value }));
  const setPw = (k) => (e) => setPwState((v) => ({ ...v, [k]: e.target.value }));

  const saveMe = async () => {
    setSaving(true);
    try {
      const saved = await api.updateMe(me);
      setMeState((v) => ({ ...v, ...saved }));
      store.toast('Your details are saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pw.next !== pw.again) return store.toast('The two new passwords do not match');
    if (pw.next.length < 8) return store.toast('Use at least 8 characters');
    setSaving(true);
    try {
      await api.changePassword(pw.current, pw.next);
      // Cleared immediately: a password left in a form is one a shoulder reads.
      setPwState({ current: '', next: '', again: '' });
      store.toast('Password changed');
    } catch (e) {
      store.toast(`Could not change: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  /**
   * The SMTP form used to write into the generic settings blob, which nothing
   * ever read — saving it looked like success and sent no mail. It now talks to
   * tenant_email_config, which email.js actually sends through.
   */
  const [mailState, setMailState] = useState({ hasPassword: false, lastError: null, loaded: false });
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    if (tab !== 'smtp' || mailState.loaded) return;
    api.emailGateway()
      .then(({ config: c }) => {
        if (c) {
          setSmtp({
            host: c.host ?? '', port: String(c.port ?? 587),
            security: c.secure ? SECURITY[1] : SECURITY[0],
            user: c.username ?? '', pass: '',
            from: c.from_email ?? '', fromName: c.from_name ?? '',
          });
        }
        setMailState({ hasPassword: !!c?.has_password, lastError: c?.last_error ?? null, loaded: true });
      })
      .catch(() => setMailState((m) => ({ ...m, loaded: true })));
  }, [tab, mailState.loaded]);

  const saveMail = async () => {
    setSaving(true);
    try {
      const saved = await api.saveEmailGateway({
        host: smtp.host,
        port: Number(smtp.port) || 587,
        username: smtp.user || null,
        // Blank means "keep the stored one" — the server treats it that way too.
        password: smtp.pass || undefined,
        from_email: smtp.from,
        from_name: smtp.fromName || null,
      });
      setMailState((m) => ({ ...m, hasPassword: !!saved.has_password, lastError: null }));
      setSmtp((x) => ({ ...x, pass: '' }));
      store.toast('Email gateway saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const testMail = async () => {
    if (!testTo.trim()) return store.toast('Enter an address to send the test to');
    setSaving(true);
    try {
      await api.sendTestEmail(testTo.trim());
      store.toast(`Test email sent to ${testTo.trim()}`);
      setMailState((m) => ({ ...m, lastError: null }));
    } catch (e) {
      setMailState((m) => ({ ...m, lastError: e.message }));
      store.toast(`Could not send: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };
  const setP = (k) => (e) => setPrefs((s) => ({ ...s, [k]: e.target.value }));
  const setC = (k) => (e) => setCreds((c) => ({ ...c, [k]: e.target.value }));

  const saveGateway = async () => {
    setBusy(true);
    try {
      const r = await api.saveSmsGateway(provider, {
        credentials: creds,
        priority: Number(priority) || 1,
        enabled: true,
        templates: {},
      });
      store.toast(
        r.complete
          ? `${provider} saved — all required fields present`
          : `${provider} saved, but still missing ${r.missing.join(', ')} — it will be skipped until complete`
      );
      setCreds({});                       // secrets are stored; do not keep them in memory
      await loadGateways();               // refresh the configured list and its missing flags
      store.setSmsCredits(await api.smsBalance(true));
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Settings" subtitle="Organisation, billing preferences and the gateways this tenant sends through.">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'gateways', label: 'Payment gateways' },
          { id: 'sms', label: 'SMS gateways' },
          { id: 'smtp', label: 'Email' },
          { id: 'prefs', label: 'Preferences' },
          { id: 'account', label: 'My account' },
        ]}
      />

      {tab === 'gateways' && <Gateways />}

      {/* Your own login, not the business. Neither could be changed from inside
          the product: a mistyped name at signup was permanent, and anyone who
          thought their password was known had to ask us to reset it — which
          means somebody being told a password, the thing passwords avoid. */}
      {tab === 'account' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, alignItems: 'start' }}>
          <Card title="Your details" subtitle="How you appear to your team">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Full name">
                <Input value={me.name} onChange={setMe('name')} />
              </Field>
              <Field label="Email" hint="You sign in with this">
                <Input value={me.email} onChange={setMe('email')} autoComplete="email" />
              </Field>
              <Field label="Phone">
                <Input value={me.phone} onChange={setMe('phone')} />
              </Field>
              <Button variant="primary" onClick={saveMe} disabled={saving}>
                {saving ? 'Saving…' : 'Save details'}
              </Button>
            </div>
          </Card>

          <Card title="Password" subtitle="Changing it does not sign out your other devices">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Current password">
                <Input type="password" value={pw.current} onChange={setPw('current')} autoComplete="current-password" />
              </Field>
              <Field label="New password" hint="At least 8 characters">
                <Input type="password" value={pw.next} onChange={setPw('next')} autoComplete="new-password" />
              </Field>
              <Field label="Repeat new password">
                <Input type="password" value={pw.again} onChange={setPw('again')} autoComplete="new-password" />
              </Field>
              <Button variant="primary" onClick={changePassword} disabled={saving}>
                {saving ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'general' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, alignItems: 'start' }}>
          <Card title="Organisation">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Business name">
                <Input value={org.name} onChange={setO('name')} placeholder="Zurinet" />
              </Field>
              <Field label="Subdomain" hint="The backend resolves the tenant from this host">
                <Input value={org.domain} onChange={setO('domain')} placeholder="zurinet" />
              </Field>
              <Field label="KRA PIN">
                <Input value={org.kraPin} onChange={setO('kraPin')} />
              </Field>
              <Field label="Support WhatsApp">
                <Input value={org.whatsapp} onChange={setO('whatsapp')} placeholder="07xx xxx xxx" />
              </Field>
              <Button variant="primary" onClick={saveOrg} disabled={saving} style={{ alignSelf: 'flex-start' }}>
                {saving ? 'Saving…' : 'Save organisation'}
              </Button>
            </div>
          </Card>

          <FaviconCard store={store} version={faviconVersion} onChanged={() => setFaviconVersion((v) => v + 1)} />

          <Card title="Locale">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Currency">
                <Select value={org.currency} onChange={setO('currency')} options={CURRENCIES} />
              </Field>
              <Field label="Timezone">
                <Select value={org.timezone} onChange={setO('timezone')} options={TIMEZONES} />
              </Field>
            </div>
          </Card>

          <Card title="Licence">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: color.muted }}>Status</span>
                <Badge tone="unused">Not activated</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: color.muted }}>Expires</span>
                <span style={{ fontFamily: font.mono }}>—</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'sms' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, alignItems: 'start' }}>
          <Card
            title="Primary gateway"
            subtitle="Others act as failover, in priority order"
            actions={
              <Badge tone={store.smsCredits == null ? 'default' : store.smsCredits.configured ? 'active' : 'unused'}>
                {store.smsCredits == null ? 'Checking…' : store.smsCredits.configured ? 'Connected' : 'Not set'}
              </Badge>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Gateway">
                <Select value={provider} onChange={(e) => { setProvider(e.target.value); setCreds({}); }} options={available} />
              </Field>

              <Field
                label="Priority"
                hint="Lowest number is tried first; the rest are failover in order"
              >
                <Input type="number" min="0" value={priority} onChange={(e) => setPriority(e.target.value)} />
              </Field>
              {providerFields.map((f) => (
                <Field
                  key={f.key}
                  label={f.required ? f.label : `${f.label} (optional)`}
                  hint={savedKeys.includes(f.key) ? 'Saved — leave blank to keep it' : undefined}
                >
                  <Input
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={creds[f.key] ?? ''}
                    onChange={setC(f.key)}
                    placeholder={savedKeys.includes(f.key) ? '••••••••' : ''}
                  />
                </Field>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" onClick={saveGateway} disabled={busy}>
                  {busy ? 'Saving…' : 'Save gateway'}
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const bal = await api.smsBalance(true);
                      store.setSmsCredits(bal);
                      store.toast(`Balance: ${bal.credits} credits`);
                    } catch (e) {
                      store.toast(`Balance check failed: ${e.message}`);
                    }
                  }}
                >
                  Refresh balance
                </Button>
              </div>
            </div>
          </Card>

          <Card title="Configured gateways">
            {configured.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>
                None configured — messaging will not send
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {configured.map((g) => (
                  <div
                    key={g.provider}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '9px 11px',
                      border: `1px solid ${color.line}`,
                      borderRadius: radius.md,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontWeight: 500 }}>{g.provider}</span>
                      {g.missing?.length > 0 && (
                        <span style={{ fontSize: 11.5, color: color.rust }}>
                          missing {g.missing.join(', ')} — skipped when sending
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontFamily: font.mono, fontSize: 12, color: color.muted }}>priority {g.priority}</span>
                      <Badge tone={g.missing?.length ? 'expired' : g.enabled ? 'active' : 'unused'}>
                        {g.missing?.length ? 'incomplete' : g.enabled ? 'on' : 'off'}
                      </Badge>
                      <span
                        onClick={async () => {
                          try {
                            await api.deleteSmsGateway(g.provider);
                            store.toast(`${g.provider} removed`);
                            await loadGateways();
                            store.setSmsCredits(await api.smsBalance(true));
                          } catch (e) {
                            store.toast(`Could not remove: ${e.message}`);
                          }
                        }}
                        style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Remove
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'smtp' && (
        <Card title="Outgoing email" subtitle="Used for invoices and staff invites">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="Host">
              <Input value={smtp.host} onChange={setS('host')} placeholder="smtp.example.com" />
            </Field>
            <Field label="Port">
              <Input value={smtp.port} onChange={setS('port')} />
            </Field>
            <Field label="Security">
              <Select value={smtp.security} onChange={setS('security')} options={SECURITY} />
            </Field>
            <Field label="Username">
              <Input value={smtp.user} onChange={setS('user')} autoComplete="off" />
            </Field>
            <Field label="Password">
              <Input type="password" value={smtp.pass} onChange={setS('pass')} autoComplete="off" />
            </Field>
            <Field label="From address">
              <Input value={smtp.from} onChange={setS('from')} placeholder="billing@example.com" />
            </Field>
            <Field label="From name">
              <Input value={smtp.fromName} onChange={setS('fromName')} />
            </Field>
          </div>
          {mailState.hasPassword && !smtp.pass && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: color.muted }}>
              A password is stored. Leave the field blank to keep it.
            </div>
          )}
          {mailState.lastError && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: color.rust }}>
              Last attempt failed: {mailState.lastError}
            </div>
          )}
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Button variant="primary" onClick={saveMail} disabled={saving}>
              {saving ? 'Saving…' : 'Save email settings'}
            </Button>
            <div style={{ minWidth: 220 }}>
              <Field label="Send a test to">
                <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@yourdomain.co.ke" />
              </Field>
            </div>
            <Button onClick={testMail} disabled={saving}>Send test</Button>
          </div>
        </Card>
      )}

      {tab === 'prefs' && (
        <Card title="Billing preferences">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <Field label="Hotspot payment channel">
              <Select value={prefs.hotspotPay} onChange={setP('hotspotPay')} options={['KopoKopo STK', 'M-Pesa Paybill', 'Bank STK', 'Till (no API)']} />
            </Field>
            <Field label="PPPoE payment channel" hint="KopoKopo is not offered here — it is hotspot-only">
              <Select value={prefs.pppoePay} onChange={setP('pppoePay')} options={['M-Pesa Paybill', 'Bank STK', 'Till (no API)']} />
            </Field>
            <Field label="Grace period" hint="What an expired line gets before suspension">
              <Select value={prefs.grace} onChange={setP('grace')} options={['24 hours at 2 Mbps', '48 hours at 1 Mbps', 'No grace period']} />
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="primary" onClick={() => persist({ prefs }, 'Preferences')} disabled={saving}>
              {saving ? 'Saving…' : 'Save preferences'}
            </Button>
          </div>
        </Card>
      )}
    </Screen>
  );
}
