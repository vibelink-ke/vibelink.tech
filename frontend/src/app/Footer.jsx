import React from 'react';
import { color } from '../theme/tokens';

/** Who the product is credited to in the footer. Change it here and it changes everywhere the footer appears. */
export const DEVELOPER = 'Vibelink';

/**
 * The footer every page carries: the year and the organisation's own name on the left, who designed and built the
 * system on the right. `company` is the tenant's name; where none is known yet (a sign-in page before anyone is
 * recognised) it falls back to the product's own.
 *
 * In normal flow it sits at the bottom of the page (margin-top: auto in a column layout). `floating` pins it to the
 * bottom of the window instead, for short centred pages such as the sign-in card.
 */
export default function Footer({ company, floating = false }) {
  const year = new Date().getFullYear();
  return (
    <footer
      style={{
        ...(floating ? { position: 'fixed', left: 0, right: 0, bottom: 0 } : { marginTop: 'auto' }),
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '4px 16px',
        flexWrap: 'wrap',
        padding: '12px 26px',
        borderTop: `1px solid ${color.line}`,
        fontSize: 12,
        color: color.muted,
      }}
    >
      <span>{year} © {company || 'Vibelink'}</span>
      <span>Designed and developed by {DEVELOPER}</span>
    </footer>
  );
}
