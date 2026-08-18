import React, { useEffect, useState } from 'react';
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
  const ticketsToday = (store.tickets ?? []).filter((t) => {
    const at = t.created_at ? new Date(t.created_at) : null;
    return at && at.toDateString() === new Date().toDateString();
  }).length;

  // The oldest unanswered conversation, not an average: an average of two
  // chats is meaningless, and what an agent needs to know is whether anybody
  // has been left waiting.
  const waitMinutes = waiting.reduce((worst, c) => {
    const started = c.started_at ? new Date(c.started_at) : null;
    if (!started) return worst;
    return Math.max(worst, Math.round((Date.now() - started) / 60000));
  }, 0);
  const longestWait = waiting.length ? `${waitMinutes}m` : '—';

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

  /**
   * Load the conversation and keep it current.
   *
   * The thread lived only in this component's state, so a reply went nowhere
   * and reopening a chat showed an empty window — the visitor was talking to
   * something that recorded nothing.
   *
   * Three seconds, and only for the chat on screen. Polling the whole queue
   * would grow with the number of conversations while an agent reads one.
   */
  useEffect(() => {
    if (!activeId) return undefined;
    let live = true;

    const pull = async () => {
      try {
        const { messages } = await api.chatMessages(activeId, 0);
        if (!live) return;
        setChats((c) => ({
          ...c,
          [activeId]: messages.map((m) => ({
            id: m.id,
            from: m.sender === 'staff' ? 'You' : 'Client',
            text: m.body,
            mine: m.sender === 'staff',
          })),
        }));
      } catch { /* a dropped poll is not the end of the conversation */ }
    };

    pull();
    const id = setInterval(pull, 3000);
    return () => { live = false; clearInterval(id); };
  }, [activeId]);

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

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId) return;

    // Shown immediately, then confirmed by the next poll. Waiting for the round
    // trip makes the agent wonder whether the send worked and type it again.
    setChats((c) => ({ ...c, [activeId]: [...(c[activeId] ?? []), { from: 'You', text: body, mine: true }] }));
    setDraft('');
    try {
      await api.sendChatReply(activeId, body);
      store.setCollection('liveQueue', (q) =>
        q.map((x) => (x.id === activeId ? { ...x, status: 'active' } : x)));
    } catch (e) {
      store.toast(`Not sent: ${e.message}`);
    }
  };

  /** End the conversation, for the visitor as well as here. */
  const closeChat = async () => {
    if (!activeId) return;
    try {
      await api.closeChat(activeId);
      store.setCollection('liveQueue', (q) => q.filter((x) => x.id !== activeId));
      setActiveId(null);
      store.toast('Chat closed');
    } catch (e) {
      store.toast(`Could not close: ${e.message}`);
    }
  };

  return (
    <Screen
      title="Live support"
      subtitle="Chats started by clients from the portal. The client's view is on the right, so you can see exactly what they see."
    >
      <Grid min={200} gap={14}>
        <Stat label="Waiting" value={waiting.length} tone={waiting.length ? color.amberInk : undefined} hint={waiting.length ? 'needs an agent' : 'queue clear'} />
        <Stat label="Active" value={active.length} hint="being handled" />
        {/* Both were fixed values. Tickets raised today is a real count; the
            wait is measured from when each waiting visitor arrived, which is the
            number an agent needs to know whether anyone is being left. */}
        <Stat label="Tickets today" value={ticketsToday} hint="raised by support" />
        <Stat
          label="Longest wait"
          value={longestWait}
          tone={waitMinutes > 5 ? color.amberInk : undefined}
          hint={waiting.length ? 'someone is waiting' : 'nobody waiting'}
        />
      </Grid>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <Card title="Queue" subtitle={`${queue.length} open`}>
          {/* An empty page with one word on it reads as broken. Say where
              conversations come from, so an operator knows whether to wait or
              to go and turn something on. */}
          {queue.length === 0 ? (
            <div style={{ display: 'grid', gap: 6, padding: '6px 2px' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Nobody is waiting</span>
              <span style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.5 }}>
                Chats start when a customer presses <strong>Chat with support</strong> on their
                portal, or a guest presses <strong>Talk to support</strong> on the hotspot login
                page. They appear here the moment they do — this list refreshes on its own.
              </span>
            </div>
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
                {/* Closes it on the server too. This only dropped the row from
                    the agent's own list, so the visitor sat waiting for a reply
                    from somebody who believed the conversation was over. */}
                <Button size="sm" onClick={closeChat}>Close</Button>
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
