import React from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import Leads from './Leads';
import FieldTech from './FieldTech';
import FieldSales from './FieldSales';
import TeamJobs from './TeamJobs';

/**
 * Leads, My jobs and Team jobs together — one place for "who's chasing a sale" and "who's doing the work", rather
 * than three separate lines in the sidebar. Same shape as Hotspot.jsx: absolute tab paths (see its own comment on
 * why relative ones break inside a route matched by a wildcard), each tab still its own full screen underneath.
 *
 * "My leads" is a sales rep's own equivalent of "My jobs" — mobile-first, filtered to their own assignments.
 * Gated on leads.edit (not a new permission): everything this tab does — moving a lead's stage, adding a note,
 * creating one — is exactly what leads.edit already governs on the office-side Leads screen above, so a second
 * "can they see this tab" flag would just duplicate that matrix entry rather than mean anything of its own.
 */
const TABS = [
  { to: '/work', label: 'Leads', end: true },
  { to: '/work/my-jobs', label: 'My jobs' },
  { to: '/work/my-leads', label: 'My leads', perm: 'leads.edit' },
  { to: '/work/team-jobs', label: 'Team jobs', perm: 'tickets.view_team' },
];

export default function Work() {
  const store = useStore();
  const tabs = TABS.filter((t) => !t.perm || store.session?.perms?.[t.perm]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
        {tabs.map((t) => (
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
        <Route index element={<Leads />} />
        <Route path="my-jobs" element={<FieldTech />} />
        <Route path="my-leads" element={<FieldSales />} />
        <Route path="team-jobs" element={<TeamJobs />} />
        {/* Absolute for the same reason the tabs above are — recovers a URL stuck on a bad relative path. */}
        <Route path="*" element={<Navigate to="/work" replace />} />
      </Routes>
    </div>
  );
}
