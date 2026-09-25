import React, { lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import Toast from '../app/Toast';
import ErrorBoundary from '../ui/boundary';

const Tenants = lazy(() => import('./Tenants'));
const PlatformMonitor = lazy(() => import('./PlatformMonitor'));
const SaasRevenue = lazy(() => import('./SaasRevenue'));
const Gateways = lazy(() => import('./settings/Gateways'));

/**
 * The platform owner's console, at <root domain>/admin.
 *
 * Managing the ISPs that run on the platform is a different job from running an ISP, and used to happen inside
 * the owner's own portal (billing.<root>) among its clients and routers. This is a page of its own on the root
 * domain: sign in as the platform owner, and there are the tenants, the platform's health and the SaaS revenue,
 * with none of an ISP's own screens around them. Only a platform owner gets past the sign-in; anyone else is
 * turned away by the server before a session exists.
 */
const TABS = [
  { to: '/admin', label: 'ISP tenants', view: Tenants },
  { to: '/admin/monitor', label: 'Platform monitor', view: PlatformMonitor },
  { to: '/admin/revenue', label: 'SaaS revenue', view: SaasRevenue },
  { to: '/admin/gateways', label: 'Payment gateways', view: Gateways, props: { platform: true },
    note: 'The platform\'s own paybill: it takes the fees ISPs pay the platform and the payments of ISPs who collect through it. It is kept here and appears in no ISP\'s own settings.' },
];

export default function AdminConsole() {
  const store = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const session = store.session;
  const root = window.location.hostname.replace(/^www\./, '');

  const shell = { minHeight: '100vh', background: color.bg ?? '#f5f6f3', fontFamily: font.sans, color: color.ink };

  if (!session?.superAdmin) {
    return (
      <div className={store.dark ? 'om-dark' : undefined} style={{ ...shell, display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 21, margin: '0 0 8px' }}>Platform owner only</h1>
          <p style={{ color: color.muted, fontSize: 14.5, lineHeight: 1.55 }}>
            This page is for the platform owner. Your own portal is at {session?.subdomain ? `${session.subdomain}.${root}` : 'your ISP address'}.
          </p>
          <button type="button" onClick={() => store.signOut()} style={{ height: 40, padding: '0 18px', borderRadius: 8, border: `1px solid ${color.line}`, background: '#fff', cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>
    );
  }

  const active = [...TABS].reverse().find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`)) ?? TABS[0];
  const View = active.view;

  return (
    <div className={store.dark ? 'om-dark' : undefined} style={shell}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', padding: '12px 22px', background: '#fff', borderBottom: `1px solid ${color.line}` }}>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.01em' }}>Vibelink Admin</span>
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {TABS.map((t) => (
            <button
              key={t.to}
              type="button"
              onClick={() => navigate(t.to)}
              style={{
                height: 34, padding: '0 14px', borderRadius: 8, border: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
                background: t === active ? color.green : 'transparent', color: t === active ? '#fff' : color.ink,
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button type="button" onClick={() => store.setDark(!store.dark)} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: `1px solid ${color.line}`, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
          {store.dark ? '☀ Light' : '☾ Dark'}
        </button>
        <span style={{ fontSize: 12.5, color: color.muted }}>{session.name ?? session.email}</span>
        {session.subdomain && (
          <a href={`https://${session.subdomain}.${root}`} style={{ fontSize: 12.5, fontWeight: 600, color: color.green }}>My ISP portal</a>
        )}
        <button type="button" onClick={() => store.signOut()} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: `1px solid ${color.line}`, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Sign out</button>
      </header>
      <main style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, maxWidth: 1400, margin: '0 auto' }}>
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={null}>
            {active.note && <p style={{ margin: 0, fontSize: 13.5, color: color.muted, lineHeight: 1.5 }}>{active.note}</p>}
            <View {...(active.props ?? {})} />
          </Suspense>
        </ErrorBoundary>
      </main>
      <Toast />
    </div>
  );
}
