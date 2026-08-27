import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { color, font, radius, TOPBAR_H } from '../theme/tokens';
import { useStore } from '../state/store';
import { useMediaQuery } from './useMediaQuery';

const chip = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  border: `1px solid ${color.line}`,
  borderRadius: radius.md,
  background: color.subtleBg,
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
  cursor: 'pointer',
  fontSize: 12,
};

/**
 * Global search across the loaded collections — the React version of
 * searchMatches() in the mockup.
 */
function useSearchResults(q, store) {
  return useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hit = (v) => String(v ?? '').toLowerCase().includes(needle);
    const out = [];

    for (const c of store.clients) {
      if (hit(c.name) || hit(c.phone) || hit(c.account_code) || hit(c.static_ip) || hit(c.pppoe_user))
        out.push({ kind: 'Client', title: c.name, detail: `${c.account_code ?? ''} · ${c.phone ?? ''}`, to: '/clients' });
    }
    for (const p of store.unmatched) {
      if (hit(p.provider_ref) || hit(p.payer_phone) || hit(p.payer_name) || hit(p.raw_account))
        out.push({ kind: 'Payment', title: p.provider_ref, detail: `KES ${p.amount} · ${p.payer_phone ?? ''}`, to: '/payments' });
    }
    for (const t of store.tickets) {
      if (hit(t.subject) || hit(t.number))
        out.push({ kind: 'Ticket', title: t.subject, detail: t.number, to: '/tickets' });
    }
    for (const r of store.routers) {
      if (hit(r.name) || hit(r.host) || hit(r.nas_identifier))
        out.push({ kind: 'Router', title: r.name, detail: String(r.host ?? ''), to: '/routers' });
    }
    for (const v of store.vouchers) {
      if (hit(v.code) || hit(v.phone))
        out.push({ kind: 'Voucher', title: v.code, detail: v.status, to: '/hotspot' });
    }
    return out.slice(0, 40);
  }, [q, store.clients, store.unmatched, store.tickets, store.routers, store.vouchers]);
}

