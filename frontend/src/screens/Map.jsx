import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Empty, Field, Input, Modal, Screen, Select } from '../ui/primitives';

/**
 * Where the customers, towers and the network between them actually are.
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
 *
 * Three things live here:
 *   - customers and routers, from the locations saved when each was added
 *   - which routers (hotspot or PPPoE) and which watched radios have gone offline, and since when
 *   - the operator's own network, drawn by hand: fibre (OLT, splitters, closures,
 *     drops and the cable between them) and wireless (each access point, backhaul
 *     radio and station, and the links between them)
 */

const STATUS_COLOUR = {
  active: color.green,
  grace: color.amber,
  expired: '#c05a2e',
  paused: color.amberInk,
  suspended: color.rust,
};

/**
 * Free Esri imagery has gaps: where a zoom level has no photograph it serves a grey
 * "Map data not yet available" square. So before drawing, the map asks which is the
 * closest zoom that really exists at the spot being looked at (a real tile is well over
 * 3 KB, the grey one about 2.5 KB) and stretches the last real level beyond that.
 * A keyed provider (see /api/map-config) needs none of this.
 */
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_MAX_ZOOM = 21;
const REAL_TILE_BYTES = 3000;

const FIBRE = '#1f6fd1';
const WIRELESS = '#8a4fd0';

/** What can be placed, and the extra facts worth keeping about each. */
const KINDS = {
  olt:      { label: 'OLT',             group: 'fibre',    letter: 'O', fill: FIBRE,    fields: [['model', 'Model'], ['ports', 'PON ports']] },
  splitter: { label: 'Splitter',        group: 'fibre',    letter: 'S', fill: FIBRE,    fields: [['ratio', 'Split ratio (e.g. 1:8)']] },
  closure:  { label: 'Closure / joint', group: 'fibre',    letter: 'C', fill: FIBRE,    fields: [['note', 'Note']] },
  onu:      { label: 'ONU / drop',      group: 'fibre',    letter: 'U', fill: FIBRE,    fields: [['serial', 'Serial or customer']] },
  ap:       { label: 'Access point',    group: 'wireless', letter: 'A', fill: WIRELESS, fields: [['model', 'Model'], ['frequency', 'Frequency (GHz)'], ['ssid', 'SSID'], ['ip', 'IP address']] },
  ptp:      { label: 'Backhaul radio',  group: 'wireless', letter: 'P', fill: WIRELESS, fields: [['model', 'Model'], ['frequency', 'Frequency (GHz)'], ['ip', 'IP address']] },
  station:  { label: 'Station / CPE',   group: 'wireless', letter: 'R', fill: WIRELESS, fields: [['model', 'Model'], ['ip', 'IP address'], ['customer', 'Customer']] },
};
const LINK_FIELDS = {
  fibre: [['cores', 'Cores']],
  wireless: [['frequency', 'Frequency (GHz)'], ['signal', 'Signal (dBm)']],
};

/** "OLT" and "ONU / drop" keep their capitals mid-sentence; "Splitter" does not. */
const lc = (s) => (/^[A-Z]{2,}/.test(s) ? s : s.toLowerCase());

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dot = (fill, ring, extra = '') => L.divIcon({
  className: '',
  html: `<span class="${extra}" style="display:block;width:13px;height:13px;border-radius:50%;
          background:${fill};border:2px solid ${ring};
          box-shadow:0 0 0 1px rgba(0,0,0,.15)"></span>`,
  iconSize: [13, 13],
  iconAnchor: [7, 7],
});

const badge = (letter, fill, ring = '#fff', extra = '') => L.divIcon({
  className: '',
  html: `<span class="${extra}" style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;
          background:${fill};border:2px solid ${ring};color:#fff;font:700 11px/1 sans-serif;
          box-shadow:0 0 0 1px rgba(0,0,0,.2)">${letter}</span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** An ONU: a small diamond, coloured by state; one that is down pulses. */
const onuIcon = (status) => {
  const down = status !== 'online';
  const fill = status === 'online' ? color.green : status === 'power_fail' ? color.amber : color.rust;
  return L.divIcon({
    className: '',
    html: `<span class="${down ? 'vl-pulse' : ''}" style="display:block;width:10px;height:10px;transform:rotate(45deg);
            background:${fill};border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2)"></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Is this actually a real position, or a placeholder that just happens to parse as a number? 0,0 is Null Island —
 * a point in the Gulf of Guinea, nowhere near any tenant this platform serves — and it is exactly what a lat/lng
 * pair reads as when it was never really set (an unset column, or a form field left blank and coerced to 0). A
 * client or router "at" 0,0 used to render there and drag the map's auto-fit out to include it, opening the map
 * on a view of the whole of Africa instead of the area anyone actually works in.
 */
const hasCoords = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

/** Metres along a line of [lat, lng] points. */
const lengthM = (pts) => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i]));
  return total;
};
const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

