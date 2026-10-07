import React, { useEffect, useState } from 'react';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Field, Input, Modal, Select } from '../ui/primitives';

const DURATIONS = [30, 45, 60, 90, 120, 180, 240, 360].map((m) => ({ value: String(m), label: m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${Math.floor(m / 60)}h ${m % 60}m` }));

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeLabel = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Book (or move) a technician's visit to a ticket: a date, a start time, how long it should take, and who goes. The
 * customer is texted the booking straight away (and again a few hours before). If the technician already has something
 * in that slot the office is told and chooses whether to double-book.
 *
 * `ticket` is the job being booked, or null to pick one from the open jobs with no visit yet. `day` pre-fills the date.
 */
export default function BookVisit({ open, ticket, day, onClose, onSaved }) {
  const store = useStore();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  const staff = store.staff ?? [];
  const openJobs = (store.tickets ?? []).filter((t) => t.status !== 'resolved');

  useEffect(() => {
    if (!open) { setF(null); return; }
    const at = ticket?.scheduled_at ? new Date(ticket.scheduled_at) : null;
    const base = at ?? (day ? new Date(day) : new Date());
    setF({
      ticketId: ticket?.id ?? '',
      date: dateKey(base),
      time: at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '09:00',
      minutes: String(ticket?.scheduled_minutes ?? 60),
      assignedTo: ticket?.assigned_to ?? '',
      notify: true,
    });
  }, [open, ticket?.id, day]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !f) return null;
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const job = ticket ?? openJobs.find((t) => t.id === f.ticketId);

  const save = async (force = false) => {
    if (!f.ticketId) return store.toast('Pick the job to book');
    if (!f.date || !f.time) return store.toast('Pick a date and a time');
    setBusy(true);
    try {
      const out = await api.scheduleTicket(f.ticketId, {
        at: new Date(`${f.date}T${f.time}`).toISOString(), minutes: Number(f.minutes),
        assignedTo: f.assignedTo || undefined, notify: f.notify, force,
      });
      store.setCollection('tickets', (ts) => ts.map((x) => (x.id === out.id ? { ...x, ...out } : x)));
      store.toast(out.notified ? 'Visit booked and the customer has been texted' : 'Visit booked');
      onSaved?.(out);
      onClose();
    } catch (e) {
      if (e.status === 409 && e.body?.conflicts?.length) {
        const c = e.body.conflicts.map((x) => `${x.number} at ${timeLabel(x.scheduled_at)}`).join(', ');
        if (window.confirm(`That technician already has ${c} around then. Book it anyway?`)) { setBusy(false); return save(true); }
      } else {
        store.toast(`Could not book: ${e.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={ticket?.scheduled_at ? `Move the visit — ${ticket.number}` : ticket ? `Book a visit — ${ticket.number}` : 'Book a visit'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save(false)} disabled={busy}>{busy ? 'Booking…' : 'Book visit'}</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {!ticket && (
          <Field label="Job" span={2}>
            <Select
              value={f.ticketId}
              onChange={(e) => {
                const t = openJobs.find((x) => x.id === e.target.value);
                setF((s) => ({ ...s, ticketId: e.target.value, assignedTo: t?.assigned_to ?? s.assignedTo }));
              }}
              options={[{ value: '', label: 'Choose a job…' }, ...openJobs.map((t) => ({
                value: t.id,
                label: `${t.number} · ${t.kind === 'install' ? 'Install' : 'Repair'} · ${t.subscriber_name ?? t.subject}${t.scheduled_at ? ' (already booked)' : ''}`,
              }))]}
            />
          </Field>
        )}
        {job && (
          <div style={{ gridColumn: '1 / -1', fontSize: 13, color: color.neutralInk }}>
            <b>{job.subject}</b>
            {job.subscriber_name ? ` · ${job.subscriber_name}` : ''}{job.subscriber_location ? ` · ${job.subscriber_location}` : ''}
          </div>
        )}
        <Field label="Date"><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Start time"><Input type="time" value={f.time} onChange={set('time')} /></Field>
        <Field label="How long"><Select value={f.minutes} onChange={set('minutes')} options={DURATIONS} /></Field>
        <Field label="Technician">
          <Select
            value={f.assignedTo}
            onChange={set('assignedTo')}
            options={[{ value: '', label: 'Keep as is' }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </Field>
        <label style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
          <input type="checkbox" checked={f.notify} onChange={(e) => setF((s) => ({ ...s, notify: e.target.checked }))} />
          Text the customer the booking now, and again a few hours before
        </label>
      </div>
    </Modal>
  );
}
