import React from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { Button } from '../ui/primitives';
import Toast from '../app/Toast';
import Licence from './Licence';

/**
 * What a signed-in tenant sees once their licence has expired: nothing but this.
 * No menu, no dashboard, not even read-only — just what is owed and how to pay
 * it, and a way to sign out. Their customers and hotspot visitors are unaffected
 * (the page says so); only the staff dashboard is locked.
 */
export default function LicenceLocked() {
  const store = useStore();
  return (
    <div
      className={store.dark ? 'om-dark' : undefined}
      style={{ minHeight: '100vh', background: color.pageBg, color: color.ink, fontFamily: font.sans }}
    >
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        padding: '14px 26px', borderBottom: `1px solid ${color.line}`, background: color.cardBg,
      }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{store.session?.company ?? 'Vibelink'}</span>
        <Button onClick={() => store.signOut()}>Sign out</Button>
      </header>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 26 }}>
        <Licence />
      </div>
      <Toast />
    </div>
  );
}
