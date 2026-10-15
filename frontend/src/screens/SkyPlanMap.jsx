import React, { useCallback, useEffect, useRef, useState } from 'react';
import { color } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button } from '../ui/primitives';
import { buildSkyPlanProject, findRemoved, importSkyPlanProject, projectIds } from '../lib/skyplan';

/**
 * SkyPlan (the network planner) as the Map. It runs in a frame served from this same site (/skyplan/), signed in as
 * whoever is looking, and is handed the live network: towers, the equipment on them, fibre, cables and customers.
 * Edits are saved back to the billing database a moment after they are made, so billing stays the one copy.
 *
 * Customers are shown but not edited here (move one from their client page). Deleting something in SkyPlan removes it
 * from billing too, after a confirmation. Without the network-edit permission the map is view-only.
 */
export default function SkyPlanMap() {
  const store = useStore();
  const frame = useRef(null);
  const canEdit = !!store.session?.perms?.['network.edit'];
  const known = useRef(new Set());      // SkyPlan ids billing has handed over (only these may be removed by a later save)
  const declined = useRef(new Set());   // removals the person said no to
  const busy = useRef(false);
  const pending = useRef(null);
  const latest = useRef({});
  const canLeads = !!store.session?.perms?.['leads.edit'];
  const canCustomers = !!store.session?.perms?.['clients.edit'];
  latest.current = { clients: store.clients ?? [], routers: store.routers ?? [], leads: (store.leads ?? []).filter((l) => l.status !== 'won' && l.status !== 'lost'), canLeads, canCustomers, canEdit, toast: store.toast, name: store.session?.company };
  const [status, setStatus] = useState('Loading the network…');

  const lastChange = useRef(0);          // when SkyPlan last told us about an edit
  const load = useCallback(async (silent = false) => {
    try {
      const net = await api.network();
      const { clients, routers, leads, canEdit: edit, canLeads: editLeads, canCustomers: editCustomers, name } = latest.current;
      // How each customer is doing right now: connected, in good standing, line drops in the last day (colours on the map).
      const drops = await api.customerDrops().catch(() => ({}));
      const calibration = await api.networkCalibration().catch(() => null);
      const designItems = await api.skyplanItems().catch(() => ({ links: [], coverages: [] }));
      const health = {};
      for (const c of clients) {
        health[c.id] = { online: !!c.online, status: c.status ?? 'active', ...(c.line_state === 'unreachable' ? { line: 'bad' } : {}), drops24: drops[c.id] ?? 0 };
      }
      const { project, report } = buildSkyPlanProject({ nodes: net.nodes, links: net.links, clients, routers, leads, health, designItems, calibrationDb: calibration?.correction_db ?? 0, name: name ?? 'Network',
        // Customers and leads with no place on the map yet, so they can be placed from SkyPlan.
        unplaced: [
          ...clients.filter((c) => !(Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)) && !(Number(c.lat) === 0 && Number(c.lng) === 0))).slice(0, 300).map((c) => ({ id: c.id, name: c.name })),
          ...leads.filter((l) => !(Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)) && !(Number(l.lat) === 0 && Number(l.lng) === 0))).slice(0, 300).map((l) => ({ id: `lead:${l.id}`, name: `Lead · ${l.name}`, lead: true })),
        ] });
      known.current = projectIds(project);
      declined.current = new Set();
      frame.current?.contentWindow?.postMessage({ type: 'billing:load', project, canEdit: edit, can: { customers: !!editCustomers, leads: !!editLeads }, silent: silent === true }, window.location.origin);
      setStatus(`${report.sites} sites · ${report.devices} devices · ${report.fibreNodes} fibre nodes · ${report.cables} cables · ${report.customers} customers${edit ? '' : ' · view only'}`);
    } catch (e) {
      setStatus(`Could not load the network: ${e.message}`);
    }
  }, []);

  const sync = useCallback(async (project) => {
    if (busy.current) { pending.current = project; return; }
    busy.current = true;
    setStatus('Saving…');
    try {
      const net = await api.network();
      await importSkyPlanProject(project, net, api, { includePlanned: true, moveExisting: true });
      const fresh = await api.network();
      const gone = findRemoved(project, fresh, known.current);
      const nodes = gone.nodes.filter((n) => !declined.current.has(n.id));
      const links = gone.links.filter((l) => !declined.current.has(l.id));
      if (nodes.length || links.length) {
        const names = nodes.slice(0, 5).map((n) => n.name).join(', ');
        const ok = window.confirm(`You removed ${nodes.length} item${nodes.length === 1 ? '' : 's'}${names ? ` (${names}${nodes.length > 5 ? '…' : ''})` : ''} and ${links.length} cable${links.length === 1 ? '' : 's'} in SkyPlan.\n\nRemove ${nodes.length + links.length === 1 ? 'it' : 'them'} from billing too?`);
        if (ok) {
          for (const l of links) await api.deleteNetLink(l.id).catch(() => {});
          for (const n of nodes) await api.deleteNetNode(n.id).catch(() => {});
        } else {
          [...nodes, ...links].forEach((x) => declined.current.add(x.id));
        }
      }
      for (const id of projectIds(project)) known.current.add(id);
      setStatus(`Saved ${new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      setStatus('Not saved');
      latest.current.toast?.(`Could not save the map: ${e.message}`);
    } finally {
      busy.current = false;
      if (pending.current) { const next = pending.current; pending.current = null; sync(next); }
    }
  }, []);

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'skyplan:ready') load();
      else if (m.type === 'skyplan:changed' && latest.current.canEdit && m.project) { lastChange.current = Date.now(); sync(m.project); }
      else if (m.type === 'skyplan:edit' && m.reqId) {
        // An edit made in SkyPlan (a place, an access point, a lead's progress): done with this person's own permissions, answered when done.
        const reply = (ok, error) => frame.current?.contentWindow?.postMessage({ type: 'billing:edit-result', reqId: m.reqId, ok, error }, window.location.origin);
        const p = m.payload ?? {};
        let call;
        if (m.action === 'move') call = api.skyplanMove(p.kind, { id: p.id, lat: p.lat, lng: p.lng });
        else if (m.action === 'ap') call = api.skyplanCustomerAp({ id: p.id, apNodeId: p.apNodeId ?? null });
        else if (m.action === 'lead') call = api.skyplanLead(p);
        else call = Promise.reject(new Error('Unknown change'));
        call.then(() => {
          // Keep the rest of billing in step without waiting for the next refresh.
          if (m.action === 'move' && p.kind === 'customer') store.setCollection('clients', (cs) => cs.map((x) => (x.id === p.id ? { ...x, lat: p.lat, lng: p.lng } : x)));
          else if (m.action === 'ap') store.setCollection('clients', (cs) => cs.map((x) => (x.id === p.id ? { ...x, ap_node_id: p.apNodeId ?? null } : x)));
          else api.leads().then((ls) => store.setCollection('leads', ls)).catch(() => {});
          reply(true);
        }).catch((err) => reply(false, err.message));
      }
      else if (m.type === 'skyplan:calibration' && latest.current.canEdit && m.body) {
        api.saveNetworkCalibration(m.body).then(() => latest.current.toast?.('Correction saved')).catch((err) => latest.current.toast?.(`Could not save the correction: ${err.message}`));
      }
      else if (m.type === 'skyplan:leads' && latest.current.canLeads && Array.isArray(m.results)) {
        // SkyPlan worked out whether the leads on the map can be served: keep it on the leads.
        api.saveLeadCoverage(m.results).then(() => api.leads()).then((ls) => store.setCollection('leads', ls)).catch(() => {});
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load, sync]);

  // Keeps SkyPlan current with the system. A quiet refresh (the camera is left alone) happens when new customers or routers arrive,
  // and every two minutes while the tab is open, but never right after an edit or while a save is running, so nothing is lost.
  const quiet = useCallback(() => {
    if (document.hidden || busy.current || pending.current) return;
    if (Date.now() - lastChange.current < 20000) return;
    load(true);
  }, [load]);
  // New customers, customers placed or moved on the map, and routers: any of these brings the map up to date within seconds.
  const sig = `${(store.clients ?? []).length}:${(store.clients ?? []).reduce((n, c) => n + (c.lat != null && c.lng != null ? 1 : 0), 0)}:${(store.clients ?? []).reduce((n, c) => n + (Number(c.lat) || 0) + (Number(c.lng) || 0), 0).toFixed(5)}:${(store.routers ?? []).length}`;
  const firstSig = useRef(sig);
  useEffect(() => {
    if (firstSig.current === sig) return undefined;
    firstSig.current = sig;
    const t = setTimeout(quiet, 5000);
    return () => clearTimeout(t);
  }, [sig, quiet]);
  useEffect(() => {
    const t = setInterval(quiet, 120000);
    return () => clearInterval(t);
  }, [quiet]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 12.5, color: color.muted }}>
        <span>Live from billing · {status}</span>
        <Button size="sm" onClick={() => load()} title="Throw away unsaved changes and read the network again">Reload from billing</Button>
      </div>
      <iframe
        ref={frame}
        title="SkyPlan"
        className="no-invert"
        src="/skyplan/index.html?embed=billing"
        style={{ width: '100%', height: 'calc(100vh - 190px)', minHeight: 520, border: `1px solid ${color.line}`, borderRadius: 10, background: '#0b1220' }}
      />
    </div>
  );
}