const ago = (iso) => {
  if (!iso) return 'a while ago';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
  return `${Math.floor(mins / 1440)} d ago`;
};

export default function MapScreen() {
  const store = useStore();
  const holder = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const canEdit = !!store.session?.perms?.['network.edit'];

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

  // Router status is worth knowing the moment it changes, live view or not.
  useEffect(() => {
    const tick = () => { if (!document.hidden) api.routers().then((rs) => store.setCollection('routers', rs)).catch(() => {}); };
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clients = store.clients ?? [];
  const routers = store.routers ?? [];

  // ── the drawn network ──
  const [net, setNet] = useState({ nodes: [], links: [] });
  const loadNet = useCallback(() => api.network().then(setNet).catch(() => {}), []);
  useEffect(() => { loadNet(); }, [loadNet]);

  // ONUs from SmartOLT, for tenants who have it: a layer, and a count of how many are down.
  const hasSmartOlt = !!store.session?.features?.smartolt && !!store.session?.perms?.['smartolt.view'];
  const [onus, setOnus] = useState([]);
  useEffect(() => {
    if (!hasSmartOlt) return undefined;
    const load = () => api.smartoltMap().then(setOnus).catch(() => {});
    load();   // the first read regardless of tab visibility; only the repeats wait for the tab to be showing
    const id = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(id);
  }, [hasSmartOlt]);
  const onusDown = onus.filter((o) => o.status !== 'online');

  const [show, setShow] = useState({ clients: true, routers: true, network: true, onus: true });
  const [editMode, setEditMode] = useState(false);
  // What a click on the map does next: place a node, or build a link ({ from, path }).
  const [tool, setTool] = useState(null);
  const [selected, setSelected] = useState(null);        // { type: 'node' | 'link', id }
  const [nodeForm, setNodeForm] = useState(null);        // a node being placed
  const [linkForm, setLinkForm] = useState(null);        // a link being finished
  const [busy, setBusy] = useState(false);

  const toolRef = useRef(null);
  toolRef.current = editMode ? tool : null;

  // Only rows that have somewhere to be drawn. Everything else is listed below
  // the map instead, because "42 clients have no location" is the actionable
  // fact — invisible omissions are how a map quietly stops being trusted.
  const placed = useMemo(
    () => clients
      .map((c) => ({ ...c, _lat: num(c.lat), _lng: num(c.lng) }))
      .filter((c) => hasCoords(c._lat, c._lng)),
    [clients],
  );
  const placedRouters = useMemo(
    () => routers
      .map((r) => ({ ...r, _lat: num(r.lat), _lng: num(r.lng) }))
      .filter((r) => hasCoords(r._lat, r._lng)),
    [routers],
  );
  const missing = clients.length - placed.length;
  const offline = routers.filter((r) => r.status === 'down');
  const offlineRadios = net.nodes.filter((n) => n.status === 'down');

  /** [lat, lng] for a link end: 'n:<id>' is a drawn node, 'r:<id>' a router. */
  const posOf = useCallback((ref) => {
    const [kind, id] = String(ref).split(':');
    // 'p:<lat>,<lng>' — a free point on the map, where a cable simply starts or stops.
    if (kind === 'p') {
      const [la, ln] = String(id ?? '').split(',').map(Number);
      return Number.isFinite(la) && Number.isFinite(ln) ? [la, ln] : null;
    }
    if (kind === 'n') {
      const n = net.nodes.find((x) => x.id === id);
      return n ? [Number(n.lat), Number(n.lng)] : null;
    }
    const r = placedRouters.find((x) => x.id === id);
    return r ? [r._lat, r._lng] : null;
  }, [net.nodes, placedRouters]);

  const nameOf = useCallback((ref) => {
    const [kind, id] = String(ref).split(':');
    if (kind === 'p') return 'a point on the map';
    if (kind === 'n') return net.nodes.find((x) => x.id === id)?.name ?? 'removed';
    return routers.find((x) => x.id === id)?.name ?? 'removed';
  }, [net.nodes, routers]);

  const isDown = useCallback((ref) => {
    const [kind, id] = String(ref).split(':');
    if (kind === 'r') return routers.find((x) => x.id === id)?.status === 'down';
    return net.nodes.find((x) => x.id === id)?.status === 'down';
  }, [routers, net.nodes]);

  useEffect(() => {
    if (!holder.current || map.current) return;
    // Wheel and touch both work directly: scroll to zoom, drag to pan, pinch on a phone.
    map.current = L.map(holder.current, {
      scrollWheelZoom: true, touchZoom: true, dragging: true, doubleClickZoom: true,
    }).setView([-1.2921, 36.8219], 6);   // Kenya, until there is anything to fit

    layer.current = L.layerGroup().addTo(map.current);

    // A click on empty map: place a node, or add a waypoint to the cable being drawn.
    map.current.on('click', (e) => {
      const t = toolRef.current;
      if (!t) return;
      if (t.type === 'node') {
        setNodeForm({ kind: t.kind, lat: e.latlng.lat, lng: e.latlng.lng, name: '', details: {}, watchRouterId: '' });
      } else if (t.type === 'link') {
        const pt = [e.latlng.lat, e.latlng.lng];
        setTool((cur) => {
          if (!cur || cur.type !== 'link') return cur;
          if (cur.from) return { ...cur, path: [...cur.path, pt] };
          return { ...cur, from: `p:${pt[0].toFixed(6)},${pt[1].toFixed(6)}` };   // starts on open ground
        });
      }
    });
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Street map or satellite. The choice is remembered.
  const [base, setBase] = useState(() => {
    try { return localStorage.getItem('vibelink:map-base') === 'satellite' ? 'satellite' : 'street'; } catch { return 'street'; }
  });
  const chooseBase = (b) => {
    setBase(b);
    try { localStorage.setItem('vibelink:map-base', b); } catch { /* not remembered */ }
  };
  // A keyed satellite provider, when the server has one; otherwise the free imagery.
  const [mapCfg, setMapCfg] = useState(null);
  useEffect(() => { api.mapConfig().then(setMapCfg).catch(() => setMapCfg({ satellite: null })); }, []);
  const tilesRef = useRef([]);
  useEffect(() => {
    if (!map.current) return undefined;
    tilesRef.current.forEach((t) => t.remove());
    map.current.setMaxZoom(base === 'satellite' ? SAT_MAX_ZOOM : 19);
    const sat = mapCfg?.satellite;
    const labels = () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: SAT_MAX_ZOOM, maxNativeZoom: 16,
    });
    let layers;
    if (base !== 'satellite') {
      layers = [L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' })];
    } else if (sat) {
      layers = [L.tileLayer(sat.url, { maxZoom: SAT_MAX_ZOOM, maxNativeZoom: sat.maxNativeZoom ?? 20, attribution: sat.attribution }), ...(sat.labels ? [labels()] : [])];
    } else {
      layers = [
        L.tileLayer(ESRI_IMAGERY, {
          maxZoom: SAT_MAX_ZOOM, maxNativeZoom: 19,
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
        }),
        labels(),   // place names over the imagery, so it still says where things are
      ];
    }
    layers.forEach((t, i) => {
      t.on('tileerror', () => setTilesFailed(true));
      t.addTo(map.current);
      if (i === 0) t.bringToBack();
    });
    tilesRef.current = layers;

    // Free imagery only: find the closest zoom that has a real photograph here, now and
    // whenever the map is moved somewhere else.
    if (base !== 'satellite' || sat) return undefined;
    let timer;
    const seen = new Map();
    const probe = async () => {
      const m = map.current;
      if (!m) return;
      const c = m.getCenter();
      for (let z = 19; z >= 13; z--) {
        const p = m.project(c, z).divideBy(256).floor();
        const url = ESRI_IMAGERY.replace('{z}', z).replace('{y}', p.y).replace('{x}', p.x);
        let real = seen.get(url);
        if (real === undefined) {
          try { real = (await (await fetch(url)).blob()).size > REAL_TILE_BYTES; } catch { return; }
          seen.set(url, real);
        }
        if (real) {
          if (layers[0].options.maxNativeZoom !== z) { layers[0].options.maxNativeZoom = z; layers[0].redraw(); }
          return;
        }
      }
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(probe, 600); };
    probe();
    map.current.on('moveend', soon);
    return () => { clearTimeout(timer); map.current?.off('moveend', soon); };
  }, [base, mapCfg]);

  // Scroll-to-zoom is on for looking around, and off while editing so the page below the
  // map (the forms, the lists) can still be scrolled to. The buttons and pinch still zoom.
  const [wheel, setWheel] = useState(true);
  useEffect(() => {
    if (!map.current) return;
    if (wheel) map.current.scrollWheelZoom.enable(); else map.current.scrollWheelZoom.disable();
  }, [wheel]);

  /** A click on something that can be a link end (a drawn node or a router). */
  const endpointClick = useCallback((ref) => {
    const t = toolRef.current;
    if (!t || t.type !== 'link') return false;
    if (!t.from) {
      setTool({ ...t, from: ref });
    } else if (t.from !== ref) {
      setLinkForm({ kind: t.kind, from: t.from, to: ref, path: t.path, label: '', details: {} });
    }
    return true;
  }, []);

  const framed = useRef(false);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();

    if (show.network) {
      // Cables first, so the pins sit on top of them.
      for (const l of net.links) {
        const a = posOf(l.from_ref);
        const b = posOf(l.to_ref);
        if (!a || !b) continue;
        const pts = [a, ...(l.path ?? []), b];
        const broken = isDown(l.from_ref) || isDown(l.to_ref);
        const fibre = l.kind === 'fibre';
        const line = L.polyline(pts, {
          color: broken ? color.rust : (fibre ? FIBRE : WIRELESS),
          weight: selected?.type === 'link' && selected.id === l.id ? 6 : 3,
          dashArray: fibre ? undefined : '8 8',
          opacity: 0.9,
        }).addTo(layer.current);
        line.bindTooltip(
          `${fibre ? 'Fibre' : 'Wireless'}${l.label ? ` · ${esc(l.label)}` : ''}${fibre ? ` · ${fmtLen(lengthM(pts))}` : ''}${broken ? ' · a device on it is offline' : ''}`,
          { sticky: true });
        line.on('click', (e) => { L.DomEvent.stopPropagation(e); if (!toolRef.current) setSelected({ type: 'link', id: l.id }); });
      }

      // The cable being drawn right now.
      if (editMode && tool?.type === 'link' && tool.from) {
        const start = posOf(tool.from);
        if (start) {
          L.polyline([start, ...tool.path], { color: '#e08a00', weight: 3, dashArray: '2 8', interactive: false }).addTo(layer.current);
          for (const p of [start, ...tool.path]) {
            L.circleMarker(p, { radius: 5, color: '#e08a00', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(layer.current);
          }
        }
      }

      for (const n of net.nodes) {
        if (!hasCoords(Number(n.lat), Number(n.lng))) continue;   // never actually placed — nothing real to draw
        const k = KINDS[n.kind] ?? KINDS.closure;
        const ref = `n:${n.id}`;
        const down = n.status === 'down';
        const m = L.marker([Number(n.lat), Number(n.lng)], {
          icon: badge(k.letter, down ? color.rust : k.fill, tool?.from === ref ? '#e08a00' : '#fff', down ? 'vl-pulse' : ''),
          draggable: editMode && !tool,
          zIndexOffset: down ? 1500 : 800,
        }).addTo(layer.current);
        m.bindTooltip(`${esc(n.name)} · ${k.label}${down ? ` · OFFLINE since ${esc(ago(n.offline_since))}` : n.status === 'up' ? ' · online' : ''}`);
        m.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (!endpointClick(ref) && !toolRef.current) setSelected({ type: 'node', id: n.id });
        });
        m.on('dragend', async () => {
          const p = m.getLatLng();
          try {
            await api.updateNetNode(n.id, { lat: p.lat, lng: p.lng });
            setNet((cur) => ({ ...cur, nodes: cur.nodes.map((x) => (x.id === n.id ? { ...x, lat: p.lat, lng: p.lng } : x)) }));
          } catch (err) {
            store.toast(`Could not move it: ${err.message}`);
            loadNet();
          }
        });
      }
    }

    if (show.routers) {
      for (const r of placedRouters) {
        const down = r.status === 'down';
        const ref = `r:${r.id}`;
        const m = L.marker([r._lat, r._lng], {
          icon: down
            ? dot(color.rust, '#fff', 'vl-pulse')
            : dot(r.status === 'up' ? color.ink : '#9aa39c', tool?.from === ref ? '#e08a00' : '#fff'),
          zIndexOffset: down ? 1000 : 0,
        }).addTo(layer.current);
        m.bindPopup(
          `<strong>${esc(r.name)}</strong><br>${r.role === 'hotspot' ? 'Hotspot' : r.role === 'pppoe' ? 'PPPoE' : 'Hotspot + PPPoE'} router<br>`
          + (down ? `<b style="color:${color.rust}">Offline</b> — since ${esc(ago(r.offline_since ?? r.last_seen))}`
            : r.status === 'up' ? 'Online' : 'Status not known yet'));
        m.on('click', () => { if (endpointClick(`r:${r.id}`)) m.closePopup(); });
      }
    }

    if (show.onus && hasSmartOlt) {
      for (const o of onus) {
        L.marker([o.lat, o.lng], {
          icon: onuIcon(o.status), interactive: !(editMode && tool), zIndexOffset: o.status === 'online' ? -100 : 700,
        }).bindPopup(
          `<strong>${esc(o.name ?? o.sn)}</strong><br>ONU ${esc(o.sn)}<br>${esc(o.client_name ?? 'not linked to a client')}<br>`
          + `${o.status === 'online' ? 'Online' : `<b style="color:${color.rust}">${esc(o.status.replace('_', ' '))}</b>`}`
          + `${o.signal_dbm != null ? ` · ${esc(o.signal_dbm)} dBm` : ''}`).addTo(layer.current);
      }
    }

    if (show.clients) {
      for (const c of placed) {
        // In live view the question is who is connected, not who has paid.
        const fill = live
          ? (c.online ? color.green : '#9aa39c')
          : (STATUS_COLOUR[c.status] ?? color.muted);
        const m = L.marker([c._lat, c._lng], {
          icon: dot(fill, '#fff'),
          // A pin dropped in the wrong spot (a bad address, a guess that missed) is dragged
          // straight rather than re-typed — same edit-mode gate as network nodes, so it can't
          // happen by an accidental bump while just browsing the map.
          draggable: editMode && !tool,
          interactive: !(editMode && tool),
          zIndexOffset: -200,
        })
          .bindPopup(
            `<strong>${esc(c.name)}</strong><br>${esc(c.account_code)}<br>`
            + `${esc(c.location)}<br>${esc(c.status)}`)
          .addTo(layer.current);
        m.on('dragend', async () => {
          const p = m.getLatLng();
          try {
            await api.updateSubscriber(c.id, { lat: p.lat, lng: p.lng });
            store.setCollection('clients', (cs) => cs.map((x) => (x.id === c.id ? { ...x, lat: p.lat, lng: p.lng } : x)));
            store.toast(`${c.name}'s location updated`);
          } catch (err) {
            store.toast(`Could not move it: ${err.message}`);
            m.setLatLng([c._lat, c._lng]);   // snap back — the store never changed, so this is the truth
          }
        });
      }
    }

    // Frame everything there is, once. Without this a single distant tower leaves the
    // customers off screen at a zoom nobody chose — but re-framing on every edit would
    // yank the map away from whatever is being drawn.
    if (!framed.current) {
      const points = [...placed, ...placedRouters].map((p) => [p._lat, p._lng]);
      for (const n of net.nodes) {
        const [la, ln] = [Number(n.lat), Number(n.lng)];
        if (hasCoords(la, ln)) points.push([la, ln]);
      }
      if (points.length === 1) { map.current.setView(points[0], 15); framed.current = true; }
      else if (points.length > 1) { map.current.fitBounds(points, { padding: [40, 40] }); framed.current = true; }
      // Nothing real to fit to (every point was Null Island, or there is simply nothing placed yet) — stay on
      // the Kenya view the map already opened with, rather than sitting at whatever zoom was last set.
      else framed.current = true;
    }
  }, [placed, placedRouters, live, net, show, selected, tool, editMode, posOf, isDown, endpointClick, loadNet, store, onus, hasSmartOlt]);

  // ── editing ──
  const saveNode = async () => {
    if (!nodeForm.name.trim()) return store.toast('Give it a name');
    setBusy(true);
    try {
      await api.createNetNode({ kind: nodeForm.kind, name: nodeForm.name.trim(), lat: nodeForm.lat, lng: nodeForm.lng, details: nodeForm.details, watchRouterId: nodeForm.watchRouterId || null });
      setNodeForm(null);
      await loadNet();
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async () => {
    setBusy(true);
    try {
      await api.createNetLink({ kind: linkForm.kind, from: linkForm.from, to: linkForm.to, path: linkForm.path, label: linkForm.label.trim(), details: linkForm.details });
      setLinkForm(null);
      setTool(null);
      await loadNet();
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const sel = selected?.type === 'node'
    ? net.nodes.find((n) => n.id === selected.id)
    : selected?.type === 'link' ? net.links.find((l) => l.id === selected.id) : null;
  const [edit, setEdit] = useState(null);
  useEffect(() => {
    if (!sel) { setEdit(null); return; }
    setEdit({ name: sel.name ?? '', label: sel.label ?? '', details: { ...(sel.details ?? {}) }, watchRouterId: sel.watch_router_id ?? '' });
  }, [selected?.id, selected?.type]);    // eslint-disable-line react-hooks/exhaustive-deps

  const saveSelected = async () => {
    setBusy(true);
    try {
      if (selected.type === 'node') await api.updateNetNode(selected.id, { name: edit.name.trim(), details: edit.details, watchRouterId: edit.watchRouterId || null });
      else await api.updateNetLink(selected.id, { label: edit.label.trim(), details: edit.details });
      await loadNet();
      store.toast('Saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    const what = selected.type === 'node' ? `${sel.name} and every cable or link on it` : 'this link';
    if (!window.confirm(`Remove ${what}?`)) return;
    setBusy(true);
    try {
      if (selected.type === 'node') await api.deleteNetNode(selected.id);
      else await api.deleteNetLink(selected.id);
      setSelected(null);
      await loadNet();
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const fly = (r) => {
    const lat = num(r.lat); const lng = num(r.lng);
    if (lat === null || lng === null) return store.toast('That router has no location saved yet');
    map.current?.flyTo([lat, lng], 16);
  };

  // A radio with an IP address can be watched: the router chosen here pings it every minute.
  const hasIp = (kind) => (KINDS[kind]?.fields ?? []).some(([k]) => k === 'ip');
  const watchSelect = (kind, value, onChange) => hasIp(kind) && (
    <Field label="Watched from" hint="The router that pings this IP every minute — pick the one on the same network. Leave it as Not watched to skip.">
      <Select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        options={[{ value: '', label: 'Not watched' }, ...routers.map((r) => ({ value: r.id, label: r.name }))]}
      />
    </Field>
  );
  const statusOf = (n) => (n.status === 'down' ? `offline since ${ago(n.offline_since)}`
    : n.status === 'up' ? `online (last answered ${ago(n.last_seen)})`
      : n.watch_router_id ? 'waiting for the first check' : 'not watched');

  const fieldsFor = (list, values, setValues) => list.map(([key, label]) => (
    <Field key={key} label={label}>
      <Input value={values[key] ?? ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
    </Field>
  ));

  const finishCable = () => {
    if (!tool || tool.type !== 'link' || !tool.from) return;
    if (!tool.path.length) return store.toast('Click at least one more point along the route first');
    const last = tool.path[tool.path.length - 1];
    setLinkForm({
      kind: tool.kind, from: tool.from, to: `p:${last[0].toFixed(6)},${last[1].toFixed(6)}`,
      path: tool.path.slice(0, -1), label: '', details: {},
    });
  };
  const undoPoint = () => setTool((cur) => {
    if (!cur || cur.type !== 'link') return cur;
    return cur.path.length ? { ...cur, path: cur.path.slice(0, -1) } : { ...cur, from: null };
  });

  const toolHint = !tool ? null
    : tool.type === 'node' ? `Click the map where the ${lc(KINDS[tool.kind].label)} is.`
      : !tool.from ? 'Click the map where the cable starts — or click a node or router to start from it.'
        : `Click along the route (${tool.path.length} point${tool.path.length === 1 ? '' : 's'} so far). Click a node or router to end on it, or press Finish to end at the last point.`;

  return (
    <Screen
      title="Map"
      subtitle="Customers, towers and the network between them"
      actions={
        <>
          {canEdit && (
            <Button
              variant={editMode ? 'primary' : undefined}
              onClick={() => { setWheel(editMode); setEditMode((v) => !v); setTool(null); setSelected(null); }}
              title="Draw your fibre or wireless network on the map"
            >
              {editMode ? 'Editing network' : 'Edit network'}
            </Button>
          )}
          <Button
            variant={live ? 'primary' : undefined}
            onClick={() => setLive((v) => !v)}
            title="Refresh every 30 seconds and colour by who is connected"
          >
            {live ? 'Live · on' : 'Live view'}
          </Button>
        </>
      }
    >
      <style>{'@keyframes vlpulse{0%{box-shadow:0 0 0 0 rgba(192,57,43,.7)}100%{box-shadow:0 0 0 16px rgba(192,57,43,0)}}.vl-pulse{animation:vlpulse 1.4s infinite}'}</style>

      {offline.length + offlineRadios.length > 0 && (
        <div style={{
          fontSize: 13, color: color.rust, background: color.rustBg, border: `1px solid ${color.rust}`,
          borderRadius: radius.md, padding: '10px 13px', marginBottom: 12, fontWeight: 600,
        }}>
          {offline.length + offlineRadios.length} device{offline.length + offlineRadios.length === 1 ? '' : 's'} offline: {[...offline, ...offlineRadios].map((r) => r.name).join(', ')}
        </div>
      )}

      {onusDown.length > 0 && (
        <div style={{
          fontSize: 13, color: color.rust, background: color.rustBg, border: `1px solid ${color.rust}`,
          borderRadius: radius.md, padding: '10px 13px', marginBottom: 12, fontWeight: 600,
        }}>
          {onusDown.length} of {onus.length} ONU{onus.length === 1 ? '' : 's'} on the map {onusDown.length === 1 ? 'is' : 'are'} not online — see SmartOLT for the list
        </div>
      )}

      {tilesFailed && (
        <div style={{
          fontSize: 12.5, color: color.amberInk, background: color.amberBg,
          border: '1px solid #ecd9a8', borderRadius: radius.md, padding: '10px 13px', marginBottom: 12,
        }}>
          Map tiles could not be loaded, so the background is blank. The pins are
          still in the right places.
        </div>
      )}

      {editMode && (
        <Card title="Draw your network" subtitle="Pick what to place, then click the map. Drag a placed node to move it; click one to edit or remove it.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {['fibre', 'wireless'].map((group) => (
              <div key={group} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <b style={{ width: 78, fontSize: 12.5, color: group === 'fibre' ? FIBRE : WIRELESS }}>{group === 'fibre' ? 'Fibre' : 'Wireless'}</b>
                {Object.entries(KINDS).filter(([, k]) => k.group === group).map(([kind, k]) => (
                  <Button key={kind} size="sm" variant={tool?.type === 'node' && tool.kind === kind ? 'primary' : undefined}
                    onClick={() => setTool(tool?.type === 'node' && tool.kind === kind ? null : { type: 'node', kind })}>
                    + {k.label}
                  </Button>
                ))}
                <Button size="sm" variant={tool?.type === 'link' && tool.kind === group ? 'primary' : undefined}
                  onClick={() => setTool(tool?.type === 'link' && tool.kind === group ? null : { type: 'link', kind: group, from: null, path: [] })}>
                  {group === 'fibre' ? 'Draw cable' : 'Link radios'}
                </Button>
              </div>
            ))}
            {toolHint && (
              <div style={{ fontSize: 13, color: color.amberInk, background: color.amberBg, borderRadius: radius.md, padding: '8px 11px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span>{toolHint}</span>
                <span style={{ display: 'inline-flex', gap: 8 }}>
                  {tool?.type === 'link' && tool.from && (
                    <>
                      <Button size="sm" onClick={undoPoint}>Undo last point</Button>
                      <Button size="sm" variant="primary" onClick={finishCable}>Finish</Button>
                    </>
                  )}
                  <Button size="sm" onClick={() => setTool(null)}>Cancel</Button>
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="sm" variant={base === 'street' ? 'primary' : undefined} onClick={() => chooseBase('street')}>Map</Button>
            <Button size="sm" variant={base === 'satellite' ? 'primary' : undefined} onClick={() => chooseBase('satellite')}>Satellite</Button>
            {base === 'satellite' && (
              <span style={{ fontSize: 12, color: color.muted }}>
                {mapCfg?.satellite ? `Imagery by ${mapCfg.satellite.provider === 'mapbox' ? 'Mapbox' : 'MapTiler'}` : 'Soft up close? That is all the imagery there is at that spot.'}
              </span>
            )}
          </div>
          <Button size="sm" onClick={() => setWheel((v) => !v)} title="When on, the mouse wheel zooms the map; when off, it scrolls the page">
            Scroll to zoom: {wheel ? 'on' : 'off'}
          </Button>
        </div>
        <div
          ref={holder}
          style={{ height: 520, width: '100%', borderRadius: radius.md, background: color.tileBg, cursor: editMode && tool ? 'crosshair' : undefined, position: 'relative', zIndex: 0, isolation: 'isolate' }}
        />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5, color: color.muted, alignItems: 'center' }}>
          <span><b style={{ color: color.green }}>●</b> active</span>
          <span><b style={{ color: color.amber }}>●</b> grace</span>
          <span><b style={{ color: '#c05a2e' }}>●</b> expired</span>
          <span><b style={{ color: color.rust }}>●</b> suspended</span>
          <span><b style={{ color: color.ink }}>●</b> router online</span>
          <span><b style={{ color: color.rust }}>◉</b> router offline</span>
          <span><b style={{ color: FIBRE }}>━</b> fibre</span>
          <span><b style={{ color: WIRELESS }}>┅</b> wireless</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            {[['clients', 'Customers'], ['routers', 'Routers'], ['network', 'Network'], ...(hasSmartOlt ? [['onus', 'ONUs']] : [])].map(([key, label]) => (
              <label key={key} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={show[key]} onChange={(e) => setShow((s) => ({ ...s, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}
            <span style={{ fontFamily: font.mono }}>{placed.length} of {clients.length} clients placed</span>
          </span>
        </div>
      </Card>

      {sel && edit && (
        <Card
          title={selected.type === 'node' ? `${KINDS[sel.kind]?.label ?? 'Node'} — ${sel.name}` : `${sel.kind === 'fibre' ? 'Fibre cable' : 'Wireless link'}: ${nameOf(sel.from_ref)} → ${nameOf(sel.to_ref)}`}
          subtitle={selected.type === 'link' && posOf(sel.from_ref) && posOf(sel.to_ref)
            ? `${fmtLen(lengthM([posOf(sel.from_ref), ...(sel.path ?? []), posOf(sel.to_ref)]))} along the route`
            : undefined}
          actions={<Button size="sm" onClick={() => setSelected(null)}>Close</Button>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {selected.type === 'node' ? (
              <>
                <Field label="Name"><Input value={edit.name} disabled={!canEdit} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                {fieldsFor(KINDS[sel.kind]?.fields ?? [], edit.details, (d) => setEdit({ ...edit, details: d }))}
                {watchSelect(sel.kind, edit.watchRouterId, (v) => setEdit({ ...edit, watchRouterId: v }))}
                {hasIp(sel.kind) && (
                  <div style={{ fontSize: 13, color: sel.status === 'down' ? color.rust : color.muted, alignSelf: 'end', paddingBottom: 10 }}>
                    Status: <b>{statusOf(sel)}</b>
                  </div>
                )}
              </>
            ) : (
              <>
                <Field label="Label"><Input value={edit.label} disabled={!canEdit} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
                {fieldsFor(LINK_FIELDS[sel.kind] ?? [], edit.details, (d) => setEdit({ ...edit, details: d }))}
              </>
            )}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="primary" onClick={saveSelected} disabled={busy}>Save</Button>
              <Button onClick={removeSelected} disabled={busy} style={{ color: color.rust }}>Remove</Button>
            </div>
          )}
        </Card>
      )}

      <Card title="Devices offline" subtitle="Routers (hotspot and PPPoE) and watched radios that stopped answering, and since when">
        {offline.length === 0 && offlineRadios.length === 0 ? (
          <Empty text="Everything is answering" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {offline.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${color.line}`, flexWrap: 'wrap' }}>
                <b style={{ color: color.rust }}>●</b>
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontSize: 12.5, color: color.muted }}>
                  {r.role === 'hotspot' ? 'Hotspot' : r.role === 'pppoe' ? 'PPPoE' : 'Hotspot + PPPoE'}
                  {r.site ? ` · ${r.site}` : ''}
                </span>
                <span style={{ fontSize: 12.5, color: color.rust }}>offline {ago(r.offline_since ?? r.last_seen)}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <Button size="sm" onClick={() => fly(r)}>Show on map</Button>
                </span>
              </div>
            ))}
            {offlineRadios.map((n) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${color.line}`, flexWrap: 'wrap' }}>
                <b style={{ color: color.rust }}>●</b>
                <span style={{ fontWeight: 600 }}>{n.name}</span>
                <span style={{ fontSize: 12.5, color: color.muted }}>
                  {KINDS[n.kind]?.label ?? 'Radio'}{n.details?.ip ? ` · ${n.details.ip}` : ''}
                </span>
                <span style={{ fontSize: 12.5, color: color.rust }}>offline {ago(n.offline_since)}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <Button size="sm" onClick={() => { map.current?.flyTo([Number(n.lat), Number(n.lng)], 17); setSelected({ type: 'node', id: n.id }); }}>Show on map</Button>
                </span>
              </div>
            ))}
          </div>
        )}
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

      <Modal
        open={!!nodeForm}
        title={nodeForm ? `New ${lc(KINDS[nodeForm.kind].label)}` : ''}
        onClose={() => !busy && setNodeForm(null)}
        footer={
          <>
            <Button onClick={() => setNodeForm(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={saveNode} disabled={busy}>{busy ? 'Saving…' : 'Place it'}</Button>
          </>
        }
      >
        {nodeForm && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Name"><Input value={nodeForm.name} autoFocus onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })} placeholder="e.g. Kilimani OLT, Mast 3, Pole 14" /></Field>
            {fieldsFor(KINDS[nodeForm.kind].fields, nodeForm.details, (d) => setNodeForm({ ...nodeForm, details: d }))}
            {watchSelect(nodeForm.kind, nodeForm.watchRouterId, (v) => setNodeForm({ ...nodeForm, watchRouterId: v }))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!linkForm}
        title={linkForm ? `${linkForm.kind === 'fibre' ? 'Fibre cable' : 'Wireless link'}: ${nameOf(linkForm.from)} → ${nameOf(linkForm.to)}` : ''}
        onClose={() => !busy && setLinkForm(null)}
        footer={
          <>
            <Button onClick={() => setLinkForm(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={saveLink} disabled={busy}>{busy ? 'Saving…' : 'Save link'}</Button>
          </>
        }
      >
        {linkForm && (
          <div style={{ display: 'grid', gap: 12 }}>
            {linkForm.kind === 'fibre' && posOf(linkForm.from) && posOf(linkForm.to) && (
              <div style={{ fontSize: 13, color: color.muted }}>
                Length along the route you drew: <b>{fmtLen(lengthM([posOf(linkForm.from), ...linkForm.path, posOf(linkForm.to)]))}</b>
              </div>
            )}
            <Field label="Label"><Input value={linkForm.label} onChange={(e) => setLinkForm({ ...linkForm, label: e.target.value })} placeholder="e.g. Trunk to Mast 3" /></Field>
            {fieldsFor(LINK_FIELDS[linkForm.kind], linkForm.details, (d) => setLinkForm({ ...linkForm, details: d }))}
          </div>
        )}
      </Modal>
    </Screen>
  );
}
