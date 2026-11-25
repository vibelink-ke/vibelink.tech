import crypto from 'node:crypto';

/**
 * Online sign-up with a coverage check, at https://<company>.<domain>/join.
 *
 * A new customer drops a pin on their home (or uses their phone's location), sees whether you cover it, picks a package
 * and, when you charge one, pays the installation fee by M-Pesa. They arrive in Leads with the pin, the package and the
 * fee, and the owner is told. Outside coverage they are still kept as a lead, marked "not covered", so you see where the
 * demand is.
 *
 * Coverage is worked out here, never trusted from the page: the distance from the pin to the nearest site (a router with
 * a location) or drawn network point (Networks). Radio points (access points, towers, stations, links, and routers)
 * reach the wireless distance; fibre points (OLTs, splitters, closures, cabinets, poles) reach the fibre distance. Both
 * distances are set under Leads > Online sign-up. The page is told only whether the pin is covered and how far the
 * nearest point is, never where your sites are.
 *
 * The fee is paid against a reference like JOIN4821, which is also the account number to use if the customer pays the
 * paybill by hand. payments/apply.js knows the reference and credits the lead, whichever way the money arrives.
 */
const RADIO = ['ap', 'tower', 'station', 'ptp'];
const FIBRE = ['olt', 'splitter', 'closure', 'cabinet', 'pole'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export async function signupSettings(pool, tenantId) {
  try {
    const { rows: [s] } = await pool.query('select enabled, install_fee, wireless_m, fibre_m, note from signup_settings where tenant_id=$1', [tenantId]);
    return { enabled: !!s?.enabled, installFee: Number(s?.install_fee ?? 0), wirelessM: Number(s?.wireless_m ?? 3000), fibreM: Number(s?.fibre_m ?? 300), note: s?.note ?? '' };
  } catch { return { enabled: false, installFee: 0, wirelessM: 3000, fibreM: 300, note: '' }; }
}

const metres = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Whether a point is covered, by the nearest site or network point within its reach. */
export async function coverageAt(pool, tenantId, at, s) {
  const { rows: routers } = await pool.query(
    'select id, name, lat, lng from routers where tenant_id=$1 and lat is not null and lng is not null', [tenantId]);
  const { rows: nodes } = await pool.query(
    'select id, kind, name, lat, lng from network_nodes where tenant_id=$1 and kind = any($2::text[])', [tenantId, [...RADIO, ...FIBRE]]).catch(() => ({ rows: [] }));
  const points = [
    ...routers.map((r) => ({ routerId: r.id, lat: Number(r.lat), lng: Number(r.lng), reach: s.wirelessM, kind: 'wireless' })),
    ...nodes.map((n) => ({ routerId: null, lat: Number(n.lat), lng: Number(n.lng), reach: FIBRE.includes(n.kind) ? s.fibreM : s.wirelessM, kind: FIBRE.includes(n.kind) ? 'fibre' : 'wireless' })),
  ];
  let best = null, nearest = null;
  for (const p of points) {
    const d = metres(at, p);
    if (nearest == null || d < nearest) nearest = d;
    if (d <= p.reach && (!best || d / p.reach < best.d / best.reach)) best = { ...p, d };
  }
  // The router that serves the pin, for packages that are only sold at some sites: the covering router, or failing that the nearest one.
  let routerId = best?.routerId ?? null;
  if (best && !routerId && routers.length) {
    routerId = routers.map((r) => ({ id: r.id, d: metres(at, { lat: Number(r.lat), lng: Number(r.lng) }) })).sort((a, b) => a.d - b.d)[0].id;
  }
  return { covered: !!best, kind: best?.kind ?? null, distance: best ? Math.round(best.d) : null, nearest: nearest == null ? null : Math.round(nearest), routerId, hasPoints: points.length > 0 };
}

async function plansFor(pool, tenantId, routerId) {
  const { rows } = await pool.query(
    `select id, title, price, rate_down from plans p
      where tenant_id=$1 and service='pppoe' and active and coalesce(visible, true)
        and (not exists (select 1 from plan_sites ps where ps.plan_id = p.id)
             or exists (select 1 from plan_sites ps where ps.plan_id = p.id and ps.router_id::text = $2))
      order by price limit 20`, [tenantId, routerId ? String(routerId) : '']);
  return rows.map((p) => ({ id: p.id, title: p.title, price: Number(p.price), mbps: p.rate_down ? Math.round(Number(p.rate_down) / 100) / 10 : null }));
}

export function registerSignup(app, { pool, tenantByHost, wrap, requirePermission, limiter, stkLimiter, msisdnFor, stkPushForSubscriber, publicOnly = false, staffOnly = false }) {
  const tenantOf = async (req) => await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  const point = (b) => {
    const lat = Number(b?.lat), lng = Number(b?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
  };

  if (!staffOnly) {
  app.get('/join', wrap(async (req, res) => {
    const t = await tenantOf(req);
    if (!t) return res.status(404).type('text').send('Unknown network');
    const s = await signupSettings(pool, t.id);
    if (!s.enabled) return res.status(404).type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px"><h1>${esc(t.name)}</h1><p>Online sign-up is not open at the moment.${t.support_phone ? ` Call us on ${esc(t.support_phone)}.` : ''}</p></body>`);
    // The map opens over the middle of this ISP's sites, rounded to about a kilometre so it never points at one.
    const { rows: [mid] } = await pool.query('select round(avg(lat)::numeric, 2) as lat, round(avg(lng)::numeric, 2) as lng from routers where tenant_id=$1 and lat is not null', [t.id]).catch(() => ({ rows: [] }));
    const center = mid?.lat != null ? [Number(mid.lat), Number(mid.lng)] : null;
    res.type('html').send(joinPage({ company: t.name ?? 'Internet', currency: String(t.currency ?? 'KES').trim(), fee: s.installFee, note: s.note, support: t.support_phone ?? null, center }));
  }));

  app.post('/join/check', limiter, wrap(async (req, res) => {
    const t = await tenantOf(req);
    const s = t ? await signupSettings(pool, t.id) : null;
    if (!s?.enabled) return res.status(404).json({ error: 'Online sign-up is not open.' });
    const at = point(req.body);
    if (!at) return res.status(400).json({ error: 'Put the pin on your home first.' });
    const cov = await coverageAt(pool, t.id, at, s);
    res.json({ covered: cov.covered, kind: cov.kind, distance: cov.distance, nearest: cov.nearest, plans: cov.covered ? await plansFor(pool, t.id, cov.routerId) : [], fee: s.installFee });
  }));

  app.post('/join', stkLimiter, wrap(async (req, res) => {
    const t = await tenantOf(req);
    const s = t ? await signupSettings(pool, t.id) : null;
    if (!s?.enabled) return res.status(404).json({ error: 'Online sign-up is not open.' });
    const at = point(req.body);
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    const address = String(req.body?.address ?? '').trim().slice(0, 200) || null;
    if (!at) return res.status(400).json({ error: 'Put the pin on your home first.' });
    if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
    const phone = await msisdnFor(t.id, String(req.body?.phone ?? ''));
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number.' });

    const cov = await coverageAt(pool, t.id, at, s);
    let plan = null;
    if (cov.covered) {
      plan = (await plansFor(pool, t.id, cov.routerId)).find((p) => p.id === String(req.body?.planId ?? '')) ?? null;
      if (!plan) return res.status(400).json({ error: 'Pick a package.' });
    }
    // The same phone signing up twice in a day updates the first request instead of making a second lead.
    const { rows: [dup] } = await pool.query(
      `select id, signup_ref from leads where tenant_id=$1 and source='online' and phone=$2 and created_at > now() - interval '1 day' order by created_at desc limit 1`,
      [t.id, phone]);
    const ref = dup?.signup_ref ?? `JOIN${crypto.randomInt(1000, 10000)}${crypto.randomInt(0, 10)}`;
    const fee = cov.covered ? s.installFee : 0;
    const vals = [t.id, name, phone, at.lat, at.lng, address, plan?.id ?? null, cov.covered ? 'serviceable' : 'none',
      { kind: cov.kind, distance_m: cov.distance, nearest_m: cov.nearest, from: 'online sign-up' }, ref, fee || null];
    let leadId;
    if (dup) {
      await pool.query(
        `update leads set name=$2, phone=$3, lat=$4, lng=$5, address=$6, interested_plan_id=$7, coverage=$8, coverage_detail=$9, coverage_at=now(),
                fee_due=$11, last_activity_at=now() where id=$12 and tenant_id=$1`, [...vals, dup.id]);
      leadId = dup.id;
    } else {
      const { rows: [l] } = await pool.query(
        `insert into leads (tenant_id, name, phone, source, status, lat, lng, address, interested_plan_id, coverage, coverage_detail, coverage_at, signup_ref, fee_due, last_activity_at)
         values ($1,$2,$3,'online','new',$4,$5,$6,$7,$8,$9,now(),$10,$11,now()) returning id`, vals);
      leadId = l.id;
      const { notifyOwner } = await import('./jobs.js');
      notifyOwner(t.id, cov.covered
        ? `New online sign-up: ${name} (${phone}) for ${plan.title}${fee ? `, installation KES ${fee} to pay` : ''}. Ref ${ref}.`
        : `Online sign-up outside coverage: ${name} (${phone}), ${cov.nearest != null ? `${(cov.nearest / 1000).toFixed(1)} km from the nearest site` : 'no sites placed on the map'}.`,
      { url: '/work', title: 'New sign-up' }).catch(() => {});
    }

    let checkoutId = null, payError = null;
    if (fee > 0 && req.body?.pay) {
      const payer = await msisdnFor(t.id, String(req.body?.payPhone ?? '') || phone);
      try {
        const out = await stkPushForSubscriber(t.id, {
          phone: payer ?? phone, amount: fee, accountCode: ref, description: 'Installation',
          purpose: { signup_lead_id: leadId }, routerId: cov.routerId,
        });
        checkoutId = out.checkoutId ?? null;
        if (out.redirectUrl) return res.json({ ok: true, ref, covered: cov.covered, redirectUrl: out.redirectUrl });
      } catch (e) {
        payError = e.response?.data?.errorMessage ?? e.message ?? 'The M-Pesa prompt could not be sent.';
      }
    }
    // A text with the reference, so they can pay the paybill by hand or quote it when they call.
    try {
      const sms = await import('./sms.js');
      const org = await sms.orgVars(t.id);
      const body = cov.covered
        ? `${org.company || t.name}: thank you, ${name.split(' ')[0]}. We have your request for ${plan.title}. Your reference is ${ref}.${fee ? ` Installation is KES ${fee}${checkoutId ? '' : `: pay with M-Pesa using account ${ref}`}.` : ''} We will call you to book a day.`
        : `${org.company || t.name}: thank you, ${name.split(' ')[0]}. We do not reach your area yet. We have kept your request (${ref}) and will tell you when we do.`;
      if (!dup) await sms.send(t.id, phone, 'custom', { ...org, body });
    } catch { /* the request is kept either way */ }
    res.json({ ok: true, ref, covered: cov.covered, fee, checkoutId, payError });
  }));

  /** Is the installation fee paid? Polled while the customer enters their PIN. Says nothing but the state of that one request. */
  app.get('/join/status/:checkoutId', wrap(async (req, res) => {
    const t = await tenantOf(req);
    if (!t) return res.status(404).json({ error: 'Unknown network' });
    const { rows: [r] } = await pool.query(
      `select status, result_desc, purpose->>'signup_lead_id' as lead from stk_requests where checkout_id=$2 and (tenant_id=$1 or purpose->>'tenant_id'=$1::text)`,
      [t.id, req.params.checkoutId]);
    if (!r?.lead) return res.json({ status: 'unknown' });
    const { rows: [l] } = await pool.query('select fee_paid, fee_due from leads where id=$1 and tenant_id=$2', [r.lead, t.id]);
    res.json({ status: r.status, detail: r.result_desc ?? null, paid: Number(l?.fee_paid ?? 0) >= Number(l?.fee_due ?? 0) && Number(l?.fee_paid ?? 0) > 0 });
  }));

  }
  if (publicOnly) return;
  // Staff: the rules, and the recent online sign-ups with what they paid.
  app.get('/api/signup', requirePermission('leads.view'), wrap(async (req, res) => {
    const s = await signupSettings(pool, req.tenant.id);
    const { rows: recent } = await pool.query(
      `select l.id, l.name, l.phone, l.signup_ref, l.coverage, l.coverage_detail, l.fee_due, l.fee_paid, l.fee_paid_at, l.status, l.created_at, p.title as plan
         from leads l left join plans p on p.id = l.interested_plan_id
        where l.tenant_id=$1 and l.source='online' order by l.created_at desc limit 100`, [req.tenant.id]).catch(() => ({ rows: [] }));
    const { rows: [pts] } = await pool.query(
      `select (select count(*) from routers where tenant_id=$1 and lat is not null)::int as sites,
              (select count(*) from network_nodes where tenant_id=$1)::int as nodes`, [req.tenant.id]).catch(() => ({ rows: [{ sites: 0, nodes: 0 }] }));
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    res.json({ ...s, recent, sites: pts.sites, nodes: pts.nodes, link: req.tenant.subdomain ? `https://${req.tenant.subdomain}.${root}/join` : null });
  }));
  app.put('/api/signup', requirePermission('signup.manage'), wrap(async (req, res) => {
    const fee = Math.round(Number(req.body?.installFee ?? 0));
    const w = Math.round(Number(req.body?.wirelessM ?? 3000));
    const f = Math.round(Number(req.body?.fibreM ?? 300));
    if (!(fee >= 0 && fee <= 500000)) return res.status(400).json({ error: 'Enter an installation fee of 0 or more.' });
    if (!(w >= 50 && w <= 50000) || !(f >= 20 && f <= 20000)) return res.status(400).json({ error: 'Enter reach distances in metres: wireless 50 to 50,000, fibre 20 to 20,000.' });
    await pool.query(
      `insert into signup_settings (tenant_id, enabled, install_fee, wireless_m, fibre_m, note) values ($1,$2,$3,$4,$5,$6)
       on conflict (tenant_id) do update set enabled=excluded.enabled, install_fee=excluded.install_fee, wireless_m=excluded.wireless_m, fibre_m=excluded.fibre_m, note=excluded.note`,
      [req.tenant.id, !!req.body?.enabled, fee, w, f, String(req.body?.note ?? '').trim().slice(0, 300) || null]);
    res.json({ ok: true });
  }));
}

/** The public page: a map to drop a pin, the answer, packages, and the M-Pesa step. */
export function joinPage({ company, currency = 'KES', fee = 0, note = '', support = null, center = null }) {
  const cfg = JSON.stringify({ cur: String(currency).slice(0, 3).toUpperCase(), fee, support, center }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Get connected · ${esc(company)}</title>
<link rel="icon" href="/api/public/favicon">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  :root { --ink:#161a17; --muted:#6f766b; --line:rgba(128,128,128,.25); --green:#0f7a5f; --soft:#e8f3ee; --bg:#f5f6f3; --card:#fff; --red:#8a2d16; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         padding:max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 24px max(16px, env(safe-area-inset-left)); }
  .wrap { max-width:480px; margin:0 auto; display:grid; gap:12px; }
  h1 { margin:6px 0 0; font-size:22px; } h2 { margin:0 0 6px; font-size:16px; }
  .sub { margin:0; color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; display:grid; gap:10px; }
  #map { height:300px; border-radius:10px; border:1px solid var(--line); }
  label { font-size:12.5px; font-weight:600; color:var(--muted); display:block; margin-bottom:4px; }
  input { width:100%; padding:10px 11px; font-size:16px; border:1px solid var(--line); border-radius:9px; background:#fafbf9; color:var(--ink); font-family:inherit; }
  button { width:100%; padding:11px; font-size:15px; font-weight:600; color:#fff; background:var(--green); border:0; border-radius:9px; cursor:pointer; font-family:inherit; }
  button.plain { background:transparent; color:var(--green); border:1px solid var(--line); }
  button:disabled { opacity:.55; } button:focus-visible { outline:2px solid var(--green); outline-offset:2px; }
  .plan { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:11px 12px; border:1px solid var(--line); border-radius:10px; cursor:pointer; }
  .plan.on { border-color:var(--green); background:var(--soft); }
  .plan b { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ok { padding:10px 12px; border-radius:9px; background:var(--soft); color:#0b5a46; border:1px solid #bfe0d2; }
  .err { padding:10px 12px; border-radius:9px; background:#fdece5; color:var(--red); border:1px solid #f3c7b6; }
  .ref { font:700 24px ui-monospace,Menlo,Consolas,monospace; letter-spacing:.05em; }
  .hide { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <div><h1>Get connected</h1><p class="sub">${esc(company)} home internet. Check that we reach you, pick a package, and we will call to book the installation.</p></div>

  <div class="card" id="where">
    <h2>1. Where is your home?</h2>
    <p class="sub">Tap the map on your home, or use your phone's location. Zoom in for the exact house.</p>
    <div id="map" role="application" aria-label="Map: tap your home"></div>
    <button type="button" class="plain" id="locate">Use my location</button>
    <div><label for="address">Directions (estate, road, landmark)</label><input id="address" maxlength="200" placeholder="e.g. Kapsoya, behind the church"></div>
    <button type="button" id="check" disabled>Check coverage</button>
    <div id="checkMsg"></div>
  </div>

  <div class="card hide" id="yes">
    <h2>2. Choose your package</h2>
    <div class="ok" id="yesText"></div>
    <div id="plans"></div>
    <div><label for="name">Your name</label><input id="name" autocomplete="name" maxlength="80"></div>
    <div><label for="phone">Your phone number</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07xx xxx xxx" maxlength="20"></div>
    ${fee > 0 ? `<div><label for="payPhone">M-Pesa number to pay from (if different)</label><input id="payPhone" type="tel" inputmode="tel" placeholder="Same as above" maxlength="20"></div>` : ''}
    <button type="button" id="send">${fee > 0 ? `Pay installation ${esc(currency)} ${Number(fee).toLocaleString('en-KE')}` : 'Send my request'}</button>
    ${fee > 0 ? '<button type="button" class="plain" id="later">Send my request, I will pay later</button>' : ''}
    <div id="sendMsg"></div>
  </div>

  <div class="card hide" id="no">
    <h2>We do not reach you yet</h2>
    <p class="sub" id="noText"></p>
    <div><label for="nName">Your name</label><input id="nName" autocomplete="name" maxlength="80"></div>
    <div><label for="nPhone">Your phone number</label><input id="nPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07xx xxx xxx" maxlength="20"></div>
    <button type="button" id="notify">Tell me when you reach my area</button>
    <div id="noMsg"></div>
  </div>

  <div class="card hide" id="done">
    <h2 id="doneTitle">Request received</h2>
    <p class="sub">Your reference</p>
    <div class="ref" id="doneRef"></div>
    <p class="sub" id="doneText"></p>
  </div>
  ${note ? `<p class="sub">${esc(note)}</p>` : ''}
  ${support ? `<p class="sub">Questions? Call us on <b style="user-select:all">${esc(support)}</b>.</p>` : ''}
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var C = ${cfg};
  var $ = function (id) { return document.getElementById(id); };
  var msg = function (el, kind, text) { el.innerHTML = ''; if (!text) return; var d = document.createElement('div'); d.className = kind; d.textContent = text; el.appendChild(d); };
  var money = function (n) { return C.cur + ' ' + Number(n).toLocaleString('en-KE'); };
  var call = function (method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.'); return j; }); });
  };
  var pin = null, marker = null, chosen = null;
  var map = L.map('map', { zoomControl: true }).setView(C.center || [0.5, 37.5], C.center ? 12 : 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  function place(lat, lng, zoom) {
    pin = { lat: lat, lng: lng };
    if (marker) marker.setLatLng(pin); else marker = L.marker(pin, { draggable: true }).addTo(map).on('dragend', function (e) { var p = e.target.getLatLng(); pin = { lat: p.lat, lng: p.lng }; reset(); });
    if (zoom) map.setView(pin, zoom);
    $('check').disabled = false; reset();
  }
  function reset() { $('yes').className = 'card hide'; $('no').className = 'card hide'; msg($('checkMsg'), '', ''); }
  map.on('click', function (e) { place(e.latlng.lat, e.latlng.lng); });
  $('locate').onclick = function () {
    if (!navigator.geolocation) return msg($('checkMsg'), 'err', 'This phone cannot share its location. Tap the map instead.');
    $('locate').disabled = true; $('locate').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(function (p) { place(p.coords.latitude, p.coords.longitude, 17); $('locate').disabled = false; $('locate').textContent = 'Use my location'; },
      function () { $('locate').disabled = false; $('locate').textContent = 'Use my location'; msg($('checkMsg'), 'err', 'We could not get your location. Tap your home on the map instead.'); },
      { enableHighAccuracy: true, timeout: 15000 });
  };
  $('check').onclick = function () {
    if (!pin) return;
    $('check').disabled = true; msg($('checkMsg'), '', '');
    call('POST', '/join/check', pin).then(function (j) {
      if (j.covered) {
        $('yes').className = 'card'; $('no').className = 'card hide';
        $('yesText').textContent = 'Good news: we reach your home (' + (j.kind === 'fibre' ? 'fibre' : 'wireless') + ', about ' + (j.distance < 1000 ? j.distance + ' m' : (j.distance / 1000).toFixed(1) + ' km') + ' from our nearest point).';
        var box = $('plans'); box.innerHTML = ''; chosen = null;
        if (!j.plans.length) box.innerHTML = '<p class="sub">Call us to choose a package.</p>';
        j.plans.forEach(function (p, i) {
          var row = document.createElement('div'); row.className = 'plan'; row.tabIndex = 0; row.setAttribute('role', 'radio');
          var l = document.createElement('span'); l.textContent = p.title + (p.mbps ? ' · ' + p.mbps + ' Mbps' : '');
          var r = document.createElement('b'); r.textContent = money(p.price) + '/mo';
          row.appendChild(l); row.appendChild(r);
          var pick = function () { chosen = p.id; Array.prototype.forEach.call(box.children, function (c) { c.className = 'plan'; c.setAttribute('aria-checked', 'false'); }); row.className = 'plan on'; row.setAttribute('aria-checked', 'true'); };
          row.onclick = pick; row.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
          box.appendChild(row); if (i === 0) pick();
        });
        $('yes').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        $('no').className = 'card'; $('yes').className = 'card hide';
        $('noText').textContent = j.nearest != null ? 'Your home is about ' + (j.nearest / 1000).toFixed(1) + ' km from our nearest point. Leave your number and we will tell you when we get there.' : 'Leave your number and we will tell you when we reach your area.';
        $('no').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }).catch(function (e) { msg($('checkMsg'), 'err', e.message); }).then(function () { $('check').disabled = false; });
  };
  function finish(j, paid) {
    ['where', 'yes', 'no'].forEach(function (id) { $(id).className = 'card hide'; });
    $('done').className = 'card'; $('doneRef').textContent = j.ref;
    $('doneTitle').textContent = paid ? 'Paid. Thank you' : 'Request received';
    $('doneText').textContent = !j.covered ? 'We will text you when we reach your area.'
      : paid ? 'We have your installation fee. We will call you to book a day.'
      : (C.fee > 0 ? 'Installation is ' + money(C.fee) + '. You can pay with M-Pesa using account ' + j.ref + '. ' : '') + 'We will call you to book a day.';
    window.scrollTo(0, 0);
  }
  function send(pay) {
    var name = $('name').value.trim(), phone = $('phone').value.trim();
    if (!chosen) return msg($('sendMsg'), 'err', 'Pick a package.');
    if (name.length < 2) return msg($('sendMsg'), 'err', 'Enter your name.');
    if (phone.replace(/[^0-9]/g, '').length < 9) return msg($('sendMsg'), 'err', 'Enter your phone number.');
    $('send').disabled = true; msg($('sendMsg'), 'ok', pay ? 'Sending the M-Pesa prompt…' : 'Sending…');
    call('POST', '/join', { lat: pin.lat, lng: pin.lng, address: $('address').value, planId: chosen, name: name, phone: phone, pay: pay, payPhone: $('payPhone') ? $('payPhone').value : '' }).then(function (j) {
      if (j.redirectUrl) { location.href = j.redirectUrl; return; }
      if (!pay || !j.checkoutId) { if (j.payError) msg($('sendMsg'), 'err', j.payError); return finish(j, false); }
      msg($('sendMsg'), 'ok', 'Check your phone and enter your M-Pesa PIN.');
      var tries = 0;
      var tick = function () {
        tries += 1;
        call('GET', '/join/status/' + encodeURIComponent(j.checkoutId)).then(function (s) {
          if (s.paid) return finish(j, true);
          if (s.status === 'failed') { $('send').disabled = false; return msg($('sendMsg'), 'err', 'The payment did not go through' + (s.detail ? ': ' + s.detail : '.') + ' Your request is kept: reference ' + j.ref + '.'); }
          if (tries >= 40) return finish(j, false);
          setTimeout(tick, 3000);
        }).catch(function () { setTimeout(tick, 4000); });
      };
      setTimeout(tick, 4000);
    }).catch(function (e) { $('send').disabled = false; msg($('sendMsg'), 'err', e.message); });
  }
  $('send').onclick = function () { send(C.fee > 0); };
  if ($('later')) $('later').onclick = function () { send(false); };
  $('notify').onclick = function () {
    var name = $('nName').value.trim(), phone = $('nPhone').value.trim();
    if (name.length < 2 || phone.replace(/[^0-9]/g, '').length < 9) return msg($('noMsg'), 'err', 'Enter your name and phone number.');
    $('notify').disabled = true;
    call('POST', '/join', { lat: pin.lat, lng: pin.lng, address: $('address').value, name: name, phone: phone }).then(function (j) { finish(j, false); })
      .catch(function (e) { $('notify').disabled = false; msg($('noMsg'), 'err', e.message); });
  };
})();
</script>
</body>
</html>`;
}
