import React, { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from './app/Sidebar';
import Topbar from './app/Topbar';
import Toast from './app/Toast';
import AuthGate from './app/AuthGate';
import { isPlatformHost } from './app/host';
import CustomerPortal from './screens/CustomerPortal';
import { useMediaQuery } from './app/useMediaQuery';
import { useStore } from './state/store';
import { color, font } from './theme/tokens';

import Dashboard from './screens/Dashboard';
import Clients from './screens/Clients';
import AddClient from './screens/AddClient';
import Networks from './screens/Networks';
import Tariffs from './screens/Tariffs';
import Routers from './screens/Routers';
import Tickets from './screens/Tickets';
import Payments from './screens/Payments';
import PaymentMethods from './screens/PaymentMethods';
import Settings from './screens/Settings';

/**
 * Screens fetched when first opened, not on every load.
 *
 * The whole app was one 604 kB bundle, so opening Clients also downloaded the
 * map library, the platform monitor and every screen a tenant may never touch.
 * On a phone on mobile data that is the difference between a slow app and a
 * usable one.
 *
 * What an operator uses hourly — clients, payments, routers — stays in the main
 * bundle: splitting those would trade a slow first load for a pause every time
 * they move between them.
 */
const Landing = lazy(() => import('./screens/Landing'));
const Hotspot = lazy(() => import('./screens/Hotspot'));
const Fup = lazy(() => import('./screens/Fup'));
const MapScreen = lazy(() => import('./screens/Map'));
const PlatformMonitor = lazy(() => import('./screens/PlatformMonitor'));
const Analytics = lazy(() => import('./screens/Analytics'));
const Leads = lazy(() => import('./screens/Leads'));
const Messaging = lazy(() => import('./screens/Messaging'));
const LiveSupport = lazy(() => import('./screens/LiveSupport'));
const Outages = lazy(() => import('./screens/Outages'));
const Sla = lazy(() => import('./screens/Sla'));
const KnowledgeBase = lazy(() => import('./screens/KnowledgeBase'));
const SiteProfiles = lazy(() => import('./screens/SiteProfiles'));
const Automation = lazy(() => import('./screens/Automation'));
const Tenants = lazy(() => import('./screens/Tenants'));
const SaasRevenue = lazy(() => import('./screens/SaasRevenue'));
const Staff = lazy(() => import('./screens/Staff'));

export default function App() {
  const { dark, session, signIn } = useStore();
  const isMobile = useMediaQuery('(max-width: 900px)');
  const { pathname } = useLocation();

  // Browser tab shows the tenant's own company, so someone running two ISPs in
  // two tabs can tell them apart.
  useEffect(() => {
    document.title = session?.company ? `${session.company} · Vibelink` : 'Vibelink';
  }, [session?.company]);

  // Customers get their own page, before any staff session is considered. It is
  // a different audience on the same hostname: no sidebar, no admin store, and a
  // cookie the admin routes do not accept. Checked first so a subscriber never
  // sees the staff sign-in card.
  if (pathname.startsWith('/customer')) return <CustomerPortal />;

  // undefined = the session check has not come back yet. Rendering nothing for
  // that tick avoids flashing the sign-in card at an already-authenticated user.
  if (session === undefined) return null;

  /**
   * The platform's own domain is the marketing site, not a portal.
   *
   * Nobody's customers live here, so there is nothing to sign into: an ISP
   * registers on this domain once and works on their own subdomain every day
   * after. Showing a sign-in card here would reject everyone who tried it.
   */
  if (session === null && isPlatformHost()) {
    if (pathname === '/signup' || pathname === '/register') {
      return <AuthGate onSignedIn={signIn} only="signup" />;
    }
    return (
      <Suspense fallback={null}>
        <Landing onRegister={() => { window.location.href = '/signup'; }} />
      </Suspense>
    );
  }

  // A tenant's own subdomain: sign in only. Registering a second account from
  // inside a working portal splits an operator's customers across two of them.
  if (session === null) return <AuthGate onSignedIn={signIn} only="login" />;

  return (
    // `om-dark` is the mockup's rootClass: it inverts the whole tree, and
    // global.css inverts media back so photos stay right side up.
    <div
      className={dark ? 'om-dark' : undefined}
      style={{
        display: 'flex',
        minHeight: '100vh',
        fontFamily: font.sans,
        color: color.ink,
      }}
    >
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        {/* 26px of padding either side costs a seventh of a 375px screen, and the
            content is what people came for. Tables and wide cards scroll inside
            themselves rather than pushing the page sideways. */}
        <div
          style={{
            padding: isMobile ? '14px 12px' : 26,
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? 14 : 20,
            minWidth: 0,
            overflowX: 'hidden',
          }}
        >
          {/* Lazy screens need this or a route renders nothing while its chunk
              downloads. Deliberately blank rather than a spinner: on a fast
              connection the chunk arrives in a frame or two and a spinner that
              flashes reads as jank. */}
          <Suspense fallback={null}>
            <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/new" element={<AddClient />} />
            <Route path="/hotspot/*" element={<Hotspot />} />
            <Route path="/networks" element={<Networks />} />
            <Route path="/tariffs" element={<Tariffs />} />
            <Route path="/fair-use" element={<Fup />} />
            <Route path="/routers" element={<Routers />} />
            <Route path="/map" element={<MapScreen />} />
            <Route path="/platform" element={<PlatformMonitor />} />
            <Route path="/analytics" element={<Analytics />} />

            <Route path="/tickets" element={<Tickets />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/messaging" element={<Messaging />} />
            <Route path="/live-support" element={<LiveSupport />} />
            <Route path="/outages" element={<Outages />} />
            <Route path="/sla" element={<Sla />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />

            <Route path="/payments" element={<Payments />} />
            <Route path="/payment-methods" element={<PaymentMethods />} />
            <Route path="/site-profiles" element={<SiteProfiles />} />
            <Route path="/automation" element={<Automation />} />

            <Route path="/tenants" element={<Tenants />} />
            <Route path="/saas-revenue" element={<SaasRevenue />} />

            <Route path="/staff" element={<Staff />} />
            <Route path="/settings" element={<Settings />} />

            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      <Toast />
    </div>
  );
}
