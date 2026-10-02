import React, { useMemo, useState } from 'react';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge } from '../ui/primitives';

const STAGE_COLOUR = { new: color.muted, contacted: color.amberInk, won: color.green, lost: color.rust };
// Same mapping as Leads.jsx's own stageTone — kept in sync so a lead reads the same colour wherever it shows.
const stageTone = (s) =>
  s === 'won' ? { bg: '#e2ebe5', fg: color.green }
    : s === 'lost' ? { bg: color.rustBg, fg: color.rust }
    : s === 'contacted' ? { bg: color.amberBg, fg: color.amberInk }
    : { bg: color.tileBg, fg: color.neutralInk };

/**
 * A mobile-first work queue for field sales — the same idea as FieldTech.jsx's
 * "My jobs" for technicians, but for the leads assigned to a sales rep instead
 * of the tickets assigned to one: the address, one tap to call, one tap to
 * navigate, one tap to move the lead along, and a way to log a brand-new
 * walk-up prospect right there instead of writing it down for later.
 *
 * Converting a won lead into an actual client sign-up is deliberately not
 * here — that stays a Clients screen action, not a field-app one, at least
 * for this first cut.
 */
export default function FieldSales() {
  const store = useStore();
  const [busyId, setBusyId] = useState(null);
  const [noteFor, setNoteFor] = useState(null);   // lead id whose note box is open
  const [noteText, setNoteText] = useState('');
  const [adding, setAdding] = useState(false);
  const [newLead, setNewLead] = useState({ name: '', phone: '' });

  const mine = useMemo(() => {
    const myId = store.session?.id;
    return (store.leads ?? [])
      .filter((l) => l.assigned_to === myId && l.status !== 'won' && l.status !== 'lost')
      .sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
  }, [store.leads, store.session]);

  const setStatus = async (l, status) => {
    setBusyId(l.id);
    try {
      const updated = await api.updateLead(l.id, { status });
      store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? updated : x)));
      store.toast(`${l.name} marked ${status}`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const saveNote = async (l) => {
    if (!noteText.trim()) return;
    setBusyId(l.id);
    try {
      await api.addLeadNote(l.id, noteText.trim());
      store.toast('Note added');
      setNoteFor(null);
      setNoteText('');
    } catch (e) {
      store.toast(`Could not save note: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  // Best-effort: a prospect without a fixed address is exactly who this is for,
  // so a denied or unavailable location must never block logging them.
  const currentPosition = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 6000 },
    );
  });

  const createLead = async () => {
    if (!newLead.name.trim()) return store.toast('Enter a name first');
    // The database needs a phone for every lead, so it is asked for rather than offered as optional.
    if (newLead.phone.replace(/[^0-9]/g, '').length < 9) return store.toast('Enter a phone number we can reach them on');
    setAdding(true);
    try {
      const pos = await currentPosition();
      const created = await api.createLead({
        name: newLead.name.trim(),
        phone: newLead.phone.trim(),
        source: 'field visit',
        assignedTo: store.session?.id,
        ...(pos ?? {}),
      });
      store.setCollection('leads', (ls) => [created, ...ls]);
      store.toast(`${created.name} added`);
      setNewLead({ name: '', phone: '' });
    } catch (e) {
      store.toast(`Could not add lead: ${e.message}`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>New prospect</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={newLead.name}
            onChange={(e) => setNewLead((s) => ({ ...s, name: e.target.value }))}
            placeholder="Name"
            style={inputStyle}
          />
          <input
            value={newLead.phone}
            onChange={(e) => setNewLead((s) => ({ ...s, phone: e.target.value }))}
            placeholder="Phone"
            style={inputStyle}
          />
          <button type="button" onClick={createLead} disabled={adding} style={{ ...btnStyle, background: color.green, color: '#fff', border: 'none', fontWeight: 700 }}>
            {adding ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>

      {mine.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: color.muted, fontSize: 13 }}>
          Nothing assigned to you right now.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {mine.map((l) => (
            <div
              key={l.id}
              style={{
                background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg,
                padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{l.name}</span>
                  <span style={{ fontSize: 12.5, color: color.muted }}>{l.phone || 'No phone on file'}</span>
                </div>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto' }}>
                  <span style={{ width: 8, height: 8, borderRadius: radius.pill, background: STAGE_COLOUR[l.status] ?? color.muted }} />
                  <Badge tone={stageTone(l.status)}>{l.status}</Badge>
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {l.phone && (
                  <a href={`tel:${l.phone}`} style={{ ...btnStyle, background: color.tileBg, color: color.ink }}>
                    Call {l.phone}
                  </a>
                )}
                {l.lat != null && l.lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${l.lat},${l.lng}`}
                    target="_blank" rel="noreferrer"
                    style={{ ...btnStyle, background: color.tileBg, color: color.ink }}
                  >
                    Navigate
                  </a>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {l.status !== 'contacted' && (
                  <button type="button" disabled={busyId === l.id} onClick={() => setStatus(l, 'contacted')}
                    style={{ ...btnStyle, flex: 1, background: color.amber, color: '#3a2c05', border: 'none', fontWeight: 700 }}>
                    Contacted
                  </button>
                )}
                <button type="button" disabled={busyId === l.id} onClick={() => setStatus(l, 'won')}
                  style={{ ...btnStyle, flex: 1, background: color.green, color: '#fff', border: 'none', fontWeight: 700 }}>
                  Won
                </button>
                <button type="button" disabled={busyId === l.id} onClick={() => setStatus(l, 'lost')}
                  style={{ ...btnStyle, flex: 1, background: color.rustBg, color: color.rust, border: 'none', fontWeight: 700 }}>
                  Lost
                </button>
              </div>

              {noteFor === l.id ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    autoFocus
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="What happened?"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="button" disabled={busyId === l.id} onClick={() => saveNote(l)}
                    style={{ ...btnStyle, background: color.tileBg, color: color.ink }}>
                    Save
                  </button>
                </div>
              ) : (
                <span onClick={() => { setNoteFor(l.id); setNoteText(''); }} style={{ fontSize: 12.5, color: color.green, fontWeight: 600, cursor: 'pointer' }}>
                  + Add note
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '10px 14px', borderRadius: radius.md, fontSize: 13.5, fontWeight: 600,
  textDecoration: 'none', border: `1px solid ${color.line}`, cursor: 'pointer',
};

const inputStyle = {
  flex: '1 1 140px', padding: '10px 12px', borderRadius: radius.md, fontSize: 13.5,
  border: `1px solid ${color.line}`, background: '#fff', color: color.ink,
};
