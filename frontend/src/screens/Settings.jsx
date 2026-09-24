import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { passkeySupported, enablePasskey, forgetPasskeyFlag } from '../lib/passkey';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import useLicence from '../app/useLicence';
import PasswordHelper from '../ui/PasswordHelper';
import { passwordProblem } from '../lib/password';
import Gateways from './settings/Gateways';
import MpesaValidation from './settings/MpesaValidation';
import Templates from './settings/Templates';
import { Badge, Button, Card, Field, Input, Modal, Screen, Select, Tabs } from '../ui/primitives';

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
          Shown in the browser tab on your sign-in screen, dashboard and hotspot pages —
          and doubles as your logo on the sign-in screen and the sidebar, in place of the
          plain letter/WiFi mark. PNG, ICO, SVG, JPEG or WebP, under 50KB.
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

/** A VAPID key arrives base64url-encoded; the Push API wants raw bytes. */
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Push notifications for this browser — a router-down/SLA/payment alert
 * arriving even with no tab open, the same way a native app's would. Per
 * browser install, not a single per-account toggle: signing in on a second
 * phone needs its own permission grant and its own subscription, which is
 * exactly why this reads its own state from the browser rather than from
 * anything the server already knows about the staff member.
 */
function NotificationsCard({ store }) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
  const [sub, setSub] = useState(null);   // undefined = not checked yet, null = none, object = subscribed
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(setSub)
      .catch(() => setSub(null));
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        store.toast('Notifications were not allowed — check your browser\'s site settings to enable them');
        return;
      }
      const { key } = await api.vapidPublicKey();
      if (!key) {
        store.toast('Push is not configured on this server yet — ask whoever runs Vibelink to set it up');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await api.pushSubscribe(subscription.toJSON());
      setSub(subscription);
      store.toast('Notifications enabled on this device');
    } catch (e) {
      store.toast(`Could not enable notifications: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const endpoint = sub?.endpoint;
      await sub?.unsubscribe();
      if (endpoint) await api.pushUnsubscribe(endpoint);
      setSub(null);
      store.toast('Notifications turned off on this device');
    } catch (e) {
      store.toast(`Could not turn off: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Notifications" subtitle="Router-down, SLA and payment alerts on this device">
      {!supported ? (
        <p style={{ margin: 0, fontSize: 12.5, color: color.muted }}>
          This browser does not support push notifications, or the page was not opened over HTTPS.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: color.muted }}>
            {sub
              ? 'Enabled on this device — you\'ll get alerts here even with the tab closed.'
              : 'Off. Alerts still go by SMS/WhatsApp either way; this adds a notification on this device too.'}
          </p>
          <Button variant={sub ? undefined : 'primary'} onClick={sub ? disable : enable} disabled={busy}>
            {busy ? 'Working…' : sub ? 'Turn off on this device' : 'Enable on this device'}
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function Settings() {
  const store = useStore();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const lic = useLicence();
  const [tab, setTab] = useState(params.get('tab') ?? 'general');

  const [faviconVersion, setFaviconVersion] = useState(0);
  const [org, setOrg] = useState({ name: '', domain: '', currency: CURRENCIES[0], timezone: TIMEZONES[0], kraPin: '', whatsapp: '' });
  const [smtp, setSmtp] = useState({ host: '', port: '587', security: SECURITY[0], user: '', pass: '', from: '', fromName: '' });
  const [prefs, setPrefs] = useState({
    hotspotPay: 'KopoKopo STK', pppoePay: 'M-Pesa Paybill', grace: '24 hours at 2 Mbps',
    taxRate: '', taxInclusive: 'Yes',
  });
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
    if (tab === 'sms' || tab === 'whatsapp') loadGateways();
  }, [tab, loadGateways]);

  const fieldsByProvider = gw?.fields ?? FALLBACK_FIELDS;
  // `?? ` is wrong here: the initial value is an empty array, which is not nullish,
  // so the fallback would never fire. Check for content instead.
  const available = gw?.available?.length ? gw.available : Object.keys(fieldsByProvider);
  // Not a real provider — it has no credentials of its own, only a shared
  // balance — but it still belongs in the same picker as everything else a
  // tenant can send through, not off on its own.
  const availableWithPlatform = [{ value: 'platform_default', label: 'System default (platform)' }, ...available];
  const configured = gw?.configured ?? [];

  const [provider, setProvider] = useState('hostpinnacle');
  const providerFields = fieldsByProvider[provider] ?? [];
  const savedKeys = configured.find((g) => g.provider === provider)?.credentialKeys ?? [];

  // Not one of the ordered SMS failover gateways — it sends in parallel with
  // whichever of those succeeds (see sms.js's sendWhatsApp), so it gets its
  // own tab and its own save/remove flow rather than living in the list above.
  const smsConfigured = configured.filter((g) => g.provider !== 'twilio_whatsapp');
  const waFields = fieldsByProvider.twilio_whatsapp ?? [];
  const waConfig = configured.find((g) => g.provider === 'twilio_whatsapp');
  const [waCreds, setWaCreds] = useState({});
  const [waBusy, setWaBusy] = useState(false);
  const setWa = (k) => (e) => setWaCreds((s) => ({ ...s, [k]: e.target.value }));

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
    const pwProblem = passwordProblem(pw.next);
    if (pwProblem) return store.toast(pwProblem);
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

  const saveWhatsApp = async () => {
    setWaBusy(true);
    try {
      const r = await api.saveSmsGateway('twilio_whatsapp', {
        credentials: waCreds,
        // Always tried, not ordered against the SMS list — priority is
        // meaningless here since this never competes for "which one fires
        // first," but the column is shared with tenant_sms_config.
        priority: 0,
        enabled: true,
        templates: {},
      });
      store.toast(
        r.complete
          ? 'WhatsApp saved — messages will now send alongside SMS'
          : `WhatsApp saved, but still missing ${r.missing.join(', ')} — it will be skipped until complete`
      );
      setWaCreds({});
      await loadGateways();
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setWaBusy(false);
    }
  };

  const [buyOpen, setBuyOpen] = useState(false);
  const [buyQty, setBuyQty] = useState('50');
  const [buyPhone, setBuyPhone] = useState('');
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyMsg, setBuyMsg] = useState('');
  const buyPoll = useRef(null);
  useEffect(() => () => clearInterval(buyPoll.current), []);

  const pricePerCredit = gw?.platformPricePerCredit ?? 2;
  const buyCost = Math.round((Number(buyQty) || 0) * pricePerCredit);

  const buyCredits = async () => {
    const qty = Math.round(Number(buyQty));
    if (!(qty > 0)) return setBuyMsg('Enter how many credits to buy.');
    if (!buyPhone.trim()) return setBuyMsg('Enter the M-Pesa number to pay from.');
    setBuyBusy(true);
    setBuyMsg('');
    try {
      const r = await api.buySmsCredits(qty, buyPhone.trim());
      setBuyMsg('Check your phone and enter your M-Pesa PIN.');
      clearInterval(buyPoll.current);
      let elapsed = 0;
      buyPoll.current = setInterval(async () => {
        elapsed += 3;
        try {
          const s = await api.buySmsCreditsStatus(r.checkoutId);
          if (s.status === 'success') {
            clearInterval(buyPoll.current);
            setBuyMsg(`Paid — ${qty} credits added.`);
            setBuyBusy(false);
            await loadGateways();
          } else if (s.status === 'failed' || s.status === 'timeout') {
            clearInterval(buyPoll.current);
            setBuyMsg(s.result_desc || 'The payment did not go through.');
            setBuyBusy(false);
          } else if (elapsed >= 90) {
            clearInterval(buyPoll.current);
            setBuyMsg('Still waiting — if you paid, the balance will update shortly.');
            setBuyBusy(false);
          }
        } catch { /* keep polling; a dropped check is not a failure */ }
      }, 3000);
    } catch (e) {
      setBuyMsg(e.message);
      setBuyBusy(false);
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
          { id: 'validation', label: 'M-Pesa validation' },
          { id: 'sms', label: 'SMS gateways' },
          { id: 'whatsapp', label: 'WhatsApp' },
          { id: 'smtp', label: 'Email' },
          { id: 'templates', label: 'Message templates' },
          { id: 'prefs', label: 'Preferences' },
          { id: 'account', label: 'My account' },
        ]}
      />

      {tab === 'gateways' && <Gateways />}
      {tab === 'validation' && <MpesaValidation />}
      {tab === 'templates' && <Templates />}

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
              <Field label="New password" hint="8+ characters with upper and lower case, a number and a symbol">
                <Input type="password" value={pw.next} onChange={setPw('next')} autoComplete="new-password" />
              </Field>
              <PasswordHelper
                value={pw.next}
                onSuggest={(p) => setPwState((v) => ({ ...v, next: p, again: p }))}
              />
              <Field label="Repeat new password">
                <Input type="password" value={pw.again} onChange={setPw('again')} autoComplete="new-password" />
              </Field>
              <Button variant="primary" onClick={changePassword} disabled={saving}>
                {saving ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          </Card>

          <PasskeyCard store={store} />

          <AuthenticatorCard store={store} />

          <NotificationsCard store={store} />
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

          <Card
            title="Licence"
            actions={store.session?.perms?.['billing.view'] ? <Button size="sm" onClick={() => navigate('/licence')}>Billing</Button> : null}
          >
            {!lic ? (
              <div style={{ fontSize: 13, color: color.muted }}>Checking…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: color.muted }}>Status</span>
                  <Badge tone={lic.readOnly ? 'expired' : lic.trial ? 'unused' : 'active'}>
                    {lic.readOnly ? 'Expired' : lic.trial ? 'Free trial' : 'Active'}
                  </Badge>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: color.muted }}>{lic.readOnly ? 'Expired on' : 'Expires'}</span>
                  <span style={{ fontFamily: font.mono }}>{lic.licenceEnds ? new Date(lic.licenceEnds).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No end date'}</span>
                </div>
                {lic.daysLeft != null && !lic.readOnly && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: color.muted }}>Days left</span>
                    <span style={{ fontFamily: font.mono }}>{lic.daysLeft}</span>
                  </div>
                )}
                {Number(lic.amountDue) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: color.muted }}>Due now</span>
                    <span style={{ fontFamily: font.mono, color: color.rust, fontWeight: 600 }}>KES {Number(lic.amountDue).toLocaleString('en-KE')}</span>
                  </div>
                )}
              </div>
            )}
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
                <Select value={provider} onChange={(e) => { setProvider(e.target.value); setCreds({}); }} options={availableWithPlatform} />
              </Field>

              {provider === 'platform_default' ? (
                <div style={{ fontSize: 12.5, color: color.muted, padding: '4px 0' }}>
                  Nothing to configure — this is the platform's own gateway, shared credentials you
                  don't manage here. It's used automatically whenever your own gateways are missing
                  or fail, spending from the balance shown as "System default" below.
                </div>
              ) : (
                <>
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
                </>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {provider !== 'platform_default' && (
                  <Button variant="primary" onClick={saveGateway} disabled={busy}>
                    {busy ? 'Saving…' : 'Save gateway'}
                  </Button>
                )}
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
            {smsConfigured.length === 0 && (gw?.platformBalance ?? 0) === 0 && (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>
                None configured — messaging will not send
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
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
                  <span style={{ fontWeight: 500 }}>System default</span>
                  <span style={{ fontSize: 11.5, color: color.muted }}>
                    Used when your own gateways are missing or fail
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontFamily: font.mono, fontSize: 12, color: color.muted }}>
                    {gw?.platformBalance ?? 0} credit{(gw?.platformBalance ?? 0) === 1 ? '' : 's'}
                  </span>
                  <Badge tone={(gw?.platformBalance ?? 0) > 0 ? 'active' : 'unused'}>
                    {(gw?.platformBalance ?? 0) > 0 ? 'on' : 'empty'}
                  </Badge>
                  <span
                    onClick={() => { setBuyOpen(true); setBuyMsg(''); }}
                    style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Buy more
                  </span>
                </span>
              </div>
              {smsConfigured.map((g) => (
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
          </Card>
        </div>
      )}

      <Modal
        open={buyOpen}
        title="Buy platform SMS credits"
        onClose={() => { if (!buyBusy) setBuyOpen(false); }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setBuyOpen(false)} disabled={buyBusy}>Close</Button>
            <Button variant="primary" onClick={buyCredits} disabled={buyBusy}>
              {buyBusy ? 'Working…' : `Pay KES ${buyCost}`}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="How many credits" hint={`KES ${pricePerCredit} per credit`}>
            <Input type="number" min="1" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
          </Field>
          <Field label="M-Pesa phone number">
            <Input value={buyPhone} onChange={(e) => setBuyPhone(e.target.value)} placeholder="07xx xxx xxx" />
          </Field>
          {buyMsg && <div style={{ fontSize: 12.5, color: color.muted }}>{buyMsg}</div>}
        </div>
      </Modal>

      {tab === 'whatsapp' && (
        <Card
          title="WhatsApp (via Twilio)"
          subtitle="Sends alongside SMS, not instead of it — every message goes out on both when both are set up"
          actions={
            <Badge tone={waConfig && !waConfig.missing?.length ? 'active' : 'unused'}>
              {waConfig && !waConfig.missing?.length ? 'Connected' : 'Not set'}
            </Badge>
          }
          style={{ maxWidth: 420 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: color.muted }}>
              Needs a Twilio account with WhatsApp enabled — Twilio's own sandbox number works for
              testing before a WhatsApp Business sender is approved.
            </p>
            {waFields.map((f) => (
              <Field
                key={f.key}
                label={f.required ? f.label : `${f.label} (optional)`}
                hint={waConfig?.credentialKeys?.includes(f.key) ? 'Saved — leave blank to keep it' : undefined}
              >
                <Input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={waCreds[f.key] ?? ''}
                  onChange={setWa(f.key)}
                  placeholder={waConfig?.credentialKeys?.includes(f.key) ? '••••••••' : ''}
                />
              </Field>
            ))}
            {waConfig?.missing?.length > 0 && (
              <span style={{ fontSize: 11.5, color: color.rust }}>
                missing {waConfig.missing.join(', ')} — skipped when sending until complete
              </span>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={saveWhatsApp} disabled={waBusy}>
                {waBusy ? 'Saving…' : 'Save WhatsApp'}
              </Button>
              {waConfig && (
                <Button
                  onClick={async () => {
                    try {
                      await api.deleteSmsGateway('twilio_whatsapp');
                      store.toast('WhatsApp removed');
                      await loadGateways();
                    } catch (e) {
                      store.toast(`Could not remove: ${e.message}`);
                    }
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </Card>
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

      {tab === 'prefs' && (
        <Card
          title="Tax"
          subtitle="What plan prices actually mean — UISP calls this Pricing Mode. Purely a display setting: it changes how invoices and receipts break out tax, not the price a customer is charged."
          style={{ marginTop: 14 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <Field label="Tax rate (%)" hint="Leave blank or 0 to show no tax breakdown at all">
              <Input type="number" min="0" step="0.5" value={prefs.taxRate} onChange={setP('taxRate')} placeholder="16" />
            </Field>
            <Field
              label="Plan prices are"
              hint={prefs.taxInclusive === 'Yes'
                ? 'A KES 1,500 plan already includes tax — the receipt shows the tax portion, not an add-on'
                : 'A KES 1,500 plan is before tax — the receipt adds tax on top'}
            >
              <Select
                value={prefs.taxInclusive}
                onChange={setP('taxInclusive')}
                options={[{ value: 'Yes', label: 'Tax-inclusive' }, { value: 'No', label: 'Tax-exclusive' }]}
              />
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="primary" onClick={() => persist({ prefs }, 'Tax settings')} disabled={saving}>
              {saving ? 'Saving…' : 'Save tax settings'}
            </Button>
          </div>
        </Card>
      )}
    </Screen>
  );
}

/**
 * Two-step sign-in with an authenticator app: scan a QR code once, confirm with a code, and keep the backup codes.
 * After that a password alone no longer opens the account.
 */
function AuthenticatorCard({ store }) {
  const [st, setSt] = useState(null);
  const [setup, setSetup] = useState(null);       // { secret, uri, qr }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);       // backup codes, shown once
  const [off, setOff] = useState(null);           // null | { password, code, mode: 'off' | 'codes' }
  const [busy, setBusy] = useState(false);

  const load = () => api.totpStatus().then(setSt).catch(() => setSt({ enabled: false, backupLeft: 0 }));
  useEffect(() => { load(); }, []);

  const start = async () => {
    setBusy(true);
    try {
      const s = await api.totpSetup();
      setSetup({ ...s, qr: await QRCode.toDataURL(s.uri, { margin: 1, width: 200 }) });
      setCode('');
    } catch (e) { store.toast(e.message); } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.totpEnable(code);
      setSetup(null);
      setCodes(r.backupCodes);
      await load();
    } catch (e) { store.toast(e.message); } finally { setBusy(false); }
  };

  const submitOff = async () => {
    setBusy(true);
    try {
      if (off.mode === 'off') {
        await api.totpDisable({ password: off.password, code: off.code });
        store.toast('Two-step sign-in is off');
      } else {
        setCodes((await api.totpBackupCodes({ password: off.password, code: off.code })).backupCodes);
      }
      setOff(null);
      await load();
    } catch (e) { store.toast(e.message); } finally { setBusy(false); }
  };

  const box = { height: 40, borderRadius: 8, border: '1px solid #d9ddd6', padding: '0 10px', fontSize: 14, boxSizing: 'border-box', width: '100%' };

  return (
    <Card title="Authenticator app" subtitle="Ask for a 6-digit code from Google Authenticator, Microsoft Authenticator or Authy when you sign in with your password">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {codes && (
          <div style={{ background: '#fbf0d9', borderRadius: 10, padding: 12, fontSize: 13 }}>
            <b>Save these backup codes now.</b> Each works once if you lose your phone. They are not shown again.
            <div style={{ fontFamily: 'monospace', fontSize: 14, columns: 2, marginTop: 8 }}>{codes.map((c) => <div key={c}>{c}</div>)}</div>
            <div style={{ marginTop: 8 }}><Button size="sm" onClick={() => setCodes(null)}>I have saved them</Button></div>
          </div>
        )}
        {st && !st.enabled && !setup && (
          <Button variant="primary" onClick={start} disabled={busy}>Set up an authenticator app</Button>
        )}
        {setup && (
          <>
            <span style={{ fontSize: 13 }}>1. Scan this with your authenticator app (or type the key in).</span>
            <img src={setup.qr} alt="QR code" width={200} height={200} />
            <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{setup.secret}</span>
            <span style={{ fontSize: 13 }}>2. Enter the 6-digit code it shows.</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={7} placeholder="123456" style={box} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={confirm} disabled={busy || code.replace(/\s/g, '').length < 6}>Turn on</Button>
              <Button onClick={() => setSetup(null)}>Cancel</Button>
            </div>
          </>
        )}
        {st?.enabled && !off && (
          <>
            <span style={{ fontSize: 13 }}>On. {st.backupLeft} backup code{st.backupLeft === 1 ? '' : 's'} left.</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => setOff({ mode: 'codes', password: '', code: '' })}>New backup codes</Button>
              <Button size="sm" onClick={() => setOff({ mode: 'off', password: '', code: '' })}>Turn off</Button>
            </div>
          </>
        )}
        {off && (
          <>
            <span style={{ fontSize: 13 }}>Confirm it is you: your password and a current code (or a backup code).</span>
            <input type="password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} placeholder="Password" style={box} autoComplete="current-password" />
            <input value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} placeholder="Code" style={box} autoComplete="one-time-code" />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={submitOff} disabled={busy || !off.password || !off.code}>{off.mode === 'off' ? 'Turn off' : 'Make new codes'}</Button>
              <Button onClick={() => setOff(null)}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Fingerprint sign-in: turn it on for this phone or laptop, see the devices it is on, and remove one. The fingerprint
 * itself never leaves the device; only a public key is kept here.
 */
function PasskeyCard({ store }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const supported = passkeySupported();

  const load = () => api.passkeys().then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const enable = async () => {
    const label = window.prompt('Name this device so you can recognise it (for example "My phone"):', 'My phone');
    if (label === null) return;
    setBusy(true);
    try {
      await enablePasskey(label.trim() || 'This device');
      store.toast('Fingerprint sign-in is on for this device');
      await load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove fingerprint sign-in for "${p.label}"? You can still sign in with your password.`)) return;
    try {
      await api.deletePasskey(p.id);
      if ((items ?? []).length <= 1) forgetPasskeyFlag();
      await load();
    } catch (e) {
      store.toast(e.message);
    }
  };

  return (
    <Card title="Fingerprint sign-in" subtitle="Sign in with your fingerprint (or face or screen lock) instead of typing your password">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(items ?? []).map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span style={{ fontSize: 11.5, color: '#6b7269' }}>
                Added {new Date(p.created_at).toLocaleDateString('en-KE')}
                {p.last_used_at ? ` · last used ${new Date(p.last_used_at).toLocaleDateString('en-KE')}` : ''}
              </span>
            </span>
            <Button size="sm" onClick={() => remove(p)}>Remove</Button>
          </div>
        ))}
        {supported ? (
          <Button variant="primary" onClick={enable} disabled={busy}>
            {busy ? 'Waiting for your fingerprint…' : (items ?? []).length ? 'Turn on for this device too' : 'Turn on for this device'}
          </Button>
        ) : (
          <span style={{ fontSize: 12.5, color: '#6b7269' }}>
            This browser or connection does not support fingerprint sign-in. It needs a secure (https) page and a device with a fingerprint or screen lock.
          </span>
        )}
      </div>
    </Card>
  );
}
