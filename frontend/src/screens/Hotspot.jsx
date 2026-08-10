import React from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { color, radius } from '../theme/tokens';
import HotspotDashboard from './hotspot/HotspotDashboard';
import HotspotPlans from './hotspot/HotspotPlans';
import Vouchers from './hotspot/Vouchers';
import PortalDesign from './hotspot/PortalDesign';
import HotspotRevenue from './hotspot/HotspotRevenue';
import HotspotSettings from './hotspot/HotspotSettings';

const TABS = [
  { to: '', label: 'Dashboard', end: true },
  { to: 'plans', label: 'Plans' },
  { to: 'vouchers', label: 'Vouchers' },
  { to: 'design', label: 'Portal design' },
  { to: 'revenue', label: 'Revenue' },
  { to: 'settings', label: 'Settings' },
];

export default function Hotspot() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>Hotspot</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: color.neutralInk }}>
          Pay-as-you-go WiFi: captive portal, bundles and voucher codes.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 2,
          padding: 4,
          background: '#fff',
          border: `1px solid ${color.line}`,
          borderRadius: 10,
          alignSelf: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        {TABS.map((t) => (
          <NavLink key={t.label} to={t.to} end={t.end} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <span
                style={{
                  display: 'inline-block',
                  padding: '7px 13px',
                  borderRadius: 7,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  background: isActive ? '#e7f5ef' : 'transparent',
                  color: isActive ? color.green : color.neutralInk,
                }}
              >
                {t.label}
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <Routes>
        <Route index element={<HotspotDashboard />} />
        <Route path="plans" element={<HotspotPlans />} />
        <Route path="vouchers" element={<Vouchers />} />
        <Route path="design" element={<PortalDesign />} />
        <Route path="revenue" element={<HotspotRevenue />} />
        <Route path="settings" element={<HotspotSettings />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  );
}
