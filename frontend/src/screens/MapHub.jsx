import React, { useState } from 'react';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import MapScreen from './Map';
import SkyPlanMap from './SkyPlanMap';

const KEY = 'vibelink:map-tab';

/**
 * The Map page. For an ISP that has SkyPlan switched on it opens SkyPlan (the network planner) with the classic map
 * one tab away — the classic one still carries the live online/offline colours. Everyone else gets the classic map.
 */
export default function MapHub() {
  const store = useStore();
  const hasSky = !!store.session?.features?.skyplan;
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'skyplan'; } catch { return 'skyplan'; }
  });
  if (!hasSky) return <MapScreen />;

  const pick = (t) => {
    setTab(t);
    try { localStorage.setItem(KEY, t); } catch { /* not remembered */ }
  };
  const tabs = [['skyplan', 'Design (SkyPlan)'], ['classic', 'Live status (classic)']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 2, padding: 4, background: '#fff', border: `1px solid ${color.line}`, borderRadius: 10, alignSelf: 'flex-start' }}>
        {tabs.map(([key, label]) => (
          <span
            key={key}
            onClick={() => pick(key)}
            style={{
              padding: '7px 13px', borderRadius: 7, fontSize: 13, cursor: 'pointer',
              fontWeight: tab === key ? 600 : 500, background: tab === key ? '#e7f5ef' : 'transparent',
              color: tab === key ? color.green : color.neutralInk,
            }}
          >
            {label}
          </span>
        ))}
      </div>
      {tab === 'skyplan' ? <SkyPlanMap /> : <MapScreen />}
    </div>
  );
}
