import React, { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Sidebar from './app/Sidebar';
import Topbar from './app/Topbar';
import Toast from './app/Toast';
import AuthGate from './app/AuthGate';
import { useMediaQuery } from './app/useMediaQuery';
import { useStore } from './state/store';
import { color, font } from './theme/tokens';

import Dashboard from './screens/Dashboard';
import Clients from './screens/Clients';
import AddClient from './screens/AddClient';
import Hotspot from './screens/Hotspot';
import Networks from './screens/Networks';
import Tariffs from './screens/Tariffs';
import Fup from './screens/Fup';
import Routers from './screens/Routers';
import Analytics from './screens/Analytics';
import Tickets from './screens/Tickets';
import Leads from './screens/Leads';
import Messaging from './screens/Messaging';
import LiveSupport from './screens/LiveSupport';
import Outages from './screens/Outages';
import Sla from './screens/Sla';
import KnowledgeBase from './screens/KnowledgeBase';
import Payments from './screens/Payments';
import PaymentMethods from './screens/PaymentMethods';
import SiteProfiles from './screens/SiteProfiles';
import Automation from './screens/Automation';
import Tenants from './screens/Tenants';
import SaasRevenue from './screens/SaasRevenue';
import Staff from './screens/Staff';
import Settings from './screens/Settings';

export default function App() {
  const { dark, session, signIn } = useStore();
  const isMobile = useMediaQuery('(max-width: 900px)');

  // Browser tab shows the tenant's own company, so someone running two ISPs in
  // two tabs can tell them apart.
  useEffect(() => {
    document.title = session?.company ? `${session.company} · Vibelink` : 'Vibelink';
  }, [session?.company]);

  // undefined = the session check has not come back yet. Rendering nothing for
  // that tick avoids flashing the sign-in card at an already-authenticated user.
  if (session === undefined) return null;
  if (session === null) return <AuthGate onSignedIn={signIn} />;

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
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/new" element={<AddClient />} />
            <Route path="/hotspot/*" element={<Hotspot />} />
            <Route path="/networks" element={<Networks />} />
            <Route path="/tariffs" element={<Tariffs />} />
            <Route path="/fair-use" element={<Fup />} />
            <Route path="/routers" element={<Routers />} />
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
        </div>
      </main>
      <Toast />
    </div>
  );
}
