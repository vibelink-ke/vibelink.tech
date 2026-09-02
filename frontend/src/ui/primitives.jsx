import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
/**
 * A centered popup, not a side panel — a wall of 12.5px rows with no
 * grouping was the original complaint, and even enlarged, a slide-out felt
 * like a filing drawer rather than somewhere a person actually works.
 * Every "View" button in the app opens this one component, so its shape
 * changing here is what makes every one of them look and behave the same
 * way, not just Clients.
 *
 * `subtitle` and `actions` are both optional — a screen that only ever
 * passed `title` and `children` still renders correctly, just without the
 * avatar circle's second line or an actions row. `actions` is an array of
 * { label, onClick, tone: 'primary'|'danger'|undefined, disabled, title }.
 */
export function Drawer({ open, title, subtitle, actions, onClose, children, width = 640 }) {
  if (!open) return null;
  const initials = typeof title === 'string'
    ? title.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '';
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(18,33,29,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 55,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: '88vh',
          background: color.cardBg,
          borderRadius: radius.lg,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(18,23,21,.30)',
        }}
      >
        <header
          style={{
            padding: '26px 28px 20px',
            borderBottom: `1px solid ${color.line}`,
            background: color.subtleBg,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              {initials && (
                <div
                  style={{
                    width: 52, height: 52, borderRadius: radius.pill, background: color.green, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 19, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {initials}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 21, fontWeight: 700, color: color.ink, letterSpacing: '-.01em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {title}
                </span>
                {subtitle && <span style={{ fontSize: 13, color: color.muted }}>{subtitle}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                border: `1px solid ${color.line}`, background: color.cardBg, cursor: 'pointer',
                fontSize: 18, color: color.muted, lineHeight: 1, width: 34, height: 34,
                borderRadius: radius.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
          {actions?.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={a.onClick}
                  disabled={a.disabled}
                  title={a.title}
                  style={{
                    padding: '9px 16px', borderRadius: radius.md, fontSize: 13.5, fontWeight: 600,
                    cursor: a.disabled ? 'default' : 'pointer', opacity: a.disabled ? 0.5 : 1,
                    border: a.tone === 'primary' ? 'none' : `1px solid ${a.tone === 'danger' ? color.rust : color.line}`,
                    background: a.tone === 'primary' ? color.green : a.tone === 'danger' ? 'transparent' : color.cardBg,
                    color: a.tone === 'primary' ? '#fff' : a.tone === 'danger' ? color.rust : color.ink,
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </header>
        <div style={{ padding: '22px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, fontSize: 15 }}>
          {children}
        </div>
      </div>
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

/**
 * A per-row "Actions ▾" dropdown, for a row with more actions than fit as
 * inline buttons without the table fighting for width. Originally built for
 * Routers.jsx's seven-action row menu; extracted here once Clients.jsx
 * needed the identical shape rather than a second copy of it.
 *
 * Rendered through a portal into document.body, positioned in `position:
 * fixed` from the toggle button's own getBoundingClientRect() — not as a
 * child of the button. A table wrapped in its own horizontally-scrolling
 * container (`overflow-x: auto`) makes CSS treat the unset overflow-y as
 * auto too, the instant its sibling axis is anything but visible; a menu
 * living inside that container gets clipped by it the moment it opens near
 * the table's bottom or right edge — it exists, it just has nowhere visible
 * to draw itself. A portal escapes that ancestor entirely.
 *
 * Pair with useActionMenu() for the open/anchorRect/outside-click state
 * this needs, rather than wiring that up again per screen.
 */
export function ActionMenu({ open, anchorRect, menuRef, onToggle, children }) {
  const menuWidth = 184;
  // Clamping `top` to the viewport bottom stops the menu starting past the
  // edge, but does nothing about it still opening *downward* from there — a
  // row with little room below it gets a menu whose items render mostly
  // below the fold. Flip upward instead whenever there is more room above
  // the button than below it; either way, maxHeight + its own scroll is the
  // backstop for a viewport too short for the full list regardless of which
  // side it opens on.
  const spaceBelow = open && anchorRect ? window.innerHeight - anchorRect.bottom : 0;
  const spaceAbove = open && anchorRect ? anchorRect.top : 0;
  const openUpward = open && anchorRect && spaceBelow < 260 && spaceAbove > spaceBelow;
  return (
    <div style={{ display: 'inline-block' }}>
      <Button onClick={onToggle}>Actions ▾</Button>
      {open && anchorRect && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8)),
            ...(openUpward
              ? { bottom: window.innerHeight - anchorRect.top + 4, maxHeight: anchorRect.top - 12 }
              : { top: anchorRect.bottom + 4, maxHeight: window.innerHeight - anchorRect.bottom - 12 }),
            overflowY: 'auto',
            zIndex: 1000,
            background: '#fff', border: `1px solid ${color.line}`, borderRadius: radius.md,
            boxShadow: '0 10px 28px rgba(20,26,23,.16)', width: menuWidth, padding: 6,
            display: 'grid', gap: 1,
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function MenuItem({ onClick, title, tone, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0,
        borderRadius: radius.sm ?? 6, padding: '8px 10px', fontSize: 13, color: tone ?? color.ink ?? '#161a17',
        cursor: 'pointer', font: 'inherit',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f6f3'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      {children}
    </button>
  );
}

/**
 * The open/anchorRect/outside-click wiring ActionMenu needs, shared so a
 * screen with several menu-holding rows (only one open at a time, tracked
 * by whatever id each row uses) doesn't reimplement it per screen.
 */
export function useActionMenu() {
  const [openId, setOpenId] = useState(null);
  const [rect, setRect] = useState(null);
  const nodeRef = useRef(null);

  // Registered a tick late, on purpose: the very click that opens the menu
  // would otherwise be caught by this same listener before that click
  // finishes dispatching, closing the menu in the same gesture that opened
  // it. setTimeout(…, 0) pushes the addEventListener call to the next
  // macrotask, after the opening click has fully finished bubbling.
  useEffect(() => {
    if (!openId) return undefined;
    const close = (e) => {
      if (nodeRef.current?.contains(e.target)) return;
      setOpenId(null);
    };
    const id = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [openId]);

  const toggle = (id) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOpenId((cur) => (cur === id ? null : id));
    setRect(r);
  };

  return { openId, rect, nodeRef, toggle, close: () => setOpenId(null) };
}
