import React, { useMemo, useState } from 'react';
import { color, font, radius } from '../../theme/tokens';

/**
 * When everybody's line runs out, on one page.
 *
 * A list sorted by date answers "who is next"; a month answers "what does this
 * week look like" — the question behind staffing a collection round, or
 * spotting that ninety customers fall due on the same day because they were
 * imported together. Both are worth having, so this sits beside the list
 * rather than replacing it.
 *
 * Built from the clients already in the store. Expiry is our own data
 * (subscribers.expires_at) and owes nothing to WHMCS, so there is nothing to
 * fetch and it stays in step with the rest of the screen.
 */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Monday-first: a Kenyan working week starts there. */
const gridStart = (month) => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const weekday = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - weekday);
};

export default function ExpiryCalendar({ clients = [], onOpen }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [picked, setPicked] = useState(null);

  /*
   * Keyed by local date rather than by the ISO string. An expiry stored at
   * 21:00 UTC is the following day in Nairobi, and putting a customer on the
   * wrong square is the kind of quiet error that gets somebody disconnected a
   * day early.
   */
  const byDay = useMemo(() => {
    const map = new Map();
    for (const c of clients) {
      if (!c.expires_at) continue;
      const key = startOfDay(new Date(c.expires_at)).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return map;
  }, [clients]);

  const days = useMemo(() => {
    const start = gridStart(month);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { date: d, inMonth: d.getMonth() === month.getMonth(), list: byDay.get(d.toDateString()) ?? [] };
    });
  }, [month, byDay]);

  const today = startOfDay(new Date()).getTime();
  const withoutDate = clients.filter((c) => !c.expires_at).length;
  const monthLabel = month.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });

  const step = (by) => {
    setPicked(null);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));
  };

  const navBtn = {
    fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', padding: '6px 11px',
    borderRadius: radius.sm, border: `1px solid ${color.line}`, background: color.tileBg,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" style={navBtn} onClick={() => step(-1)}>‹</button>
        <strong style={{ fontSize: 14, minWidth: 150 }}>{monthLabel}</strong>
        <button type="button" style={navBtn} onClick={() => step(1)}>›</button>
        <button
          type="button"
          style={{ ...navBtn, marginLeft: 4 }}
          onClick={() => {
            setPicked(null);
            const n = new Date();
            setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
          }}
        >
          This month
        </button>
        {withoutDate > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: color.muted }}>
            {withoutDate} client{withoutDate === 1 ? '' : 's'} with no expiry date set
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {DAY_NAMES.map((d) => (
          <span key={d} style={{ fontSize: 11.5, color: color.muted, fontWeight: 600, padding: '0 2px' }}>{d}</span>
        ))}

        {days.map(({ date, inMonth, list }) => {
          const time = date.getTime();
          const isToday = time === today;
          const overdue = time < today && list.length > 0;
          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => setPicked(list.length ? date.toDateString() : null)}
              style={{
                fontFamily: 'inherit', textAlign: 'left', cursor: list.length ? 'pointer' : 'default',
                minHeight: 62, padding: '6px 7px', borderRadius: radius.sm,
                border: isToday ? `2px solid ${color.green}` : `1px solid ${color.line}`,
                background: picked === date.toDateString() ? '#e7f5ef' : inMonth ? '#fff' : color.tileBg,
                opacity: inMonth ? 1 : 0.5,
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              <span style={{ fontSize: 12, fontFamily: font.mono, color: isToday ? color.green : color.muted }}>
                {date.getDate()}
              </span>
              {list.length > 0 && (
                <span
                  style={{
                    alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 700, padding: '2px 7px',
                    borderRadius: 999, color: '#fff',
                    // A past date still holding expiries is money already owed,
                    // which is a different matter from one coming up.
                    background: overdue ? color.rust : color.green,
                  }}
                >
                  {list.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {picked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            Expiring {new Date(picked).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          {(byDay.get(picked) ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen?.(c)}
              style={{
                fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', fontSize: 13,
                padding: '8px 11px', borderRadius: radius.sm, border: `1px solid ${color.line}`,
                background: color.tileBg, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
              }}
            >
              <strong>{c.name}</strong>
              <span style={{ fontFamily: font.mono, fontSize: 12, color: color.muted }}>{c.account_code}</span>
              <span style={{ fontSize: 12, color: color.muted }}>{c.phone}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: color.muted }}>{c.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
