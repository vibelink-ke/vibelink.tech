/**
 * Server-side copy of frontend/src/lib/skyplan.js (the same conversion, used by the SkyPlan API keys in skyplan-open.js).
 * Keep the two in step.
 *
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
export function buildSkyPlanProject({ nodes, links, clients, routers, leads, health, unplaced, calibrationDb, designItems, sharedLinks, routerList, name = 'Billing network' }) {
  const placed = nodes.filter((n) => hasPos(Number(n.lat), Number(n.lng)));
  const byId = new Map(placed.map((n) => [n.id, n]));

  const hosts = placed.filter((n) => HOSTS.includes(n.kind));
  const sites = hosts.map((h) => {
    const equipment = [];
    for (const d of placed) {
      if (!MOUNTABLE[d.kind] || d.details?.tower !== h.id) continue;
      const kind = MOUNTABLE[d.kind];
      equipment.push({
        id: idOf(d), kind, model: d.details?.model || d.name, nodeId: d.id,
        ...(kind === 'radio' && num(d.details?.azimuth) !== null ? { azimuth: num(d.details.azimuth) } : {}),
        // What an access point is for and how it is set up, so SkyPlan can make a sector of it (see its billingSectors.ts).
        ...(kind === 'radio' ? { role: d.kind } : {}),
        ...(kind === 'radio' && num(d.details?.frequency) !== null ? { freqMHz: num(d.details.frequency) > 100 ? Math.round(num(d.details.frequency)) : Math.round(num(d.details.frequency) * 1000) } : {}),
        ...(kind === 'radio' && num(d.details?.beamwidth) !== null ? { beamwidth: num(d.details.beamwidth) } : {}),
        ...(kind === 'radio' && num(d.details?.range) !== null ? { reachKm: num(d.details.range) } : {}),
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
      ...(health?.[c.id] ? { health: health[c.id] } : {}),
      ...(c.ap_node_id ? { apNodeId: c.ap_node_id } : {}),
      ...(c.shared_link_id ? { linkId: c.shared_link_id } : {}),
      ...(c.account_code ? { acct: String(c.account_code) } : {}), ...(c.phone ? { phone: String(c.phone) } : {}),
      ...(c.cpe_signal_dbm != null && Number.isFinite(Number(c.cpe_signal_dbm)) ? { measuredRxDbm: Number(c.cpe_signal_dbm) } : {}),
    });
  }

  // Sales leads that have a place on the map: SkyPlan checks each one for coverage and reports back (see saveLeadCoverage).
  let leadCount = 0;
  for (const l of leads ?? []) {
    const la = num(l.lat); const ln = num(l.lng);
    if (!hasPos(la, ln)) continue;
    subscribers.push({ id: `lead:${l.id}`, name: `Lead · ${l.name}`, lat: la, lon: ln, lead: true });
    leadCount += 1;
  }

  // Wireless links and sectors drawn in SkyPlan and kept whole (skyplan-items.js): only those whose sites are still in the network.
  const siteIds = new Set(sites.map((x) => x.id));
  const designLinks = (designItems?.links ?? []).filter((l) => siteIds.has(l.aId) && siteIds.has(l.bId));
  const designCoverages = (designItems?.coverages ?? []).filter((c) => siteIds.has(c.siteId));

  const project = {
    format: 'skyplan-rf', version: 1, projectName: name,
    sites, links: designLinks, coverages: designCoverages, settings: Number.isFinite(Number(calibrationDb)) && Number(calibrationDb) !== 0 ? { calibrationDb: Number(calibrationDb) } : {}, customRadios: [], customAntennas: [],
    fiberNodes, fiberCables, subscribers, probes: [],
    ...(unplaced?.length ? { unplaced } : {}),
    // Every router (placed or not) by name, so a radio can be locked to the one that pings it.
    ...(routerList?.length ? { billingRouters: routerList.map((r) => ({ id: r.id, name: r.name })) } : {}),
    // The shared radios, switches and ONUs and how each group is doing (Shared links in billing); the customers carry the id of theirs.
    ...(sharedLinks?.length ? { sharedLinks: sharedLinks.map((l) => ({ id: l.id, name: l.name, kind: l.kind, managed: l.managed !== false, level: l.level, headline: l.headline, online: l.online ?? 0, active: l.active ?? 0, drops: l.drops ?? 0,
      ...(l.parent_id ? { parentId: l.parent_id } : {}), ...(l.site_ref ? { siteRef: l.site_ref } : {}),
      ...(l.ip ? { ip: l.ip } : {}), ...(l.mac ? { mac: l.mac } : {}), ...(l.model ? { model: l.model } : {}), ...(l.ssid ? { ssid: l.ssid } : {}), ...(l.freq_mhz ? { freqMHz: Number(l.freq_mhz) } : {}),
      ...(l.ip ? { ping: { ok: l.ping_ok ?? null, ms: l.ping_ms != null ? Number(l.ping_ms) : null, at: l.ping_at ?? null, router: l.ping_router ?? null } } : {}),
      ...(l.ping_router_id ? { pingRouterId: l.ping_router_id } : {}), ...(Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)) && l.lat !== null && l.lng !== null ? { lat: Number(l.lat), lon: Number(l.lng) } : {}),
      ...(l.upstream ? { upstream: { id: l.upstream.id, name: l.upstream.name } } : {}) })) } : {}),
  };
  return {
    project,
    report: {
      sites: sites.length, devices: sites.reduce((a, s) => a + (s.equipment?.length ?? 0), 0),
      fibreNodes: fiberNodes.length, cables: fiberCables.length, customers: subscribers.length - leadCount, leads: leadCount, skippedCables: skipped,
    },
  };
}

/**
 * Read a SkyPlan project into Map nodes and cables. Returns what it did; nothing is deleted, and an item that already
 * exists is renamed (and its SkyPlan id remembered) but never moved.
 */
