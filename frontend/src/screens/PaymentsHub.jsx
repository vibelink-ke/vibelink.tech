import React from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import Payments from './Payments';
import SiteProfiles from './SiteProfiles';
import Expenses from './Expenses';

/**
 * Payments, Site payment profiles and Expenses together — the money coming in, where it is paid to, and the money
 * going out, on one page instead of three lines in the sidebar. Same shape as Work.jsx: absolute tab paths, each tab
 * still its own full screen underneath.
 */
export default function PaymentsHub() {
  const store = useStore();
  const pending = (store.expenses ?? []).filter((e) => e.status === 'pending').length;
  const unmatched = (store.unmatched ?? []).length;
  const tabs = [
    { to: '/payments', label: 'Payments', end: true, badge: unmatched },
    { to: '/payments/sites', label: 'Site payment profiles', perm: 'site_profiles.view' },
    { to: '/payments/expenses', label: 'Expenses', badge: pending },
  ].filter((t) => !t.perm || store.session?.perms?.[t.perm]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div
        style={{
          display: 'flex', gap: 2, padding: 4, background: '#fff', border: `1px solid ${color.line}`,
          borderRadius: 10, alignSelf: 'flex-start', flexWrap: 'wrap',
        }}
      >
        {tabs.map((t) => (
          <NavLink key={t.label} to={t.to} end={t.end} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <span
                style={{
                  display: 'inline-block', padding: '7px 13px', borderRadius: 7, fontSize: 13,
                  fontWeight: isActive ? 600 : 500, background: isActive ? '#e7f5ef' : 'transparent',
                  color: isActive ? color.green : color.neutralInk,
                }}
              >
                {t.label}{t.badge ? ` · ${t.badge}` : ''}
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <Routes>
        <Route index element={<Payments />} />
        <Route path="sites" element={<SiteProfiles />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="*" element={<Navigate to="/payments" replace />} />
      </Routes>
    </div>
  );
}
