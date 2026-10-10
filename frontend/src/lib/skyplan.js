/**
 * The link between the billing Map and SkyPlan RF (the network planner), in both directions, through SkyPlan's own
 * project file (*.skyplan.json) — nothing here needs SkyPlan to be reachable from the server.
 *
 *   billing -> SkyPlan   towers and poles become sites, the radios/switches/power installed on them become the
 *                        site's equipment, OLT/splitter/closure/cabinet/ONU become fibre nodes, fibre cables become
 *                        fibre cables, and customers become subscribers (each with its device address as the host
 *                        to ping, so SkyPlan's live monitoring watches the real equipment).
 *   SkyPlan -> billing   the same things back: sites, equipment and fibre design become Map nodes and cables.
 *                        Customers are never imported (billing owns them), nothing is ever deleted, and an existing
 *                        item is only renamed — never moved — so a tower you placed on the map stays where it is.
 *
 * Items are matched through `details.skyplan` (the id they had in SkyPlan), or through the billing id itself for
 * anything exported from here, so repeating either direction updates instead of duplicating.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const FIBRE_OUT = { olt: 'olt', splitter: 'splitter', closure: 'splice', cabinet: 'fdh', onu: 'ont' };
const FIBRE_IN = { olt: 'olt', pop: 'cabinet', splice: 'closure', splitter: 'splitter', fdh: 'cabinet', handhole: 'closure', pole: 'pole', ont: 'onu' };
const HOSTS = ['tower', 'pole'];
const MOUNTABLE = { ap: 'radio', ptp: 'radio', station: 'radio', switch: 'switch', power: 'power' };

const idOf = (x) => x.details?.skyplan || x.id;
const lifeOf = (x) => (['proposed', 'planned', 'retired'].includes(x.details?.stage) ? x.details.stage : 'active');
const hasPos = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

const metres = (a, b) => {
  const R = 6371000; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]); const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** What goes into the SkyPlan project file, plus a short report of what was left out. */
