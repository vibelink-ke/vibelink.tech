import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Empty, Grid, Input, Screen, Stat } from '../ui/primitives';

const CANNED = [
  'Thanks for reaching out — checking your line now.',
  'There is an outage at your site. Engineers are on it.',
  'Your account has expired. Pay via the paybill to reconnect.',
  'Please restart the router and tell me if the light turns green.',
];

function Bubble({ from, text, mine }) {
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
        {!mine && <span style={{ fontSize: 10.5, fontWeight: 600, color: color.muted }}>{from}</span>}
        <span>{text}</span>
      </div>
    </div>
  );
}

export default function LiveSupport() {
  const store = useStore();
  const [activeId, setActiveId] = useState(null);
  const [chats, setChats] = useState({}); // id -> [{from, text, mine}]
  const [draft, setDraft] = useState('');

  const queue = store.liveQueue ?? [];
  const waiting = queue.filter((c) => c.status === 'waiting');
  const active = queue.filter((c) => c.status === 'active');
  const current = queue.find((c) => c.id === activeId);
  const thread = chats[activeId] ?? [];

  const accept = async (c) => {
    try {
      await api.acceptChat(c.id, null);
      store.setCollection('liveQueue', (q) => q.map((x) => (x.id === c.id ? { ...x, status: 'active' } : x)));
      setActiveId(c.id);
      store.toast(`Chat with ${c.visitor_ref} accepted`);
    } catch (e) {
      store.toast(`Could not accept: ${e.message}`);
    }
  };

  /** Turn a chat into a ticket so it survives the agent closing the window. */
  const escalate = async (chat) => {
    const firstFromVisitor = (chats[chat.id] ?? []).find((m) => !m.mine)?.text;
    const subject = firstFromVisitor ?? `Live chat with ${chat.visitor_ref}`;
    try {
      const ticket = await api.createTicket({ subject: subject.slice(0, 120), priority: 'high' });
      store.setCollection('tickets', (ts) => [ticket, ...ts]);
      store.toast(`Escalated to ${ticket.number}`);
    } catch (e) {
      store.toast(`Could not escalate: ${e.message}`);
    }
  };

  const send = () => {
    if (!draft.trim() || !activeId) return;
    setChats((c) => ({ ...c, [activeId]: [...(c[activeId] ?? []), { from: 'You', text: draft, mine: true }] }));
    setDraft('');
  };

  return (
    <Screen
      title="Live support"
      subtitle="Chats started by clients from the portal. The client's view is on the right, so you can see exactly what they see."
    >
      <Grid min={200} gap={14}>
        <Stat label="Waiting" value={waiting.length} tone={waiting.length ? color.amberInk : undefined} hint={waiting.length ? 'needs an agent' : 'queue clear'} />
        <Stat label="Active" value={active.length} hint="being handled" />
        <Stat label="Escalated today" value={0} hint="raised to a ticket" />
        <Stat label="Avg. wait" value="—" hint="no data yet" />
      </Grid>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <Card title="Queue" subtitle={`${queue.length} open`}>
          {queue.length === 0 ? (
            <Empty>Nobody is waiting</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {queue.map((c) => (
                <div
                  key={c.id}
                  onClick={() => (c.status === 'waiting' ? accept(c) : setActiveId(c.id))}
                  style={{
                    padding: '9px 11px',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    border: `1px solid ${c.id === activeId ? color.green : color.line}`,
                    background: c.id === activeId ? '#f4faf7' : '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.visitor_ref}</span>
                  <span style={{ fontSize: 11.5, color: color.muted }}>
                    {c.status === 'waiting' ? 'Waiting — click to accept' : 'Active'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={current ? `Chat · ${current.visitor_ref}` : 'Chat'}
          actions={
            current && (
              <>
                <Button size="sm" onClick={() => escalate(current)}>Escalate</Button>
                <Button
                  size="sm"
                  onClick={() => {
                    store.setCollection('liveQueue', (q) => q.filter((x) => x.id !== current.id));
                    setActiveId(null);
                    store.toast('Chat closed');
                  }}
                >
                  Close
                </Button>
              </>
            )
          }
        >
          {!current ? (
            <Empty>Pick a conversation from the queue</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  minHeight: 240,
                  maxHeight: 380,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 4,
                }}
              >
                {thread.length === 0 ? (
                  <span style={{ fontSize: 12.5, color: color.muted, textAlign: 'center', padding: '30px 0' }}>
                    No messages yet — say hello
                  </span>
                ) : (
                  thread.map((m, i) => <Bubble key={i} {...m} />)
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CANNED.map((t) => (
                  <span
                    key={t}
                    onClick={() => setDraft(t)}
                    style={{
                      fontSize: 11.5,
                      padding: '4px 9px',
                      borderRadius: radius.pill,
                      background: color.tileBg,
                      color: color.neutralInk,
                      cursor: 'pointer',
                    }}
                  >
                    {t.slice(0, 34)}…
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Type a reply…"
                />
                <Button variant="primary" onClick={send}>
                  Send
                </Button>
              </div>
              <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>
                Replies are local — POST /api/messages with channel=live_chat to persist them.
              </span>
            </div>
          )}
        </Card>
      </div>
    </Screen>
  );
}
