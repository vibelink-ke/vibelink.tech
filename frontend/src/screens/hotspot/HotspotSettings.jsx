import React, { useEffect, useState } from 'react';
import { color, font, radius } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Field, Input, Screen, Select, Toggle } from '../../ui/primitives';

/** Option sets come straight from the CHECK constraints in backend/schema.sql. */
const PAYMENT_METHODS = [
  { value: 'kopokopo', label: 'KopoKopo STK (hotspot only)' },
  { value: 'paybill', label: 'M-Pesa Paybill' },
  { value: 'bankstk', label: 'Bank STK push' },
  { value: 'till', label: 'Till / paybill without API' },
];
const EXPIRY = [
  { value: 'login', label: 'Expire after first login' },
  { value: 'creation', label: 'Expire from creation' },
];
const CODE_TYPES = [
  { value: 'numeric', label: 'Numeric' },
  { value: 'mixed', label: 'Mixed (no O/0/I/1)' },
  { value: 'words', label: 'Swahili word pairs' },
];

// Written as a constant because the newline is the separator the textarea
// uses, and an escaped one inside JSX is easy to mangle.
const NL = String.fromCharCode(10);

const DEFAULTS = {
  ssid: 'WiFi',
  redirect_url: '',
  trial_minutes: 15,
  idle_timeout_sec: 30,
  bind_mac: true,
  payment_method: 'kopokopo',
  voucher_expiry: 'login',
  code_type: 'numeric',
  code_length: 6,
  sms_voucher: true,
  auto_login: true,
  multi_device: false,
  template: 'sleek',
  banner_headline: '',
  banner_subtext: '',
  walled_garden: [],
  hotspot_network: '10.5.50.0/24',
};