export async function importSkyPlanProject(project, { nodes, links }, api, { includePlanned = false, moveExisting = false, onProgress, known } = {}) {
  if (project?.format !== 'skyplan-rf' || !Array.isArray(project.sites)) throw new Error('That is not a SkyPlan RF project file.');
  const keep = (x) => includePlanned || !x.lifecycle || x.lifecycle === 'active';
  const out = { created: 0, updated: 0, skipped: 0, gone: [] };
  // Ids billing handed over earlier (`known`) that billing no longer has were deleted there: they are not made again, and are reported so the
  // caller can drop them from SkyPlan. Without this a stale copy of the design brought deleted towers, cables and sectors back on every save.
  const wasHanded = (id) => !!known && (typeof known.has === 'function' ? known.has(id) : false);
  const goneSet = new Set();
  const deletedThere = (id, present) => { if (!present && wasHanded(id)) { goneSet.add(id); out.gone.push(id); return true; } return false; };

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
    if (deletedThere(spId, false)) return null;
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
      if (!hostId) { out.skipped += 1; return; }   // deleted in billing: its equipment goes with it
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
      if (!existing && deletedThere(c.id, false)) return;
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

  // Sectors: an access point on its tower with a direction, a beam and a reach, so billing's map draws it. An access point billing already has
  // under this id keeps its model.
  for (const cv of project.coverages ?? []) {
    if (!keep(cv)) { out.skipped += 1; continue; }
    steps.push(async () => {
      const host = (project.sites ?? []).find((s) => s.id === cv.siteId);
      const hostNode = host && idMap.get(host.id);
      if (!hostNode) { out.skipped += 1; return; }
      const meta = cv.meta ?? {};
      await upsert(cv.id, 'ap', cv.name, host.lat, host.lon, {
        tower: hostNode, ...(have.get(cv.id) ? {} : { model: meta.model }), frequency: cv.freqMHz ? cv.freqMHz / 1000 : undefined,
        azimuth: cv.azimuth, beamwidth: meta.beamwidth, range: cv.radiusKm, ...stage(cv),
      });
    });
  }
  // Wireless links between two sites: a wireless link on billing's map between the two towers.
  for (const l of project.links ?? []) {
    if (!keep(l)) { out.skipped += 1; continue; }
    steps.push(async () => {
      const a = idMap.get(l.aId); const b = idMap.get(l.bId);
      if (!a || !b || a === b) { out.skipped += 1; return; }
      const details = str({ frequency: l.freqMHz ? l.freqMHz / 1000 : undefined, signal: l.measuredRxDbm, skyplan: l.id, ...stage(l) });
      const existing = haveLinks.get(l.id);
      if (!existing && deletedThere(l.id, false)) return;
      if (existing) {
        await api.updateNetLink(existing.id, { label: l.name, details: str({ ...(existing.details ?? {}), ...details }) });
        out.updated += 1;
        return;
      }
      await api.createNetLink({ kind: 'wireless', from: `n:${a}`, to: `n:${b}`, path: [], label: l.name, details });
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
  // The whole of each link and sector is kept as well (what billing's map cannot hold), so the design comes back as drawn.
  if (typeof api.saveDesignItems === 'function') {
    out.items = await api.saveDesignItems({
      links: (project.links ?? []).filter((l) => keep(l) && !goneSet.has(l.id) && !goneSet.has(l.aId) && !goneSet.has(l.bId)),
      coverages: (project.coverages ?? []).filter((c) => keep(c) && !goneSet.has(c.id) && !goneSet.has(c.siteId)),
      mirror: includePlanned && (project.sites ?? []).length > 0,
    });
  }
  return out;
}

/** Every SkyPlan-side id a project carries: sites, their equipment, fibre nodes and cables. */
export function projectIds(project) {
  const ids = new Set();
  for (const s of project.sites ?? []) { ids.add(s.id); for (const d of s.equipment ?? []) ids.add(d.id); }
  for (const n of project.fiberNodes ?? []) ids.add(n.id);
  for (const c of project.fiberCables ?? []) ids.add(c.id);
  for (const l of project.links ?? []) ids.add(l.id);
  for (const c of project.coverages ?? []) ids.add(c.id);
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
    links: links.filter((l) => ['fibre', 'wireless'].includes(l.kind) && known.has(idOf(l)) && !ids.has(idOf(l))),
  };
}