export function buildSkyPlanProject({ nodes, links, clients, routers, name = 'Billing network' }) {
  const placed = nodes.filter((n) => hasPos(Number(n.lat), Number(n.lng)));
  const byId = new Map(placed.map((n) => [n.id, n]));

  const hosts = placed.filter((n) => HOSTS.includes(n.kind));
  const sites = hosts.map((h) => {
    const equipment = [];
    for (const d of placed) {
      if (!MOUNTABLE[d.kind] || d.details?.tower !== h.id) continue;
      const kind = MOUNTABLE[d.kind];
      equipment.push({
        id: idOf(d), kind, model: d.details?.model || d.name,
        ...(kind === 'radio' && num(d.details?.azimuth) !== null ? { azimuth: num(d.details.azimuth) } : {}),
        ...(kind === 'switch' && num(d.details?.ports) !== null ? { ports: num(d.details.ports) } : {}),
        ...(d.details?.ip ? { host: d.details.ip } : {}),
      });
    }
    // A router placed on the tower (within 15 m) is part of the site too.
    for (const r of routers ?? []) {
      const la = num(r.lat); const ln = num(r.lng);
      if (hasPos(la, ln) && metres([la, ln], [Number(h.lat), Number(h.lng)]) <= 15) {
        equipment.push({ id: `r-${r.id}`, kind: 'router', model: r.name });
      }
    }
    return {
      id: idOf(h), name: h.name, lat: Number(h.lat), lon: Number(h.lng),
      maxHeight: num(h.details?.height) ?? 30, kind: h.kind, lifecycle: lifeOf(h),
      ...(h.details?.note ? { notes: h.details.note } : {}),
      ...(equipment.length ? { equipment } : {}),
    };
  });

  const fibreNodes = placed.filter((n) => FIBRE_OUT[n.kind]);
  const fiberNodes = fibreNodes.map((n) => {
    const ratio = /^1:(\d+)/.exec(String(n.details?.ratio ?? ''));
    return {
      id: idOf(n), name: n.name, kind: FIBRE_OUT[n.kind], lat: Number(n.lat), lon: Number(n.lng), lifecycle: lifeOf(n),
      ...(n.kind === 'splitter' && ratio ? { split: Number(ratio[1]) } : {}),
    };
  });

  // A cable can only end on something SkyPlan knows as a fibre node or a site.
  const known = new Map([...fibreNodes, ...hosts].map((n) => [n.id, n]));
  let skipped = 0;
  const fiberCables = [];
  for (const l of links) {
    if (l.kind !== 'fibre') continue;
    const a = /^n:(.+)$/.exec(l.from_ref)?.[1]; const b = /^n:(.+)$/.exec(l.to_ref)?.[1];
    const na = a && known.get(a); const nb = b && known.get(b);
    if (!na || !nb) { skipped += 1; continue; }
    fiberCables.push({
      id: idOf(l), name: l.label || `${na.name} → ${nb.name}`, aId: idOf(na), bId: idOf(nb),
      path: [[Number(na.lat), Number(na.lng)], ...(l.path ?? []).map((p) => [Number(p[0]), Number(p[1])]), [Number(nb.lat), Number(nb.lng)]],
      fibers: num(l.details?.cores) ?? 12, placement: 'aerial', slackPct: 5, lifecycle: lifeOf(l),
    });
  }

  const subscribers = [];
  for (const c of clients ?? []) {
    const la = num(c.lat); const ln = num(c.lng);
    if (!hasPos(la, ln)) continue;
    subscribers.push({
      id: c.id, name: `${c.name}${c.line_label ? ` – ${c.line_label}` : ''}`, lat: la, lon: ln,
      ...(c.mgmt_ip ? { monitor: { host: String(c.mgmt_ip).split('/')[0] } } : {}),
    });
  }

  const project = {
    format: 'skyplan-rf', version: 1, projectName: name,
    sites, links: [], coverages: [], settings: {}, customRadios: [], customAntennas: [],
    fiberNodes, fiberCables, subscribers, probes: [],
  };
  return {
    project,
    report: {
      sites: sites.length, devices: sites.reduce((a, s) => a + (s.equipment?.length ?? 0), 0),
      fibreNodes: fiberNodes.length, cables: fiberCables.length, customers: subscribers.length, skippedCables: skipped,
    },
  };
}

/**
 * Read a SkyPlan project into Map nodes and cables. Returns what it did; nothing is deleted, and an item that already
 * exists is renamed (and its SkyPlan id remembered) but never moved.
 */
