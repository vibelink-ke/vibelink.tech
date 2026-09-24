import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { color, radius } from '../theme/tokens';
import { api } from '../api/client';
import { Badge, Card, Empty, Screen } from '../ui/primitives';

const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/**
 * Where the field team is right now. Only technicians on a shift appear, and only from what their
 * phone last reported; ending a shift removes them. The last twelve hours of a person's route can be
 * drawn from the list.
 */
export default function FieldTeam() {
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');
  const [trailFor, setTrailFor] = useState(null);
  const holder = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const trailLayer = useRef(null);

  useEffect(() => {
    const load = () => api.fieldTeam().then((t) => { setTeam(t); setError(''); }).catch((e) => setError(e.message));
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!holder.current || map.current) return undefined;
    map.current = L.map(holder.current, { scrollWheelZoom: true }).setView([-0.3, 36.1], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    trailLayer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current || !team) return;
    layer.current.clearLayers();
    const pts = [];
    for (const m of team) {
      if (m.lat == null) continue;
      pts.push([m.lat, m.lng]);
      L.circleMarker([m.lat, m.lng], { radius: 9, color: '#1f6f43', fillColor: '#2f9e5b', fillOpacity: 0.9, weight: 2 })
        .bindTooltip(`${m.name}${m.ticket_number ? ` · ${m.ticket_number}` : ''}`, { permanent: true, direction: 'top', offset: [0, -6] })
        .addTo(layer.current);
    }
    if (pts.length) map.current.fitBounds(pts, { maxZoom: 15, padding: [40, 40] });
  }, [team]);

  useEffect(() => {
    if (!trailLayer.current) return;
    trailLayer.current.clearLayers();
    if (!trailFor) return;
    api.fieldTrail(trailFor).then((pts) => {
      if (!pts.length || !trailLayer.current) return;
      L.polyline(pts.map((p) => [p.lat, p.lng]), { color: '#4c8dff', weight: 4, opacity: 0.8 }).addTo(trailLayer.current);
    }).catch(() => {});
  }, [trailFor]);

  return (
    <Screen title="Field team" subtitle="Technicians on shift, from their phones. Ending a shift removes them.">
      {error && <Card><span style={{ color: color.rust }}>{error}</span></Card>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
        <div ref={holder} style={{ height: 420, borderRadius: radius.lg, overflow: 'hidden', border: `1px solid ${color.line}` }} />
        <Card title="On shift now">
          {team === null ? <span style={{ color: color.muted }}>Loading…</span>
            : !team.length ? <Empty>Nobody is on shift.</Empty>
              : team.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: `1px solid ${color.line}`, fontSize: 13.5, flexWrap: 'wrap' }}>
                  <span><b>{m.name}</b>{m.ticket_number ? ` · at ${m.ticket_number} ${m.ticket_subject ?? ''}` : ''}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {m.seen_at ? <Badge tone={Date.now() - new Date(m.seen_at).getTime() < 5 * 60000 ? 'green' : 'amber'}>{ago(m.seen_at)}</Badge> : <Badge tone="neutral">no location yet</Badge>}
                    <span onClick={() => setTrailFor(trailFor === m.id ? null : m.id)} style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }}>
                      {trailFor === m.id ? 'Hide route' : 'Show route'}
                    </span>
                  </span>
                </div>
              ))}
        </Card>
      </div>
    </Screen>
  );
}
