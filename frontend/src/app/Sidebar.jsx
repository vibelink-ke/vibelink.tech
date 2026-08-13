import React from 'react';
import { NavLink } from 'react-router-dom';
import { color, font, radius, SIDEBAR_W } from '../theme/tokens';
import { useStore } from '../state/store';
import { NAV_SECTIONS } from './nav';
import { useMediaQuery } from './useMediaQuery';

const heading = {
  padding: '16px 8px 6px',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.1em',
  color: color.sideHeading,
};

function Row({ item, store }) {
  const count = item.count?.(store);
  const badge = item.badge?.(store);
  return (
    <NavLink to={item.to} end={item.end} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <div
          style={{
            position: 'relative',
            padding: '9px 10px',
            borderRadius: radius.md,
            cursor: 'pointer',
            fontSize: 13.5,
            fontWeight: 500,
            color: color.sideFg,
            background: isActive ? color.sideActive : 'transparent',
            borderLeft: `2px solid ${isActive ? color.mint : 'transparent'}`,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>{item.label}</span>
            {item.dot && <span style={{ width: 7, height: 7, borderRadius: radius.pill, background: color.mint }} />}
            {count !== undefined && (
              <span style={{ fontFamily: font.mono, fontSize: 10.5, color: color.sideMuted }}>{count}</span>
            )}
            {badge !== undefined && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: radius.pill,
                  background: badge > 0 ? color.rustBg : '#e4e8e3',
                  color: badge > 0 ? color.rust : color.sideMuted,
                  fontSize: 10.5,
                  fontWeight: 600,
                }}
              >
                {badge}
              </span>
            )}
          </span>
        </div>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const store = useStore();
  const s = store.session;

  // The tenant's own company name, not a platform-wide brand. Settings →
  // Organisation edits tenants.name, so renaming there renames it here.
  // Upper-cased however it was typed: operators enter their company in every
  // casing imaginable and the sidebar is the one place it is always on screen.
  const brandName = (s?.company || 'Vibelink').toUpperCase();

  const name = s?.name || 'Set up your profile';
  // Just the role. The subdomain used to hang off it, which told the operator
  // nothing they needed and put their hostname on screen for anyone behind them.
  const sub = s ? (s.role || 'Owner') : 'Owner';
  const initials = s?.name
    ? s.name.trim().split(/\s+/).slice(0, 2).map((x) => x[0].toUpperCase()).join('')
    : '—';

  /**
   * On a phone the sidebar is a drawer, not a column.
   *
   * It used to be a fixed 232px pinned open, which on a 375px screen left the
   * actual work with a third of the width — tables ran off the side and every
   * page had to be scrolled sideways to read. Below 900px it slides in over the
   * content and closes as soon as you pick something.
   */
  const isMobile = useMediaQuery('(max-width: 900px)');
  const open = !isMobile || store.navOpen;

  const setNavOpen = store.setNavOpen;

  // Picking a page on a phone should get the drawer out of the way.
  const closeOnMobile = () => { if (isMobile) setNavOpen(false); };

  return (
    <>
      {isMobile && store.navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(18,23,21,.45)', zIndex: 40 }}
        />
      )}
    <aside
      onClick={closeOnMobile}
      style={{
        width: SIDEBAR_W,
        flex: isMobile ? 'none' : `0 0 ${SIDEBAR_W}px`,
        display: 'flex',
        flexDirection: 'column',
        position: isMobile ? 'fixed' : 'sticky',
        left: 0,
        top: 0,
        height: '100vh',
        background: color.sideBg,
        zIndex: 41,
        // Kept mounted and slid off-screen so opening it does not re-run every
        // effect in the tree.
        transform: open ? 'translateX(0)' : `translateX(-${SIDEBAR_W}px)`,
        transition: 'transform .18s ease',
        boxShadow: isMobile && open ? '0 0 40px rgba(18,23,21,.35)' : undefined,
      }}
    >
      <div style={{ padding: '20px 18px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${color.sideLine}` }}>
        <div
          style={{
            width: 30,
            height: 30,
            flex: '0 0 30px',
            borderRadius: radius.md,
            background: color.green,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {brandName.charAt(0).toUpperCase()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span
            title={brandName}
            style={{
              fontSize: 14, fontWeight: 600, letterSpacing: '-.01em', color: color.sideFooterName,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {brandName}
          </span>
          <span style={{ fontSize: 11, fontFamily: font.mono, color: color.sideMuted }}>
            v2.4
          </span>
        </div>
      </div>

      <nav style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
        {NAV_SECTIONS.filter((s) => !s.ownerOnly || store.isPlatformOwner).map((section, si) => (
          <React.Fragment key={section.heading}>
            <div style={{ ...heading, paddingTop: si === 0 ? 10 : 16 }}>{section.heading}</div>
            {section.items.map((item) => (
              <Row key={item.to} item={item} store={store} />
            ))}
          </React.Fragment>
        ))}
      </nav>

      <div style={{ padding: 12, borderTop: `1px solid ${color.sideLine}`, display: 'flex', alignItems: 'center', gap: 9 }}>
        <div
          style={{
            width: 28,
            height: 28,
            flex: '0 0 28px',
            borderRadius: radius.pill,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            background: color.sideActive,
            color: color.sideFg,
          }}
        >
          {initials}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: color.sideFooterName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          <span style={{ fontSize: 11, color: color.sideMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sub}
          </span>
        </div>
        <button
          type="button"
          onClick={store.signOut}
          title="Sign out"
          aria-label="Sign out"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: color.sideMuted, fontSize: 14, padding: 4, lineHeight: 1 }}
        >
          ⏻
        </button>
      </div>
    </aside>
    </>
  );
}
