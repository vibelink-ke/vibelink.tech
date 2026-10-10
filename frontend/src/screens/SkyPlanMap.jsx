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
  latest.current = { clients: store.clients ?? [], routers: store.routers ?? [], canEdit, toast: store.toast, name: store.session?.company };
  const [status, setStatus] = useState('Loading the network…');

  const load = useCallback(async () => {
    try {
      const net = await api.network();
      const { clients, routers, canEdit: edit, name } = latest.current;
      const { project, report } = buildSkyPlanProject({ nodes: net.nodes, links: net.links, clients, routers, name: name ?? 'Network' });
      known.current = projectIds(project);
      declined.current = new Set();
      frame.current?.contentWindow?.postMessage({ type: 'billing:load', project, canEdit: edit }, window.location.origin);
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
      else if (m.type === 'skyplan:changed' && latest.current.canEdit && m.project) sync(m.project);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load, sync]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 12.5, color: color.muted }}>
        <span>Live from billing · {status}</span>
        <Button size="sm" onClick={load} title="Throw away unsaved changes and read the network again">Reload from billing</Button>
      </div>
      <iframe
        ref={frame}
        title="SkyPlan"
        src="/skyplan/index.html?embed=billing"
        style={{ width: '100%', height: 'calc(100vh - 190px)', minHeight: 520, border: `1px solid ${color.line}`, borderRadius: 10, background: '#0b1220' }}
      />
    </div>
  );
}