export async function importSkyPlanProject(project, { nodes, links }, api, { includePlanned = false, moveExisting = false, onProgress } = {}) {
  if (project?.format !== 'skyplan-rf' || !Array.isArray(project.sites)) throw new Error('That is not a SkyPlan RF project file.');
  const keep = (x) => includePlanned || !x.lifecycle || x.lifecycle === 'active';
  const out = { created: 0, updated: 0, skipped: 0 };

  const have = new Map();
  for (const n of nodes) { have.set(n.id, n); if (n.details?.skyplan) have.set(n.details.skyplan, n); }
  const haveLinks = new Map();
  for (const l of links) { haveLinks.set(l.id, l); if (l.details?.skyplan) haveLinks.set(l.details.skyplan, l); }
  const idMap = new Map();   // SkyPlan id -> billing node id
  const stage = (x) => ({ stage: x.lifecycle && x.lifecycle !== 'active' ? x.lifecycle : '' });
  const str = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, typeof v === 'number' ? v : String(v)]));

  const upsert = async (spId, kind, name, lat, lon, details) => {
    const existing = have.get(spId);
    if (existing) {
      const merged = str({ ...(existing.details ?? {}), ...details, skyplan: spId });
      const moved = moveExisting && hasPos(lat, lon) && hasPos(Number(existing.lat), Number(existing.lng))
        && metres([lat, lon], [Number(existing.lat), Number(existing.lng)]) > 1;
      await api.updateNetNode(existing.id, { name, details: merged, ...(moved ? { lat, lng: lon } : {}) });
      idMap.set(spId, existing.id);
      out.updated += 1;
      return existing.id;
    }
    const made = await api.createNetNode({ kind, name, lat, lng: lon, details: str({ ...details, skyplan: spId }), watchRouterId: null });
    idMap.set(spId, made.id);
    have.set(spId, { ...made, details: { skyplan: spId } });
    out.created += 1;
    return made.id;
  };

  const steps = [];
  for (const s of project.sites) {
    if (!keep(s) || s.kind === 'cpe') { out.skipped += 1; continue; }
    steps.push(async () => {
      const hostId = await upsert(s.id, s.kind === 'pole' ? 'pole' : 'tower', s.name, s.lat, s.lon,
        { height: s.maxHeight, note: s.notes, ...stage(s) });
      for (const d of s.equipment ?? []) {
        if (d.kind === 'router' || d.kind === 'other') { out.skipped += 1; continue; }   // routers belong to billing's own list
        const kind = d.kind === 'switch' ? 'switch' : d.kind === 'power' ? 'power' : 'ap';
        await upsert(d.id, kind, d.model || kind, s.lat, s.lon,
          { tower: hostId, model: d.model, azimuth: d.azimuth, ports: d.ports, ip: d.host });
      }
    });
  }
  for (const f of project.fiberNodes ?? []) {
    if (!keep(f) || !FIBRE_IN[f.kind] || f.kind === 'pole') { out.skipped += 1; continue; }
    steps.push(() => upsert(f.id, FIBRE_IN[f.kind], f.name, f.lat, f.lon, { ratio: f.split ? `1:${f.split}` : undefined, ...stage(f) }));
  }
  for (const c of project.fiberCables ?? []) {
    if (!keep(c)) { out.skipped += 1; continue; }
    steps.push(async () => {
      const a = idMap.get(c.aId); const b = idMap.get(c.bId);
      if (!a || !b || a === b) { out.skipped += 1; return; }
      const existing = haveLinks.get(c.id);
      const interior = (c.path ?? []).slice(1, -1).map((p) => [Number(p[0]), Number(p[1])]);
      if (existing) {
        await api.updateNetLink(existing.id, { label: c.name, ...(moveExisting ? { path: interior } : {}), details: str({ ...(existing.details ?? {}), cores: c.fibers, skyplan: c.id }) });
        out.updated += 1;
        return;
      }
      await api.createNetLink({ kind: 'fibre', from: `n:${a}`, to: `n:${b}`, path: interior, label: c.name, details: str({ cores: c.fibers, skyplan: c.id }) });
      out.created += 1;
    });
  }

  // Sites, then fibre nodes, then cables (a cable needs both of its ends) — one at a time so the server is never flooded.
  const ordered = steps;
  let done = 0;
  for (const run of ordered) {
    await run();
    done += 1;
    onProgress?.(done, ordered.length);
  }
  return out;
}

/** Every SkyPlan-side id a project carries: sites, their equipment, fibre nodes and cables. */
export function projectIds(project) {
  const ids = new Set();
  for (const s of project.sites ?? []) { ids.add(s.id); for (const d of s.equipment ?? []) ids.add(d.id); }
  for (const n of project.fiberNodes ?? []) ids.add(n.id);
  for (const c of project.fiberCables ?? []) ids.add(c.id);
  return ids;
}

/**
 * What was in the network when it was handed to SkyPlan and is no longer in the project: the person deleted it there.
 * Only ids billing itself handed over (`known`) count, so nothing SkyPlan never saw can be removed by a save.
 */
export function findRemoved(project, { nodes, links }, known) {
  const ids = projectIds(project);
  return {
    nodes: nodes.filter((n) => known.has(idOf(n)) && !ids.has(idOf(n))),
    links: links.filter((l) => l.kind === 'fibre' && known.has(idOf(l)) && !ids.has(idOf(l))),
  };
}

/** Download text as a file. */
export function downloadFile(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
