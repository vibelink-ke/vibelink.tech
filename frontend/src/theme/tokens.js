/**
 * Design tokens lifted from BILLING.SYSTEM.dc.html.
 *
 * The source mockup inlined every colour as a hex literal. These are the values
 * that actually recur; anything appearing once stays inline at its call site.
 */

export const color = {
  // page + surfaces
  pageBg: '#f5f6f3',
  cardBg: '#ffffff',
  subtleBg: '#fafbf9',
  tileBg: '#f2f4f0',
  line: '#e4e6e1',

  // text
  ink: '#161a17',
  inkSoft: '#3a443d',
  muted: '#8a9186',
  mutedSoft: '#9aa39c',

  // brand
  green: '#0f7a5f',
  greenDark: '#0b5c47',
  mint: '#2fbf8f',

  // status
  amber: '#c9a227',
  amberInk: '#7d5c11',
  amberBg: '#fdf3dc',
  rust: '#a5451f',
  rustBg: '#f7e2dc',
  neutralInk: '#6b7269',

  // sidebar (light)
  sideBg: '#f4f6f2',
  sideLine: '#e0e5dd',
  sideFg: '#3a443d',
  sideHeading: '#8a938b',
  sideMuted: '#7c857d',
  sideActive: '#e2ebe5',
  sideHover: '#eaefe9',
  sideFooterName: '#161d19',

  // dark-root page colour (see darkMode note in global.css)
  darkRoot: '#0e1412',
};

export const font = {
  sans: "'Instrument Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
};

/** Sidebar width — the mockup pins this at a fixed 236px. */
export const SIDEBAR_W = 236;
/** Sticky topbar height. */
export const TOPBAR_H = 56;

/** Status pill colours, keyed by the vocabulary the screens use. */
export const statusTone = {
  active:    { bg: '#e2ebe5', fg: '#0f7a5f' },
  online:    { bg: '#e2ebe5', fg: '#0f7a5f' },
  up:        { bg: '#e2ebe5', fg: '#0f7a5f' },
  paid:      { bg: '#e2ebe5', fg: '#0f7a5f' },
  resolved:  { bg: '#e2ebe5', fg: '#0f7a5f' },
  grace:     { bg: color.amberBg, fg: color.amberInk },
  partial:   { bg: color.amberBg, fg: color.amberInk },
  pending:   { bg: color.amberBg, fg: color.amberInk },
  unmatched: { bg: color.amberBg, fg: color.amberInk },
  expired:   { bg: color.rustBg, fg: color.rust },
  suspended: { bg: color.rustBg, fg: color.rust },
  down:      { bg: color.rustBg, fg: color.rust },
  failed:    { bg: color.rustBg, fg: color.rust },
  unused:    { bg: color.tileBg, fg: color.neutralInk },
  default:   { bg: color.tileBg, fg: color.neutralInk },
};

export const toneFor = (s) =>
  statusTone[String(s ?? '').toLowerCase().replace(/\s+/g, '')] ?? statusTone.default;

/** KES money formatting used across the money screens. */
export const kes = (n) =>
  Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