export default function Topbar() {
  const store = useStore();
  const isMobile = useMediaQuery('(max-width: 900px)');
  const navigate = useNavigate();
  const { searchQuery, setSearchQuery } = store;
  const results = useSearchResults(searchQuery, store);
  const hasQuery = searchQuery.trim().length > 0;

  /**
   * The dropdown is portaled to <body> and positioned with `fixed`, not
   * rendered inline where it visually sits.
   *
   * The header it used to live inside sets overflow-y:hidden — needed so
   * the chips scroll sideways on a narrow screen without wrapping onto a
   * second line — and that clips any absolutely-positioned child that
   * extends past the header's own height, dropdown included. The search box
   * itself worked fine; every result was rendering, just invisible, which
   * is indistinguishable from search being broken.
   */
  const searchBoxRef = useRef(null);
  const [dropdownRect, setDropdownRect] = useState(null);
  useLayoutEffect(() => {
    if (!hasQuery || !searchBoxRef.current) return;
    const update = () => {
      const r = searchBoxRef.current.getBoundingClientRect();
      setDropdownRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [hasQuery]);

  const sms = store.smsCredits;             // null until the first read comes back
  const known = sms != null;
  const smsConfigured = sms?.configured;
  // Own gateway credits when set up; otherwise the platform's shared
  // fallback balance — the same either-or the Settings and Buy-credits UI
  // already show, so this chip never reads "0 / not set" while a working
  // fallback is actually covering every send.
  const platformBalance = store.smsGateways?.platformBalance ?? 0;
  const credits = smsConfigured ? (sms?.credits ?? 0) : platformBalance;

  return (
    <header
      style={{
        height: TOPBAR_H,
        flex: `0 0 ${TOPBAR_H}px`,
        background: color.cardBg,
        borderBottom: `1px solid ${color.line}`,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 20px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        // The chips are fixed-width and there are more of them than fit on a
        // phone, so let the bar scroll rather than clipping the last one.
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {/* The way back to the pages once the drawer is closed. Desktop keeps the
          sidebar pinned, so it would only be clutter there. */}
      {isMobile && (
        <button
          type="button"
          onClick={() => store.setNavOpen(!store.navOpen)}
          aria-label="Menu"
          aria-expanded={store.navOpen}
          style={{
            border: `1px solid ${color.line}`, background: color.subtleBg,
            borderRadius: radius.md, cursor: 'pointer', fontSize: 15,
            lineHeight: 1, padding: '7px 10px', flex: '0 0 auto', color: color.ink,
          }}
        >
          ☰
        </button>
      )}

      <div ref={searchBoxRef} style={{ position: 'relative', flex: '1 1 auto', minWidth: 110, maxWidth: 380 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            border: `1px solid ${color.line}`,
            borderRadius: radius.md,
            background: color.subtleBg,
          }}
        >
          <span style={{ color: color.mutedSoft, fontSize: 13 }}>⌕</span>
          <input
            size="1"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search account, phone, IP or M-Pesa code…"
            aria-label="Search"
            style={{
              flex: '1 1 0',
              minWidth: 0,
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13,
              color: color.ink,
            }}
          />
          {hasQuery && (
            <span onClick={() => setSearchQuery('')} style={{ color: color.mutedSoft, fontSize: 14, cursor: 'pointer' }}>
              ×
            </span>
          )}
        </div>

        {hasQuery && dropdownRect && createPortal(
          <div
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: 500,
              background: '#fff',
              border: `1px solid ${color.line}`,
              borderRadius: 10,
              padding: 6,
              boxShadow: '0 16px 36px rgba(18,23,21,.16)',
              maxHeight: 380,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {results.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12.5, color: color.muted }}>No matches for "{searchQuery}"</div>
            ) : (
              results.map((r, i) => (
                <div
                  key={`${r.kind}-${i}`}
                  onClick={() => {
                    setSearchQuery('');
                    navigate(r.to);
                  }}
                  style={{
                    padding: '9px 11px',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>
                    <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>{r.detail}</span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: color.neutralInk,
                      background: color.tileBg,
                      padding: '3px 8px',
                      borderRadius: radius.pill,
                      fontWeight: 600,
                    }}
                  >
                    {r.kind}
                  </span>
                </div>
              ))
            )}
          </div>,
          document.body
        )}
      </div>

      <div style={{ flex: '1 1 0', minWidth: 0 }} />

      <div
        style={chip}
        onClick={() => navigate('/settings?tab=sms')}
        title={!known ? 'Checking SMS balance…' : smsConfigured ? 'SMS gateway connected' : 'No gateway of your own — sending through the platform default'}
      >
        <span style={{ color: color.neutralInk }}>SMS</span>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 12.5,
            fontWeight: 500,
            color: !known ? color.muted : credits > 0 ? color.green : color.rust,
          }}
        >
          {known ? credits.toLocaleString() : '—'}
        </span>
        <span style={{ fontSize: 10.5, color: color.muted }}>
          {smsConfigured ? sms.provider : known ? 'system default' : 'checking…'}
        </span>
      </div>

      <div
        style={{ ...chip, cursor: 'default', background: color.tileBg }}
        title="Licence status"
      >
        <span style={{ color: color.neutralInk }}>Licence</span>
        <span style={{ fontFamily: font.mono, fontSize: 12.5, fontWeight: 600, color: color.neutralInk }}>—</span>
      </div>

      <div style={{ ...chip, background: '#fff', fontWeight: 500 }} onClick={() => store.setDark(!store.dark)}>
        {store.dark ? '☀ Light' : '☾ Dark'}
      </div>

      {/* Only a super admin can actually reach the platform screens, so the
          toggle is theirs alone — everyone else just sees their tenant. */}
      {store.session?.superAdmin ? (
        <div
          onClick={() => store.setRole(store.role === 'owner' ? 'tenant' : 'owner')}
          title="Switch between platform-owner and tenant view"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', fontSize: 11.5, color: color.muted, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <span>🔒</span>
          <span>{store.role === 'owner' ? 'Platform owner' : 'Tenant'}</span>
        </div>
      ) : (
        <div
          title={store.session?.company ?? ''}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', fontSize: 11.5, color: color.muted, whiteSpace: 'nowrap' }}
        >
          <span>🏢</span>
          <span>{store.session?.company ?? 'Tenant'}</span>
        </div>
      )}
    </header>
  );
}