export default function HotspotSettings() {
  const store = useStore();
  const [f, setF] = useState({ ...DEFAULTS, ...(store.hotspotSettings ?? {}) });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setF((cur) => {
      const next = { ...DEFAULTS, ...store.hotspotSettings, ...cur };
      // The textarea is the editable form of walled_garden; seed it once so the
      // operator sees the defaults rather than an empty box that saves as empty.
      if (next.walled_garden_text === undefined) {
        next.walled_garden_text = (next.walled_garden ?? []).join(NL);
      }
      return next;
    });
    // Only re-seed when the server payload arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hotspotSettings]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setBool = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    const len = Number(f.code_length);
    if (len < 4 || len > 12) return store.toast('Code length must be between 4 and 12');
    setBusy(true);
    try {
      const saved = await api.saveHotspotSettings({
        ...f,
        trial_minutes: Number(f.trial_minutes),
        idle_timeout_sec: Number(f.idle_timeout_sec),
        code_length: len,
        // Sent as an array; the textarea edits it a line at a time.
        walled_garden: String(f.walled_garden_text ?? '')
          .split(NL).map((x) => x.trim()).filter(Boolean),
      });
      store.setHotspotSettings(saved ?? f);
      store.toast('Hotspot settings saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      actions={
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </Button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, alignItems: 'start' }}>
        <Card title="General" subtitle="Captive portal basics">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="SSID">
              <Input value={f.ssid ?? ''} onChange={set('ssid')} />
            </Field>
            {/* What a guest reads at the top of the captive portal. Blank falls
                back to the company name and a plain instruction. */}
            <Field label="Portal look" hint="Colour scheme of the captive portal">
              <Select
                value={f.template ?? 'sleek'}
                onChange={set('template')}
                options={[
                  { value: 'sleek', label: 'Sleek — light, green' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'bold', label: 'Bold — coloured background' },
                  { value: 'plain', label: 'Plain — maximum contrast' },
                ]}
              />
            </Field>
            <Field label="Portal headline" hint="Shown large on the login page. Blank uses your company name">
              <Input value={f.banner_headline ?? ''} onChange={set('banner_headline')} placeholder={f.ssid || 'Your company'} />
            </Field>
            <Field label="Portal subtitle" hint="One line under it">
              <Input
                value={f.banner_subtext ?? ''}
                onChange={set('banner_subtext')}
                placeholder="Enter your voucher code to get online"
              />
            </Field>
            <Field label="Redirect after login" hint="Where the browser lands once connected">
              <Input value={f.redirect_url ?? ''} onChange={set('redirect_url')} placeholder="https://…" />
            </Field>
            <Field label="Free trial (minutes)">
              <Input type="number" value={f.trial_minutes ?? 0} onChange={set('trial_minutes')} />
            </Field>
            <Field label="Idle timeout (seconds)" hint="How long a guest can go quiet before the router drops them and frees the code for someone else">
              <Input type="number" value={f.idle_timeout_sec ?? 0} onChange={set('idle_timeout_sec')} />
            </Field>
            <Toggle checked={!!f.bind_mac} onChange={setBool('bind_mac')} label="Bind to MAC on first login" detail="Stops one code being shared around" />
          </div>
        </Card>

        <Card title="Preferences" subtitle="Mirrors hotspot_settings in the database">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Payment channel">
              <Select value={f.payment_method} onChange={set('payment_method')} options={PAYMENT_METHODS} />
            </Field>
            <Field label="Voucher expiry">
              <Select value={f.voucher_expiry} onChange={set('voucher_expiry')} options={EXPIRY} />
            </Field>
            <Field label="Code type">
              <Select value={f.code_type} onChange={set('code_type')} options={CODE_TYPES} />
            </Field>
            <Field label="Code length" hint="Between 4 and 12">
              <Input type="number" min={4} max={12} value={f.code_length ?? 6} onChange={set('code_length')} />
            </Field>
          </div>
        </Card>


        <Card title="Walled garden" subtitle="Reachable before anyone logs in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field
              label="Allowed hosts"
              hint="One per line. Wildcards allowed, e.g. *.safaricom.co.ke"
            >
              <textarea
                value={f.walled_garden_text ?? ''}
                onChange={(e) => setF((s) => ({ ...s, walled_garden_text: e.target.value }))}
                rows={6}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
                  border: `1px solid ${color.line}`, borderRadius: radius.md,
                  background: color.subtleBg, color: color.ink,
                  fontSize: 13, fontFamily: font.mono,
                  outline: 'none', resize: 'vertical',
                }}
              />
            </Field>
            <Field label="Hotspot LAN" hint="The subnet guests are given addresses from">
              <Input value={f.hotspot_network ?? ''} onChange={set('hotspot_network')} placeholder="10.5.50.0/24" />
            </Field>
            <span style={{ fontSize: 12.5, color: color.muted }}>
              Applied to the router the next time you configure it. A guest with no
              credit needs M-Pesa reachable to buy any — an empty list locks the
              shop from the inside.
            </span>
          </div>
        </Card>

        <Card title="Behaviour">
          <Toggle checked={!!f.sms_voucher} onChange={setBool('sms_voucher')} label="SMS the code after payment" detail="Uses the tenant's primary SMS gateway" />
          <Toggle checked={!!f.auto_login} onChange={setBool('auto_login')} label="Log the device in automatically" detail="Skips re-entering the code on the same device" />
          <Toggle checked={!!f.multi_device} onChange={setBool('multi_device')} label="Allow multiple devices per code" detail="Overrides the bundle's device limit" />
        </Card>
      </div>

      {f.payment_method === 'kopokopo' && (
        <div style={{ fontSize: 12.5, color: color.amberInk, background: '#fff9ec', border: '1px solid #ecd9a8', borderRadius: 8, padding: '10px 13px' }}>
          KopoKopo is hotspot-only. The database rejects it for PPPoE
          (constraint <code>kopokopo_hotspot_only</code>), and so does the payment adapter.
        </div>
      )}
    </Screen>
  );
}
