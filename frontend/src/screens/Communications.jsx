import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Empty, Input, Screen, Textarea } from '../ui/primitives';

function Bubble({ text, channel, mine, at }) {
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '76%',
          background: mine ? color.green : color.tileBg,
          color: mine ? '#fff' : color.ink,
          borderRadius: 12,
          padding: '8px 11px',
          fontSize: 13,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
        <span style={{ fontSize: 10, color: mine ? 'rgba(255,255,255,.75)' : color.muted, alignSelf: 'flex-end' }}>
          {channel} · {new Date(at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

/**
 * Every SMS/WhatsApp exchange with a customer already lands in the
 * `messages` table (see Messaging's "Send message" button and the
 * automated reminders/receipts), but nothing ever showed it back as a
 * conversation — a staff member had no way to see what a customer had
 * already been told before calling them. This is that view: an inbox of
 * every subscriber with history, newest first, with the full thread and a
 * reply box once you open one.
 */
export default function Communications() {
  const store = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState(null);
  const [activeId, setActiveId] = useState(searchParams.get('client'));
  const [thread, setThread] = useState(null);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = () => api.conversations().then(setConversations).catch(() => setConversations([]));
  useEffect(() => { load(); }, []);

  // A client opened from search/elsewhere with no message history yet still
  // needs a row to select — otherwise the thread panel has nothing to attach
  // the reply box to.
  const client = store.clients.find((c) => c.id === activeId);
  const rows = useMemo(() => {
    const known = new Set((conversations ?? []).map((c) => c.subscriber_id));
    const extra = client && !known.has(client.id)
      ? [{ subscriber_id: client.id, name: client.name, account_code: client.account_code, phone: client.phone, service: client.service, last_body: null, last_sent_at: null }]
      : [];
    const all = [...extra, ...(conversations ?? [])];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((c) =>
      c.name?.toLowerCase().includes(needle) ||
      c.account_code?.toLowerCase().includes(needle) ||
      c.phone?.includes(needle));
  }, [conversations, q, client]);

  const openThread = (id) => {
    setActiveId(id);
    setSearchParams({ client: id });
    setThread(null);
    api.messages(id).then(setThread).catch(() => setThread([]));
  };

  useEffect(() => {
    if (activeId) api.messages(activeId).then(setThread).catch(() => setThread([]));
  }, [activeId]);

  const reply = async () => {
    if (!draft.trim() || !activeId) return;
    setSending(true);
    try {
      const m = await api.sendMessage({ subscriberId: activeId, body: draft.trim(), channel: 'sms' });
      setThread((t) => [...(t ?? []), m]);
      setDraft('');
      load();
    } catch (e) {
      store.toast(`Could not send: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen title="Communications" subtitle="Every SMS and WhatsApp conversation with a customer, in one place.">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 300px) 1fr',
          gap: 14,
          height: 'calc(100vh - 190px)',
          minHeight: 420,
        }}
      >
        <div
          style={{
            background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg,
            display: 'flex', flexDirection: 'column', minHeight: 0,
          }}
        >
          <div style={{ padding: 10, borderBottom: `1px solid ${color.line}` }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, account or phone…" />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {conversations === null ? (
              <div style={{ padding: 16, fontSize: 13, color: color.muted }}>Loading…</div>
            ) : rows.length === 0 ? (
              <Empty>No conversations yet — message history from Messaging or an automated SMS will show up here.</Empty>
            ) : (
              rows.map((c) => (
                <div
                  key={c.subscriber_id}
                  onClick={() => openThread(c.subscriber_id)}
                  style={{
                    padding: '10px 12px',
                    borderBottom: `1px solid ${color.line}`,
                    cursor: 'pointer',
                    background: c.subscriber_id === activeId ? color.subtleBg : 'transparent',
                    display: 'flex', flexDirection: 'column', gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </span>
                    {c.last_sent_at && (
                      <span style={{ fontSize: 10.5, color: color.muted, flex: '0 0 auto' }}>
                        {new Date(c.last_sent_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>
                    {c.account_code} · {c.phone}
                  </span>
                  {c.last_body && (
                    <span style={{ fontSize: 12, color: color.neutralInk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.last_direction === 'out' ? 'You: ' : ''}{c.last_body}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div
          style={{
            background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg,
            display: 'flex', flexDirection: 'column', minHeight: 0,
          }}
        >
          {!activeId ? (
            <Empty>Pick a conversation on the left to see the full message history.</Empty>
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${color.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{client?.name ?? rows.find((r) => r.subscriber_id === activeId)?.name}</span>
                  <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>
                    {client?.account_code ?? rows.find((r) => r.subscriber_id === activeId)?.account_code} · {client?.phone ?? rows.find((r) => r.subscriber_id === activeId)?.phone}
                  </span>
                </div>
                {client && <Badge tone={client.status}>{client.status}</Badge>}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {thread === null ? (
                  <span style={{ fontSize: 13, color: color.muted }}>Loading…</span>
                ) : thread.length === 0 ? (
                  <span style={{ fontSize: 13, color: color.muted }}>No messages with this customer yet.</span>
                ) : (
                  thread.map((m) => (
                    <Bubble key={m.id} text={m.body} channel={m.channel} mine={m.direction === 'out'} at={m.sent_at} />
                  ))
                )}
              </div>

              <div style={{ padding: 12, borderTop: `1px solid ${color.line}`, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a message — sends as SMS…"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(); }
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={reply}
                  disabled={sending || !draft.trim()}
                  style={{
                    background: color.green, color: '#fff', border: 'none', borderRadius: radius.md,
                    padding: '10px 16px', fontSize: 13, fontWeight: 600,
                    cursor: sending || !draft.trim() ? 'default' : 'pointer',
                    opacity: sending || !draft.trim() ? 0.6 : 1,
                  }}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}
