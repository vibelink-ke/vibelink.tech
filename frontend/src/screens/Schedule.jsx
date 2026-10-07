import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Empty, Screen, Select } from '../ui/primitives';
import BookVisit, { timeLabel } from './BookVisit';

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayName = (d) => d.toLocaleDateString('en-KE', { weekday: 'short' });

/**
 * The technicians' calendar: a week at a time, one column per day, every booked visit in time order with who is going,
 * who it is for and where. Jobs with no visit yet wait in a list beside it. Booking, moving and cancelling a visit
 * needs the "manage the schedule" permission; everyone with access to the page can see it (a technician sees their own).
 */
export default function Schedule() {
  const store = useStore();
  const navigate = useNavigate();
  const canManage = !!store.session?.perms?.['schedule.manage'];
  const staff = store.staff ?? [];

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [visits, setVisits] = useState(null);
  const [tech, setTech] = useState('');
  const [booking, setBooking] = useState(null);   // { ticket?, day? } while the booking window is open

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    try {
      setVisits(await api.schedule(dateKey(weekStart), dateKey(addDays(weekStart, 7))));
    } catch (e) {
      store.toast(`Could not load the schedule: ${e.message}`);
      setVisits([]);
    }
  }, [weekStart]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setVisits(null); load(); }, [load]);

  const unscheduled = (store.tickets ?? []).filter((t) => t.status !== 'resolved' && !t.scheduled_at)
    .sort((a, b) => (a.kind === 'install' ? 0 : 1) - (b.kind === 'install' ? 0 : 1));

  const shown = (visits ?? []).filter((v) => !tech || v.assigned_to === tech);
  const byDay = new Map(days.map((d) => [dateKey(d), []]));
  for (const v of shown) byDay.get(dateKey(new Date(v.scheduled_at)))?.push(v);
  const todayKey = dateKey(new Date());

  const cancel = async (v) => {
    if (!window.confirm(`Cancel the visit for ${v.number}? The job stays open, just not booked.`)) return;
    try {
      await api.unscheduleTicket(v.id);
      store.setCollection('tickets', (ts) => ts.map((x) => (x.id === v.id ? { ...x, scheduled_at: null } : x)));
      store.toast('Visit cancelled');
      load();
    } catch (e) {
      store.toast(`Could not cancel: ${e.message}`);
    }
  };

  const link = { fontSize: 12, fontWeight: 600, cursor: 'pointer' };
  const weekLabel = `${days[0].toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <Screen
      title="Schedule"
      subtitle="Booked installations and repairs by day, and who is going. The customer is texted when a visit is booked and again a few hours before."
      actions={canManage ? <Button variant="primary" onClick={() => setBooking({})}>+ Book a visit</Button> : null}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</Button>
        <span style={{ fontWeight: 600, minWidth: 190, textAlign: 'center' }}>{weekLabel}</span>
        <Button onClick={() => setWeekStart(addDays(weekStart, 7))}>›</Button>
        <Button onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</Button>
        <span style={{ marginLeft: 'auto', minWidth: 200 }}>
          <Select
            value={tech}
            onChange={(e) => setTech(e.target.value)}
            options={[{ value: '', label: 'Everyone' }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))', gap: 8, overflowX: 'auto' }}>
          {days.map((d) => {
            const key = dateKey(d);
            const list = (byDay.get(key) ?? []).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                style={{
                  background: color.cardBg, border: `1px solid ${isToday ? color.green : color.line}`, borderRadius: radius.md,
                  padding: 8, minHeight: 220, display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: isToday ? color.green : color.ink }}>{dayName(d)} {d.getDate()}</span>
                  {canManage && <span onClick={() => setBooking({ day: key })} title="Book a visit this day" style={{ ...link, color: color.green }}>+</span>}
                </div>
                {visits === null ? <span style={{ fontSize: 12, color: color.muted }}>Loading…</span> : list.length === 0 && (
                  <span style={{ fontSize: 12, color: color.muted }}>Nothing booked</span>
                )}
                {list.map((v) => {
                  const end = new Date(new Date(v.scheduled_at).getTime() + (v.scheduled_minutes ?? 60) * 60000);
                  const done = v.status === 'resolved';
                  return (
                    <div
                      key={v.id}
                      style={{
                        borderRadius: 8, padding: '7px 8px', fontSize: 12, display: 'grid', gap: 2,
                        background: done ? color.tileBg : v.kind === 'install' ? '#e8f1ff' : '#fff4e0',
                        opacity: done ? 0.7 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{timeLabel(v.scheduled_at)}–{timeLabel(end)} {done && '✓'}</div>
                      <div style={{ fontWeight: 600 }}>{v.subscriber_name ?? v.subject}</div>
                      <div style={{ color: color.neutralInk }}>{v.kind === 'install' ? 'Install' : 'Repair'} · {v.assignee_name ?? 'No technician'}</div>
                      {v.subscriber_location && <div style={{ color: color.muted }}>{v.subscriber_location}</div>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                        <span style={{ ...link, color: color.green }} onClick={() => navigate(`/tickets?open=${v.id}`)}>Open</span>
                        {canManage && !done && <span style={{ ...link, color: color.green }} onClick={() => setBooking({ ticket: v })}>Move</span>}
                        {canManage && !done && <span style={{ ...link, color: color.rust }} onClick={() => cancel(v)}>Cancel</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <Card title="Waiting to be booked" subtitle={`${unscheduled.length} open job${unscheduled.length === 1 ? '' : 's'} with no visit`}>
          {unscheduled.length === 0 ? (
            <Empty>Every open job has a visit.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 8, maxHeight: 520, overflowY: 'auto' }}>
              {unscheduled.slice(0, 40).map((t) => (
                <div key={t.id} style={{ display: 'grid', gap: 3, paddingBottom: 8, borderBottom: `1px solid ${color.line}`, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Badge tone={t.kind === 'install' ? 'active' : 'default'}>{t.kind === 'install' ? 'Install' : 'Repair'}</Badge>
                    <span style={{ fontWeight: 600 }}>{t.number}</span>
                  </div>
                  <div>{t.subscriber_name ?? t.subject}</div>
                  {t.subscriber_location && <div style={{ color: color.muted }}>{t.subscriber_location}</div>}
                  {canManage && <span style={{ ...link, color: color.green }} onClick={() => setBooking({ ticket: t })}>Book a visit</span>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <BookVisit
        open={!!booking}
        ticket={booking?.ticket ?? null}
        day={booking?.day}
        onClose={() => setBooking(null)}
        onSaved={load}
      />
    </Screen>
  );
}
