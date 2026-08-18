import React, { useEffect, useMemo, useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { useAction, ActionResult } from '../ui/action';
import { api } from '../api/client';
import { Button, Card, Field, Input, Screen, Select, Table, Tabs, Textarea } from '../ui/primitives';

// "By location" is absent on purpose: subscribers has no location column in
// schema.sql, so the server could not narrow the audience and would silently
// message everyone. Add the column first, then the option.
const AUDIENCES = ['All clients', 'By router', 'By package', 'Expiring soon', 'Expired'];
/** Shown until the server's list arrives, so the row is never empty. */
const FALLBACK_TAGS = ['{name}', '{account}', '{expires}', '{plan}', '{amount}', '{company}'];

/**
 * One shape for a tag, whatever it arrived as.
 *
 * The server sends `{ token, desc }` — the list in sms.js — and this screen was
 * reading `t.key`, which is undefined for every one of them. `t.key ?? t` then
 * fell through to the object itself, React was handed `{token, desc}` as a
 * child, and the whole app went blank with error #31. The strings in
 * FALLBACK_TAGS are also still accepted, because they are what shows before the
 * request comes back.
 *
 * Normalising here rather than at each use means a future third shape breaks
 * one function instead of a screen.
 */
const asTag = (t) => {
  if (typeof t === 'string') return { insert: t, label: t, hint: '' };
  const name = t?.token ?? t?.key ?? '';
  return {
    insert: `{${name}}`,
    label: `{${name}}`,
    hint: t?.desc ?? t?.describes ?? t?.detail ?? '',
  };
};

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

  /** History refreshes on the same 3s beat, but only while this tab is open. */
  useEffect(() => {
    if (tab !== 'history') return undefined;
    let stop = false;

    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const rows = await api.smsHistory();
        if (!stop) store.setCollection('smsHistory', rows);
      } catch {
        /* transient — the next tick will retry */
      }
    };

    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
    setSms((s) => ({ ...s, template: t, body: saved[t] ?? TEMPLATES[t] ?? s.body }));
  };

  const action = useAction();

  /**
   * Tags and saved wording come from the server.
   *
   * The templates were a constant in this file, so an ISP could not change what
   * their own customers receive without us shipping a release, and the tag list
   * existed only in a sentence of hint text.
   */
  const [tags, setTags] = useState([]);
  const [saved, setSaved] = useState({});
  useEffect(() => {
    api.smsTemplates()
      .then((d) => {
        setTags(d.placeholders ?? []);
        setSaved({ ...(d.defaults ?? {}), ...(d.templates ?? {}) });
      })
      .catch(() => {});
  }, []);

  const saveTemplate = async () => {
    try {
      await api.saveSmsTemplates({ ...saved, [sms.template]: sms.body });
      setSaved((v) => ({ ...v, [sms.template]: sms.body }));
      store.toast(`Saved the "${sms.template}" wording`);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
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
        // Its own dialog rather than a toast: a bulk send takes seconds against
        // the gateway, and an operator who sees nothing happening presses the
        // button again — which for SMS means paying for every message twice.
        await action.run('Sending to everyone selected', () => api.sendBulkSms({
          audience,
          routerId: sms.router || null,
          planId: sms.pkg || null,
          body: sms.body,
        }), {
          working: 'Handing the messages to your SMS gateway…',
          describe: (r) => `Queued for ${r.queued} recipient(s).`,
        });
      }
    } catch {
      // Bulk failures are shown in the dialog; only the single-send path needs
      // a toast, and it has already thrown by here.
    } finally {
      setBusy(false);
    }
  };

  /**
   * Test number is entered rather than hardcoded — the point of a test send is
   * that it reaches a handset you are holding. Remembered across reloads.
   */
  const [testPhone, setTestPhone] = useState(() => localStorage.getItem('smsTestPhone') ?? '');

  const testSms = async () => {
    const phone = testPhone.trim();
    if (!phone) return store.toast('Enter the number to send the test to');
    localStorage.setItem('smsTestPhone', phone);
    try {
      await api.sendTestSms(phone);
      store.toast(`Test SMS sent to ${phone} — check History for the gateway result`);
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

        <Field label="Message" hint="Click a tag below to insert it">
          <Textarea value={sms.body} onChange={set('body')} rows={5} />
        </Field>

        {/* The tags, visible and clickable. They were mentioned in a hint and
            listed nowhere, so an operator had to already know them to use them
            — and a mistyped tag sends the customer a literal {nmae}. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: color.muted }}>Insert:</span>
          {(tags.length ? tags : FALLBACK_TAGS).map(asTag).map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.hint}
              onClick={() => setSms((v) => ({ ...v, body: `${v.body}${t.insert}` }))}
              style={{
                font: 'inherit', fontSize: 12, fontFamily: font.mono, cursor: 'pointer',
                border: `1px solid ${color.line}`, borderRadius: 999,
                background: color.tileBg, color: color.inkSoft, padding: '3px 9px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* What each one means, on the page rather than in a tooltip nobody
            hovers. The tags only earn their keep if the operator knows which
            to reach for, and a hover hint is invisible on a phone. */}
        {tags.length > 0 && (
          <details style={{ fontSize: 12.5, color: color.muted }}>
            <summary style={{ cursor: 'pointer' }}>What each tag means</summary>
            <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
              {tags.map(asTag).map((t) => (
                <div key={t.label} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontFamily: font.mono, minWidth: 130, color: color.inkSoft }}>{t.label}</span>
                  <span>{t.hint}</span>
                </div>
              ))}
              <span style={{ marginTop: 6 }}>
                Each one is replaced with that customer's own value as the message is sent, so
                one sentence reaches everybody with their own name, account and dates in it. A
                tag with nothing behind it — no expiry set, no router — comes out empty rather
                than as braces.
              </span>
            </div>
          </details>
        )}

        {/* Saving the wording, so it is theirs rather than ours. */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={saveTemplate} disabled={busy}>
            Save as the "{sms.template}" template
          </Button>
          <span style={{ fontSize: 12, color: color.muted }}>
            Used automatically for {sms.template} messages from now on.
          </span>
        </div>

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

        {/* Only warn once we actually know — null means the check is still in flight. */}
        {store.smsCredits != null && !store.smsCredits.configured && (
          <div style={{ fontSize: 12.5, color: color.amberInk, background: '#fff9ec', border: '1px solid #ecd9a8', borderRadius: radius.md, padding: '10px 13px' }}>
            No SMS gateway is configured yet. Add credentials under Settings → SMS before sending.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : tab === 'single' ? 'Send message' : `Send to ${recipients.toLocaleString()}`}
          </Button>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="07xx xxx xxx"
              aria-label="Test number"
              style={{ width: 150, fontFamily: font.mono }}
            />
            <Button onClick={testSms}>Send test</Button>
          </span>
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

      <ActionResult state={action.state} onClose={action.dismiss} />
    </Screen>
  );
}
