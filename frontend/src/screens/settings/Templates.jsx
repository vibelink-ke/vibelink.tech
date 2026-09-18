import React, { useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Button, Card, Field, Textarea } from '../../ui/primitives';

/**
 * Wording for every system-triggered SMS and email this app sends, editable
 * per tenant.
 *
 * Both backends (sms.js, email.js) already had a real DEFAULTS/PLACEHOLDERS/
 * override mechanism — an ISP's own paybill number or expiry date has been
 * fillable in these messages since that shipped. What was missing was
 * anywhere to actually see and change the wording itself: SMS templates
 * only surfaced piecemeal, two of nine, through the Messaging screen's
 * composer presets, and email templates had no editor of any kind at all,
 * so every tenant's password-reset and invite mail read exactly the same
 * regardless of whose brand it claimed to be from.
 */

const SMS_LABELS = {
  receipt: { label: 'Payment receipt', hint: 'Sent right after a payment is applied' },
  voucher: { label: 'Hotspot voucher code', hint: 'Sent when a hotspot bundle is bought' },
  reminder: { label: 'Expiry reminder', hint: 'Sent before a subscription runs out' },
  partial: { label: 'Partial payment received', hint: "Sent when a payment doesn't cover the full amount owed" },
  outage: { label: 'Outage notice', hint: 'Sent to affected clients when an outage is logged' },
  brief: { label: 'Daily summary', hint: 'Sent to staff, not customers — the daily automation digest' },
  welcome: { label: 'New customer welcome', hint: 'Sent once, when a client is first created' },
  chat_offline: { label: 'Live chat — nobody online', hint: "Sent when a visitor starts a chat outside business hours" },
  custom: {
    label: 'One-off / bulk messages',
    hint: 'The wrapper every free-text send (Messaging screen, single message) goes through — {body} is replaced with whatever was typed there. Leave this as-is unless you want to add something to every one-off message.',
  },
};

const EMAIL_LABELS = {
  password_reset: { label: 'Password reset', hint: 'Sent to a staff member who asked to reset their password' },
  magic_link: { label: 'Sign-in link', hint: 'Sent to a staff member who asked to sign in by email link' },
  customer_credentials: { label: 'Customer portal login details', hint: "Sent when a customer's portal password is (re)generated" },
  staff_invite: { label: "New staff member's invite", hint: 'Sent once, when a staff member is added' },
};

/** One editable SMS template: a single textarea, defaulting to the built-in wording. */
function SmsRow({ tkey, meta, value, onChange, onReset, isOverridden }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 16, borderBottom: `1px solid ${color.line}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{meta?.label ?? tkey}</span>
        {isOverridden && (
          <span onClick={onReset} style={{ fontSize: 11.5, color: color.green, cursor: 'pointer', fontWeight: 600 }}>
            Reset to default
          </span>
        )}
      </div>
      {meta?.hint && <span style={{ fontSize: 11.5, color: color.muted }}>{meta.hint}</span>}
      <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: font.mono, fontSize: 12.5 }} />
    </div>
  );
}

/** One editable email template: subject + body, same reset affordance. */
function EmailRow({ tkey, meta, value, onChange, onReset, isOverridden }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 16, borderBottom: `1px solid ${color.line}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{meta?.label ?? tkey}</span>
        {isOverridden && (
          <span onClick={onReset} style={{ fontSize: 11.5, color: color.green, cursor: 'pointer', fontWeight: 600 }}>
            Reset to default
          </span>
        )}
      </div>
      {meta?.hint && <span style={{ fontSize: 11.5, color: color.muted }}>{meta.hint}</span>}
      <input
        value={value.subject}
        onChange={(e) => onChange({ ...value, subject: e.target.value })}
        placeholder="Subject"
        style={{
          padding: '7px 10px', border: `1px solid ${color.line}`, borderRadius: 8,
          fontSize: 12.5, fontFamily: font.mono, background: color.subtleBg, color: color.ink,
        }}
      />
      <Textarea rows={3} value={value.body} onChange={(e) => onChange({ ...value, body: e.target.value })} style={{ fontFamily: font.mono, fontSize: 12.5 }} />
    </div>
  );
}

