import React from 'react';
import { color, font, radius } from '../../theme/tokens';

/** Shared bits of the technician app: big touch targets, one column, nothing that needs a mouse. */

export const page = {
  padding: '14px 14px 96px', display: 'flex', flexDirection: 'column', gap: 12,
  maxWidth: 560, margin: '0 auto', width: '100%', boxSizing: 'border-box',
};

export const panel = {
  background: '#fff', border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: 14,
  display: 'flex', flexDirection: 'column', gap: 10,
};

export function Btn({ children, onClick, href, tone = 'primary', disabled, busy, style, type = 'button' }) {
  const tones = {
    primary: { background: color.green, color: '#fff', border: `1px solid ${color.green}` },
    quiet: { background: '#fff', color: color.ink, border: `1px solid ${color.line}` },
    danger: { background: '#fff', color: color.rust, border: `1px solid ${color.rust}` },
  };
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46,
    padding: '0 16px', borderRadius: radius.md, fontSize: 15, fontWeight: 600, fontFamily: font.sans,
    textDecoration: 'none', cursor: disabled || busy ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    boxSizing: 'border-box', ...tones[tone], ...style,
  };
  if (href) return <a href={href} style={base} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a>;
  return <button type={type} onClick={disabled || busy ? undefined : onClick} style={base}>{busy ? 'Please wait…' : children}</button>;
}

export function Chip({ children, tone = 'neutral' }) {
  const tones = {
    neutral: { background: '#eef0ec', color: '#4a524c' },
    green: { background: '#e2ebe5', color: color.green },
    amber: { background: '#fbf0d9', color: color.amberInk },
    red: { background: '#f9e4df', color: color.rust },
    blue: { background: '#e3ecfb', color: '#2f5fb3' },
  };
  return (
    <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 600, ...tones[tone] }}>
      {children}
    </span>
  );
}

export const Dot = ({ on }) => (
  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: on ? '#2f9e5b' : '#b7bdb8', marginRight: 6 }} />
);

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const prettyKm = (km) => (km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

export const mapsLink = (lat, lng, text) => (lat != null && lng != null
  ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  : text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null);

/** One reading of where the phone is now. Rejects when the person says no, or there is no signal. */
export function getPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone cannot share its location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.message || 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000, ...opts });
  });
}

/**
 * A photo from the camera, shrunk before it is sent: a modern phone photo is 4 to 10 MB, which on a
 * site with one bar of signal never arrives. Longest side 1280 px, JPEG. The orientation the phone
 * recorded is applied, so it is not sent sideways.
 */
export async function resizePhoto(file, maxSide = 1280, quality = 0.72) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That photo could not be read.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width; const h = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
