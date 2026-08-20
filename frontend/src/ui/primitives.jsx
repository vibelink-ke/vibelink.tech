import React from 'react';
import { color, font, radius, toneFor } from '../theme/tokens';

/* ── layout ───────────────────────────────────────────────── */

export function Screen({ title, subtitle, actions, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {title && <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em', color: color.ink }}>{title}</h1>}
            {subtitle && <p style={{ margin: 0, fontSize: 13.5, color: color.neutralInk }}>{subtitle}</p>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Card({ title, subtitle, actions, pad = 16, children, style }) {
  return (
    <section
      style={{
        background: color.cardBg,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            padding: '13px 16px',
            borderBottom: `1px solid ${color.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {title && <span style={{ fontSize: 13.5, fontWeight: 600, color: color.ink }}>{title}</span>}
            {subtitle && <span style={{ fontSize: 12, color: color.muted }}>{subtitle}</span>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding: pad, minWidth: 0 }}>{children}</div>
    </section>
  );
}

export const Grid = ({ min = 220, gap = 12, children, style }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      gap,
      ...style,
    }}
  >
    {children}
  </div>
);

/* ── data display ─────────────────────────────────────────── */

export function Stat({ label, value, hint, tone }) {
  return (
    <div
      style={{
        background: color.cardBg,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: color.muted, textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontFamily: font.mono, fontSize: 24, color: tone ?? color.ink }}>{value}</span>
      {hint && <span style={{ fontSize: 12.5, color: color.neutralInk }}>{hint}</span>}
    </div>
  );
}

export function Badge({ children, tone }) {
  const t = typeof tone === 'object' ? tone : toneFor(tone ?? children);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: radius.pill,
        background: t.bg,
        color: t.fg,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export const Mono = ({ children, style }) => (
  <span style={{ fontFamily: font.mono, fontSize: 12.5, ...style }}>{children}</span>
);

export const Dot = ({ on = true }) => (
  <span
    style={{
      width: 7,
      height: 7,
      borderRadius: radius.pill,
      background: on ? color.mint : color.rust,
      display: 'inline-block',
      animation: on ? 'pulseDot 2s infinite' : 'none',
    }}
  />
);

/**
 * Table. `columns` is [{ key, label, align, width, render }].
 * Scrolls inside its own container so the page never scrolls sideways.
 */
export function Table({ columns, rows, empty = 'Nothing here yet', rowKey = (_, i) => i, onRowClick }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="scroll-x">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align ?? 'left',
                  padding: '8px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  color: color.muted,
                  borderBottom: `1px solid ${color.line}`,
                  whiteSpace: 'nowrap',
                  width: c.width,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign: c.align ?? 'left',
                    padding: '10px',
                    borderBottom: `1px solid ${color.line}`,
                    color: color.ink,
                    verticalAlign: 'middle',
                  }}
                >
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Empty = ({ children, action }) => (
  <div
    style={{
      padding: '28px 16px',
      textAlign: 'center',
      color: color.muted,
      fontSize: 13,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      alignItems: 'center',
    }}
  >
    <span>{children}</span>
    {action}
  </div>
);

/* ── controls ─────────────────────────────────────────────── */

export function Button({ variant = 'default', size = 'md', children, style, ...rest }) {
  const pad = size === 'sm' ? '5px 10px' : '7px 13px';
  const base = {
    padding: pad,
    borderRadius: radius.md,
    fontSize: size === 'sm' ? 12.5 : 13,
    fontWeight: 500,
    cursor: 'pointer',
    border: `1px solid ${color.line}`,
    background: color.cardBg,
    color: color.ink,
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
  };
  const variants = {
    default: {},
    primary: { background: color.green, borderColor: color.green, color: '#fff', fontWeight: 600 },
    danger: { background: color.rustBg, borderColor: '#e6c4b8', color: color.rust, fontWeight: 600 },
    ghost: { background: 'transparent', borderColor: 'transparent', color: color.muted },
  };
  return (
    <button type="button" style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children, span }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, gridColumn: span ? `span ${span}` : undefined }}>
      {label && <span style={{ fontSize: 12, fontWeight: 500, color: color.inkSoft }}>{label}</span>}
      {children}
      {hint && <span style={{ fontSize: 11.5, color: color.muted }}>{hint}</span>}
    </label>
  );
}

const controlStyle = {
  padding: '7px 10px',
  border: `1px solid ${color.line}`,
  borderRadius: radius.md,
  background: color.subtleBg,
  fontSize: 13,
  color: color.ink,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export const Input = ({ style, ...rest }) => <input style={{ ...controlStyle, ...style }} {...rest} />;

export const Textarea = ({ style, ...rest }) => (
  <textarea style={{ ...controlStyle, resize: 'vertical', minHeight: 84, ...style }} {...rest} />
);

export const Select = ({ options = [], style, ...rest }) => (
  <select style={{ ...controlStyle, ...style }} {...rest}>
    {options.map((o) => {
      const value = typeof o === 'string' ? o : o.value;
      const label = typeof o === 'string' ? o : o.label;
      return (
        <option key={value} value={value}>
          {label}
        </option>
      );
    })}
  </select>
);

export function Toggle({ checked, onChange, label, detail }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {label && <span style={{ fontSize: 13, color: color.ink }}>{label}</span>}
        {detail && <span style={{ fontSize: 11.5, color: color.muted }}>{detail}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={typeof label === 'string' ? label : 'Toggle'}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 38,
          height: 22,
          flex: '0 0 38px',
          borderRadius: radius.pill,
          border: 'none',
          cursor: 'pointer',
          background: checked ? color.green : '#cfd5cd',
          position: 'relative',
          transition: 'background .15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 19 : 3,
            width: 16,
            height: 16,
            borderRadius: radius.pill,
            background: '#fff',
            transition: 'left .15s',
          }}
        />
      </button>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${color.line}`, overflowX: 'auto' }}>
      {tabs.map((t) => {
        const id = typeof t === 'string' ? t : t.id;
        const label = typeof t === 'string' ? t : t.label;
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            style={{
              padding: '9px 13px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: on ? 600 : 500,
              color: on ? color.green : color.muted,
              borderBottom: `2px solid ${on ? color.green : 'transparent'}`,
              marginBottom: -1,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ── overlays ─────────────────────────────────────────────── */

export function Modal({ open, title, onClose, footer, width = 520, children }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(18,33,29,.42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={{
          background: color.cardBg,
          borderRadius: radius.lg,
          width: '100%',
          maxWidth: width,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${color.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: color.ink }}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: color.muted, lineHeight: 1 }}
          >
            ×
          </button>
        </header>
        <div style={{ padding: 16, overflowY: 'auto' }}>{children}</div>
        {footer && (
          <footer style={{ padding: '12px 16px', borderTop: `1px solid ${color.line}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * The panel View opens.
 *
 * 420px was too narrow for what ended up in it — credentials, location,
 * coordinates, plan, expiry — so everything wrapped into a column of fragments
 * and the operator scrolled to read one customer. Wider by default, and a good
 * share of the window on a large screen, while still stopping short of the full
 * width: the list behind it is the context for what you are reading, and losing
 * it entirely turns a glance into navigation.
 */
export function Drawer({ open, title, onClose, children, width = 'min(880px, 94vw)' }) {
  if (!open) return null;
  // A wall of 12.5px rows with no grouping was the actual complaint — every
  // "View" panel in the app is built from this one component, so making it
  // bigger and better organised here is what fixes all of them at once
  // rather than one screen at a time.
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(18,33,29,.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 55 }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          background: color.cardBg,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: `1px solid ${color.line}`,
          boxShadow: '-24px 0 60px rgba(18,23,21,.18)',
        }}
      >
        <header
          style={{
            padding: '22px 28px',
            borderBottom: `1px solid ${color.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: color.subtleBg,
          }}
        >
          <span style={{ fontSize: 21, fontWeight: 700, color: color.ink, letterSpacing: '-.01em' }}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: `1px solid ${color.line}`, background: color.cardBg, cursor: 'pointer',
              fontSize: 18, color: color.muted, lineHeight: 1, width: 34, height: 34,
              borderRadius: radius.pill, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </header>
        <div style={{ padding: '24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22, fontSize: 15 }}>
          {children}
        </div>
      </aside>
    </div>
  );
}

export const KV = ({ k, v }) => (
  <div
    style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16,
      fontSize: 14.5, padding: '9px 0', borderBottom: `1px solid ${color.tileBg}`,
    }}
  >
    <span style={{ color: color.muted, fontWeight: 500 }}>{k}</span>
    <span style={{ color: color.ink, textAlign: 'right', fontWeight: 600 }}>{v}</span>
  </div>
);

/** Thin progress/utilisation bar used on tickets, pools and capacity tiles. */
export const Bar = ({ pct = 0, tone = color.green }) => (
  <div style={{ height: 5, borderRadius: radius.pill, background: color.tileBg, overflow: 'hidden' }}>
    <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: tone }} />
  </div>
);

/**
 * The actions at the end of a table row.
 *
 * These were bare text spans with a right margin, which rendered as one run of
 * words — "ViewPauseSuspendEditDelete" — with no gap between the tap targets.
 * On a phone that is unhittable, and on a laptop it reads as a single label
 * rather than five things you can do.
 *
 * A flex row with a real gap, each action padded to a size a thumb can find,
 * and allowed to wrap rather than pushing the table sideways.
 */
export const RowActions = ({ children }) => (
  <div style={{
    display: 'flex', gap: 6, justifyContent: 'flex-end',
    flexWrap: 'wrap', alignItems: 'center',
  }}>
    {children}
  </div>
);

export const RowAction = ({ tone, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    style={{
      font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
      color: tone ?? color.inkSoft, background: 'transparent',
      border: `1px solid ${color.line}`, borderRadius: radius.md,
      padding: '5px 10px', whiteSpace: 'nowrap', lineHeight: 1.2,
    }}
  >
    {children}
  </button>
);
