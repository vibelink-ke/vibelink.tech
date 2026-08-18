import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { Button, Card, Empty, Screen } from '../ui/primitives';

/**
 * Where the customers and towers actually are.
 *
 * Leaflet is bundled rather than pulled from a CDN: this app is often opened on
 * a phone in a van with one bar of signal, and a map that fails to load because
 * unpkg is slow is worse than no map. Tiles still come from OpenStreetMap —
 * there is no way around fetching those — so the map degrades to empty squares
 * with the pins still in the right places when the connection is poor.
 *
 * Leaflet's default marker icons are PNGs it builds a URL for at runtime, which
 * a bundler rewrites into something that 404s. Divs styled as dots avoid that
 * entirely and let a customer's status carry a colour.
 */

const STATUS_COLOUR = {
  active: color.green,
  grace: color.amber,
  expired: '#c05a2e',
  paused: color.amberInk,
  suspended: color.rust,
};

const dot = (fill, ring) => L.divIcon({
  className: '',
  html: `<span style="display:block;width:13px;height:13px;border-radius:50%;
          background:${fill};border:2px solid ${ring};
          box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>`,
  iconSize: [13, 13],
  iconAnchor: [7, 7],
});

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export default function MapScreen() {
  const store = useStore();
  const holder = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  /**
   * Live view: refresh the pins, and colour by who is connected right now.
   *
   * The map drew whatever the store happened to hold, so it aged as soon as it
   * was opened. On a wall screen during an outage the useful question is which
   * pins have gone dark, and that only works if it keeps up.
   */
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!live) return undefined;
    const tick = () => store.reload?.();
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [live, store]);

  const clients = store.clients ?? [];
  const routers = store.routers ?? [];

  // Only rows that have somewhere to be drawn. Everything else is listed below
  // the map instead, because "42 clients have no location" is the actionable
  // fact — invisible omissions are how a map quietly stops being trusted.
  const placed = useMemo(
    () => clients
      .map((c) => ({ ...c, _lat: num(c.lat), _lng: num(c.lng) }))
      .filter((c) => c._lat !== null && c._lng !== null),
    [clients],
  );
  const placedRouters = useMemo(
    () => routers
      .map((r) => ({ ...r, _lat: num(r.lat), _lng: num(r.lng) }))
      .filter((r) => r._lat !== null && r._lng !== null),
    [routers],
  );
  const missing = clients.length - placed.length;

  useEffect(() => {
    if (!holder.current || map.current) return;
    map.current = L.map(holder.current, { scrollWheelZoom: false })
      .setView([-1.2921, 36.8219], 6);   // Kenya, until there is anything to fit

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });
    tiles.on('tileerror', () => setTilesFailed(true));
    tiles.addTo(map.current);

    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();

    for (const r of placedRouters) {
      L.marker([r._lat, r._lng], { icon: dot(color.ink, '#fff') })
        .bindPopup(`<strong>${r.name}</strong><br>Tower`)
        .addTo(layer.current);
    }
    for (const c of placed) {
      // In live view the question is who is connected, not who has paid.
      const fill = live
        ? (c.online ? color.green : '#9aa39c')
        : (STATUS_COLOUR[c.status] ?? color.muted);
      L.marker([c._lat, c._lng], { icon: dot(fill, '#fff') })
        .bindPopup(
          `<strong>${c.name}</strong><br>${c.account_code ?? ''}<br>`
          + `${c.location ?? ''}<br>${c.status ?? ''}`)
        .addTo(layer.current);
    }

    // Frame everything there is. Without this a single distant tower leaves the
    // customers off screen at a zoom nobody chose.
    const points = [...placed, ...placedRouters].map((p) => [p._lat, p._lng]);
    if (points.length === 1) map.current.setView(points[0], 15);
    else if (points.length > 1) map.current.fitBounds(points, { padding: [40, 40] });
  }, [placed, placedRouters, live]);

  return (
    <Screen
      title="Map"
      subtitle="Customers and towers, from the location saved when each was added"
      actions={
        <Button
          variant={live ? 'primary' : undefined}
          onClick={() => setLive((v) => !v)}
          title="Refresh every 30 seconds and colour by who is connected"
        >
          {live ? 'Live · on' : 'Live view'}
        </Button>
      }
    >
      {tilesFailed && (
        <div style={{
          fontSize: 12.5, color: color.amberInk, background: color.amberBg,
          border: '1px solid #ecd9a8', borderRadius: radius.md, padding: '10px 13px', marginBottom: 12,
        }}>
          Map tiles could not be loaded, so the background is blank. The pins are
          still in the right places.
        </div>
      )}

      <Card>
        <div
          ref={holder}
          style={{ height: 460, width: '100%', borderRadius: radius.md, background: color.tileBg }}
        />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5, color: color.muted }}>
          <span><b style={{ color: color.green }}>●</b> active</span>
          <span><b style={{ color: color.amber }}>●</b> grace</span>
          <span><b style={{ color: '#c05a2e' }}>●</b> expired</span>
          <span><b style={{ color: color.rust }}>●</b> suspended</span>
          <span><b style={{ color: color.ink }}>●</b> tower</span>
          <span style={{ marginLeft: 'auto', fontFamily: font.mono }}>
            {placed.length} of {clients.length} clients placed
          </span>
        </div>
      </Card>

      {missing > 0 && (
        <Card title="No location saved" subtitle="Add one from the client's page so a technician can be sent">
          {clients.length === placed.length ? <Empty text="Everyone is on the map" /> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {clients.filter((c) => num(c.lat) === null || num(c.lng) === null).slice(0, 60).map((c) => (
                <span
                  key={c.id}
                  style={{
                    fontSize: 12.5, padding: '4px 9px', borderRadius: 999,
                    background: color.tileBg, border: `1px solid ${color.line}`,
                  }}
                >
                  {c.name}
                </span>
              ))}
              {missing > 60 && (
                <span style={{ fontSize: 12.5, color: color.muted, alignSelf: 'center' }}>
                  and {missing - 60} more
                </span>
              )}
            </div>
          )}
        </Card>
      )}
    </Screen>
  );
}