export default function Templates() {
  const store = useStore();

  const [smsDefaults, setSmsDefaults] = useState(null);
  const [smsPlaceholders, setSmsPlaceholders] = useState([]);
  const [sms, setSms] = useState({});
  const [smsBusy, setSmsBusy] = useState(false);

  const [emailDefaults, setEmailDefaults] = useState(null);
  const [emailPlaceholders, setEmailPlaceholders] = useState([]);
  const [emails, setEmails] = useState({});
  const [emailBusy, setEmailBusy] = useState(false);

  useEffect(() => {
    api.smsTemplates()
      .then((d) => {
        setSmsDefaults(d.defaults ?? {});
        setSmsPlaceholders(d.placeholders ?? []);
        setSms({ ...(d.defaults ?? {}), ...(d.templates ?? {}) });
      })
      .catch((e) => store.toast(`Could not load SMS templates: ${e.message}`));
    api.emailTemplates()
      .then((d) => {
        setEmailDefaults(d.defaults ?? {});
        setEmailPlaceholders(d.placeholders ?? []);
        const merged = {};
        for (const k of Object.keys(d.defaults ?? {})) {
          merged[k] = { ...d.defaults[k], ...(d.templates?.[k] ?? {}) };
        }
        setEmails(merged);
      })
      .catch((e) => store.toast(`Could not load email templates: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSms = async () => {
    setSmsBusy(true);
    try {
      // Only send what actually differs from the built-in wording — an
      // untouched key should keep tracking the default if it ever changes,
      // not freeze at whatever it happened to equal on the day it was saved.
      const overrides = {};
      for (const k of Object.keys(sms)) {
        if (sms[k] !== smsDefaults[k]) overrides[k] = sms[k];
      }
      await api.saveSmsTemplates(overrides);
      store.toast('SMS templates saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setSmsBusy(false);
    }
  };

  const saveEmails = async () => {
    setEmailBusy(true);
    try {
      const overrides = {};
      for (const k of Object.keys(emails)) {
        const d = emailDefaults[k];
        if (emails[k].subject !== d.subject || emails[k].body !== d.body) overrides[k] = emails[k];
      }
      await api.saveEmailTemplates(overrides);
      store.toast('Email templates saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setEmailBusy(false);
    }
  };

  const missingLink = Object.entries(emails).filter(([k, v]) => k !== 'customer_credentials' && !v.body.includes('{link}'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card
        title="SMS templates"
        subtitle="What each automatic text actually says — the tags below fill in per recipient"
        actions={<Button variant="primary" onClick={saveSms} disabled={smsBusy || !smsDefaults}>{smsBusy ? 'Saving…' : 'Save SMS templates'}</Button>}
      >
        {!smsDefaults ? (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {Object.keys(smsDefaults).map((k) => (
              <SmsRow
                key={k}
                tkey={k}
                meta={SMS_LABELS[k]}
                value={sms[k] ?? ''}
                isOverridden={sms[k] !== smsDefaults[k]}
                onChange={(v) => setSms((s) => ({ ...s, [k]: v }))}
                onReset={() => setSms((s) => ({ ...s, [k]: smsDefaults[k] }))}
              />
            ))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              {smsPlaceholders.map((p) => (
                <span key={p.token} title={p.desc} style={{ fontSize: 11.5, fontFamily: font.mono, color: color.neutralInk }}>
                  {`{${p.token}}`}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Email templates"
        subtitle="Subject and body for the four system emails this app sends"
        actions={<Button variant="primary" onClick={saveEmails} disabled={emailBusy || !emailDefaults}>{emailBusy ? 'Saving…' : 'Save email templates'}</Button>}
      >
        {!emailDefaults ? (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {missingLink.length > 0 && (
              <div style={{ fontSize: 12, color: color.amberInk, background: color.amberBg, borderRadius: 8, padding: '9px 12px' }}>
                {missingLink.map(([k]) => EMAIL_LABELS[k]?.label ?? k).join(', ')} — the body has no {'{link}'}, so the recipient will have nothing to click.
              </div>
            )}
            {Object.keys(emailDefaults).map((k) => (
              <EmailRow
                key={k}
                tkey={k}
                meta={EMAIL_LABELS[k]}
                value={emails[k] ?? { subject: '', body: '' }}
                isOverridden={emails[k] && (emails[k].subject !== emailDefaults[k].subject || emails[k].body !== emailDefaults[k].body)}
                onChange={(v) => setEmails((s) => ({ ...s, [k]: v }))}
                onReset={() => setEmails((s) => ({ ...s, [k]: emailDefaults[k] }))}
              />
            ))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              {emailPlaceholders.map((p) => (
                <span key={p.token} title={p.desc} style={{ fontSize: 11.5, fontFamily: font.mono, color: color.neutralInk }}>
                  {`{${p.token}}`}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
