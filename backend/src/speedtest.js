import crypto from 'node:crypto';

/**
 * A speed test customers run themselves: from their portal, the visitor wallet and the "You're connected" page.
 *
 * Two measurements, so the answer is about the customer's line and not about the internet in between:
 *
 *   1. The browser fills the line. It downloads and uploads from Cloudflare's speed-test servers (they have servers in
 *      Kenya, so the far end is never the bottleneck), falling back to this server if Cloudflare cannot be reached. Ten
 *      seconds each way; the first two seconds, while TCP is still ramping up, are not counted.
 *   2. For a home (PPPoE) customer signed in to their portal, the server reads the customer's own session on their MikroTik
 *      once a second while the test runs (/interface/monitor-traffic on <pppoe-username>), and reads the speed cap the
 *      router is enforcing for them (the max-limit of their queue). The router's figure is what is reported and kept: it is
 *      what the router actually delivered to them, measured where the cap is applied.
 *
 * Every test a signed-in customer runs is kept on their client page, and a home customer who tests far below their cap twice
 * in a day gets a ticket opened for them, at most once every three days.
 */

const CHUNK = crypto.randomBytes(1 << 20);         // 1 MB of noise, sent over and over: random so nothing on the way can compress it
const MAX_DOWN = 30 * 1024 * 1024;                  // per stream
const MAX_UP = 12 * 1024 * 1024;                    // per request
const SLOW_SHARE = 0.4;                             // below 40% of the cap counts as slow
const WARMUP_MS = 2000;                             // TCP ramp-up, not counted
const SAMPLER_MAX_MS = 45000;                       // a router is read for at most this long per test

// How many requests one address may make in ten minutes: about ten whole tests. Kept in memory; one API process runs here.
const seen = new Map();
function budget(kind, max) {
  return (req, res, next) => {
    const key = kind + ':' + req.ip; const now = Date.now();
    const list = (seen.get(key) ?? []).filter((t) => t > now - 10 * 60 * 1000);
    if (list.length >= max) return res.status(429).json({ error: 'Too many speed tests from here. Try again in a few minutes.' });
    list.push(now); seen.set(key, list);
    if (seen.size > 5000) for (const [k, v] of seen) if (!v.length || v.at(-1) < now - 10 * 60 * 1000) seen.delete(k);
    next();
  };
}

// Router readings in progress: id -> { tenantId, subscriberId, startedAt, samples: [{ t, down, up }], cap, stop, done, error }.
const samplers = new Map();

/** "5M/10M", "5000000/10000000" or "5000k/10000k" (upload/download) into kbps, as RouterOS writes a queue's max-limit. */
export function parseLimit(v) {
  const one = (x) => {
    const m = /^\s*([\d.]+)\s*([kKmMgG]?)\s*$/.exec(String(x ?? ''));
    if (!m) return null;
    const n = Number(m[1]) * ({ '': 1 / 1000, k: 1, K: 1, m: 1000, M: 1000, g: 1e6, G: 1e6 }[m[2]]);
    return n > 0 ? Math.round(n) : null;
  };
  const [up, down] = String(v ?? '').split('/');
  return { upKbps: one(up), downKbps: one(down) };
}

/** The router's figure for one direction: the second-best one-second reading inside the window, so one spike does not decide it. */
export function routerRate(samples, key, from, to) {
  const xs = samples.filter((s) => s.t >= from && s.t <= to).map((s) => s[key]).sort((a, b) => b - a);
  if (!xs.length) return null;
  return xs.length >= 3 ? xs[1] : xs[0];
}

async function startSampler(pool, ros, secrets, sub) {
  const { rows: [r] } = await pool.query(
    `select s.pppoe_user, s.service, rt.host, rt.api_port, rt.service_user, rt.service_password_enc
       from subscribers s left join routers rt on rt.id = s.router_id where s.id=$1 and s.tenant_id=$2`, [sub.subscriber_id, sub.tenant_id]);
  if (!r || r.service !== 'pppoe' || !r.pppoe_user) return { available: false, reason: 'Router readings are for home (PPPoE) lines.' };
  if (!r.host || !r.service_user || !r.service_password_enc) return { available: false, reason: 'Your router is not set up for readings yet.' };
  const id = crypto.randomBytes(12).toString('base64url');
  const st = { tenantId: sub.tenant_id, subscriberId: sub.subscriber_id, startedAt: Date.now(), samples: [], cap: null, stop: false, done: false, error: null };
  samplers.set(id, st);
  (async () => {
    let conn;
    try {
      conn = await ros.connect({ host: String(r.host).split('/')[0], port: r.api_port ?? 8728, user: r.service_user, password: secrets.decrypt(r.service_password_enc), timeoutSec: 8 });
      // The cap the router enforces: the customer's own session queue (RADIUS's rate limit), else their static queue.
      try {
        const q = (await conn.write('/queue/simple/print', [`?name=<pppoe-${r.pppoe_user}>`]))[0]
          ?? (await ros.subscriberQueueTraffic(conn, r.pppoe_user).then((x) => (x?.found ? { 'max-limit': x.limit } : null)).catch(() => null));
        if (q?.['max-limit']) st.cap = { ...parseLimit(q['max-limit']), raw: q['max-limit'] };
      } catch { /* no cap read: the package speed is used instead */ }
      while (!st.stop && Date.now() - st.startedAt < SAMPLER_MAX_MS) {
        const t0 = Date.now();
        const [m] = await conn.write('/interface/monitor-traffic', [`=interface=<pppoe-${r.pppoe_user}>`, '=once=']);
        if (!m) { st.error = 'You are not connected through your home line right now.'; break; }
        // The router's end of the session: tx is what it sends to the customer (their download), rx what it receives (their upload).
        st.samples.push({ t: Date.now() - st.startedAt, down: Math.round(Number(m['tx-bits-per-second'] ?? 0) / 1000), up: Math.round(Number(m['rx-bits-per-second'] ?? 0) / 1000) });
        await new Promise((ok) => setTimeout(ok, Math.max(0, 1000 - (Date.now() - t0))));
      }
    } catch (e) {
      st.error = 'Your router could not be reached for a reading.';
    } finally {
      if (conn) ros.close(conn);
      st.done = true;
      setTimeout(() => samplers.delete(id), 60000);
    }
  })();
  return { available: true, id };
}

export function registerSpeedTest(app, { pool, tenantByHost, wrap, portalSession = null }) {
  const noStore = (res) => res.set({ 'Cache-Control': 'no-store, no-transform', 'Content-Encoding': 'identity' });
  const tenantOf = async (req) => await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);

  app.get('/speedtest/client.js', (req, res) => {
    // no-cache: the browser asks again each time (a tiny file), so a fix to the measuring reaches everyone at once.
    res.set('Cache-Control', 'no-cache').type('application/javascript').send(CLIENT_JS);
  });

  app.get('/speedtest/ping', (req, res) => { noStore(res); res.status(204).end(); });

  app.get('/speedtest/down', budget('down', 80), (req, res) => {
    const want = Math.min(MAX_DOWN, Math.max(1024, Math.round(Number(req.query.bytes) || 8 * 1024 * 1024)));
    noStore(res);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(want), 'X-Accel-Buffering': 'no' });
    let sent = 0;
    const pump = () => {
      while (sent < want) {
        const n = Math.min(CHUNK.length, want - sent);
        sent += n;
        if (!res.write(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n))) return res.once('drain', pump);
      }
      res.end();
    };
    req.on('close', () => { sent = want; });
    pump();
  });

  // The upload is read and thrown away; only its size matters.
  app.post('/speedtest/up', budget('up', 1500), (req, res) => {
    noStore(res);
    let got = 0;
    req.on('data', (b) => { got += b.length; if (got > MAX_UP) req.destroy(); });
    req.on('end', () => res.json({ bytes: got }));
    req.on('error', () => {});
  });

  /** Start reading the customer's line on their MikroTik. Only for a signed-in portal customer, about their own line. */
  app.post('/speedtest/router/start', budget('router', 20), wrap(async (req, res) => {
    const t = await tenantOf(req);
    const s = portalSession ? await portalSession(req).catch(() => null) : null;
    if (!t || !s || s.tenant_id !== t.id) return res.json({ available: false, reason: 'Sign in to your portal for router readings.' });
    const ros = await import('./routeros.js');
    const secrets = await import('./secrets.js');
    res.json(await startSampler(pool, ros, secrets, s));
  }));

  /** Keep a finished test. Signed-in portal customers are known; a hotspot guest is known by the code they are using, if any. */
  app.post('/speedtest/result', budget('result', 20), wrap(async (req, res) => {
    const t = await tenantOf(req);
    if (!t) return res.status(404).json({ error: 'Unknown network' });
    const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null; };
    const bDown = num(req.body?.down, 10000), bUp = num(req.body?.up, 10000), ping = num(req.body?.ping, 10000), jitter = num(req.body?.jitter, 10000);
    if (bDown == null) return res.status(400).json({ error: 'No result' });
    const source = ['portal', 'wallet', 'connected'].includes(req.body?.source) ? req.body.source : 'other';
    const server = req.body?.server === 'cloudflare' ? 'cloudflare' : 'own';

    const s = portalSession ? await portalSession(req).catch(() => null) : null;
    const sub = s && s.tenant_id === t.id ? s : null;
    const code = /^[A-Za-z0-9-]{3,20}$/.test(String(req.body?.code ?? '')) ? String(req.body.code) : null;
    let planKbps = sub?.rate_down ? Number(sub.rate_down) : null;
    if (!sub && code) {
      const { rows: [v] } = await pool.query(
        'select p.rate_down from vouchers v join plans p on p.id = v.plan_id where v.tenant_id=$1 and v.code=$2', [t.id, code]).catch(() => ({ rows: [] }));
      planKbps = v?.rate_down ? Number(v.rate_down) : null;
    }

    // The router's own readings, when this test had some: taken from what the server collected, never from the page.
    let router = null;
    const st = req.body?.sampler ? samplers.get(String(req.body.sampler)) : null;
    if (st && sub && st.subscriberId === sub.subscriber_id) {
      st.stop = true;
      const w = req.body?.windows ?? {};
      const win = (k) => (Array.isArray(w[k]) && w[k].length === 2 ? [Number(w[k][0]) + WARMUP_MS, Number(w[k][1])] : null);
      const dw = win('down'), uw = win('up');
      const rDown = dw ? routerRate(st.samples, 'down', dw[0], dw[1]) : null;
      const rUp = uw ? routerRate(st.samples, 'up', uw[0], uw[1]) : null;
      router = {
        down: rDown != null ? Math.round(rDown / 10) / 100 : null, up: rUp != null ? Math.round(rUp / 10) / 100 : null,
        capDownKbps: st.cap?.downKbps ?? null, capUpKbps: st.cap?.upKbps ?? null, samples: st.samples.length, error: st.error,
      };
    }
    const byRouter = router?.down != null;
    const down = byRouter ? router.down : bDown;
    const up = router?.up ?? bUp;
    const capKbps = router?.capDownKbps ?? planKbps;
    try {
      await pool.query(
        `insert into speed_tests (tenant_id, subscriber_id, voucher_code, down_mbps, up_mbps, ping_ms, jitter_ms, plan_down_kbps, source, ip,
                                  measured_by, browser_down_mbps, browser_up_mbps, cap_up_kbps, server)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [t.id, sub?.subscriber_id ?? null, code, down, up, ping, jitter, capKbps, source, String(req.ip ?? '').slice(0, 60),
          byRouter ? 'router' : 'browser', bDown, bUp, router?.capUpKbps ?? null, server]);
    } catch (e) {
      // The table (or its newer columns) not there yet: the customer still sees their result.
      await pool.query(
        `insert into speed_tests (tenant_id, subscriber_id, voucher_code, down_mbps, up_mbps, ping_ms, jitter_ms, plan_down_kbps, source, ip)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [t.id, sub?.subscriber_id ?? null, code, down, up, ping, jitter, capKbps, source, String(req.ip ?? '').slice(0, 60)]).catch(() => {});
    }
    const share = capKbps ? down * 1000 / capKbps : null;
    let ticket = null;
    if (sub && share != null && share < SLOW_SHARE) ticket = await maybeTicket(pool, t.id, sub, capKbps).catch(() => null);
    res.json({
      ok: true, share, ticket, measuredBy: byRouter ? 'router' : 'browser', down, up,
      capMbps: capKbps ? capKbps / 1000 : null, capUpMbps: router?.capUpKbps ? router.capUpKbps / 1000 : (sub?.rate_up ? Number(sub.rate_up) / 1000 : null),
      capFromRouter: !!router?.capDownKbps, routerNote: router?.error ?? (router && !byRouter ? 'The router gave no reading during the test.' : null),
      browser: { down: bDown, up: bUp },
    });
  }));
}

/** Two slow tests in a day and no speed ticket in the last three days: open one, with the numbers in it. */
async function maybeTicket(pool, tenantId, sub, capKbps) {
  const { rows: slow } = await pool.query(
    `select down_mbps, up_mbps, ping_ms, created_at from speed_tests
      where tenant_id=$1 and subscriber_id=$2 and created_at > now() - interval '24 hours'
        and plan_down_kbps > 0 and down_mbps * 1000 < plan_down_kbps * $3
      order by created_at desc limit 5`, [tenantId, sub.subscriber_id, SLOW_SHARE]);
  if (slow.length < 2) return null;
  const { rows: [recent] } = await pool.query(
    `select 1 from tickets where tenant_id=$1 and subscriber_id=$2 and source='speedtest' and created_at > now() - interval '3 days' limit 1`,
    [tenantId, sub.subscriber_id]);
  if (recent) return null;
  const cap = Number(capKbps) / 1000;
  const { rows: [t] } = await pool.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority, source)
     values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, 'medium', 'speedtest') returning id, number`,
    [tenantId, `Slow speed: ${slow[0].down_mbps} of ${cap} Mbps`, sub.subscriber_id]);
  const lines = slow.map((x) => `${new Date(x.created_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}: `
    + `${x.down_mbps} Mbps down, ${x.up_mbps ?? '-'} up, ${x.ping_ms ?? '-'} ms ping`);
  await pool.query(
    `insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,'Speed test',$3,true)`,
    [tenantId, t.id, `The customer's own speed tests came in under ${Math.round(SLOW_SHARE * 100)}% of their ${cap} Mbps cap:\n${lines.join('\n')}`]);
  return t.number;
}

/**
 * The measuring itself, run in the customer's browser. One file for every page that offers the test (the React portal loads it
 * as a script too), so they all measure the same way.
 *   window.vlSpeedTest({ base, onProgress, router }) -> Promise<{ down, up, ping, jitter, server, sampler, windows }>
 * With router: true (the portal), the server is asked to read the customer's line on their MikroTik during the test, and
 * the result carries the sampler id and the download/upload windows (milliseconds from when the reading started) to send
 * back with /speedtest/result.
 */
export const CLIENT_JS = `(function () {
  var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };
  var CF = 'https://speed.cloudflare.com';
  function timed(url, ms, opts) {
    var c = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (c) c.abort(); }, ms);
    return fetch(url, Object.assign({ cache: 'no-store', signal: c && c.signal }, opts || {})).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r; });
  }
  // The far end: Cloudflare (servers in Kenya) when it answers quickly, else this server.
  function pickServer(base) {
    return timed(CF + '/__down?bytes=0', 3000).then(function () {
      return { name: 'cloudflare', ping: function () { return CF + '/__down?bytes=0&r=' + Math.random(); }, down: function (n) { return CF + '/__down?bytes=' + n + '&r=' + Math.random(); }, up: CF + '/__up' };
    }).catch(function () {
      return { name: 'own', ping: function () { return base + '/speedtest/ping?r=' + Math.random(); }, down: function (n) { return base + '/speedtest/down?bytes=' + n + '&r=' + Math.random(); }, up: base + '/speedtest/up' };
    });
  }
  function ping(srv, n) {
    var times = []; var i = 0;
    function one() {
      var t0 = now();
      return fetch(srv.ping(), { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }).then(function () {
        times.push(now() - t0); i += 1; return i < n ? one() : null;
      });
    }
    return one().then(function () {
      var t = times.slice(2).sort(function (a, b) { return a - b; });
      var med = t[Math.floor(t.length / 2)] || 0;
      var j = 0; for (var k = 3; k < times.length; k++) j += Math.abs(times[k] - times[k - 1]);
      return { ping: Math.round(med), jitter: Math.round(j / Math.max(1, times.length - 3)) };
    });
  }
  // Bytes after the warm-up only, so the result is the line's speed and not TCP finding its feet.
  function meter() {
    var t0 = now(), total = 0, base = null;
    return {
      add: function (n) { total += n; if (base === null && now() - t0 >= ${WARMUP_MS}) base = { bytes: total, t: now() }; },
      rate: function () {
        if (base === null) return total * 8 / Math.max(0.001, (now() - t0) / 1000) / 1e6;
        return (total - base.bytes) * 8 / Math.max(0.001, (now() - base.t) / 1000) / 1e6;
      },
    };
  }
  function download(srv, seconds, onRate) {
    var m = meter(), stopped = false, ctrls = [];
    function stream() {
      if (stopped) return Promise.resolve();
      var c = window.AbortController ? new AbortController() : null; if (c) ctrls.push(c);
      return fetch(srv.down(25000000), { cache: 'no-store', signal: c && c.signal }).then(function (r) {
        if (!r.body || !r.body.getReader) return r.arrayBuffer().then(function (b) { m.add(b.byteLength); return stream(); });
        var rd = r.body.getReader();
        function pump() { return rd.read().then(function (x) { if (x.done) return stream(); m.add(x.value.length); if (!stopped) onRate(m.rate()); return stopped ? rd.cancel() : pump(); }); }
        return pump();
      }).catch(function () {});
    }
    var all = Promise.all([stream(), stream(), stream(), stream(), stream(), stream()]);
    return new Promise(function (resolve) {
      var done = function () { if (stopped) return; var r = m.rate(); stopped = true; ctrls.forEach(function (c) { try { c.abort(); } catch (e) {} }); resolve(r); };
      var timer = setTimeout(done, seconds * 1000);
      all.then(function () { clearTimeout(timer); done(); });
    });
  }
  function upload(srv, seconds, onRate) {
    var blob = new Uint8Array(2 * 1024 * 1024); var seed = 7;
    for (var i = 0; i < blob.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; blob[i] = seed & 255; }
    var m = meter(), stopped = false, xhrs = [];
    function loop() {
      if (stopped) return Promise.resolve();
      return new Promise(function (res) {
        var x = new XMLHttpRequest(), last = 0; xhrs.push(x);
        x.open('POST', srv.up + '?r=' + Math.random());
        x.upload.onprogress = function (e) { if (stopped) return; m.add(e.loaded - last); last = e.loaded; onRate(m.rate()); };
        x.onloadend = function () { res(); };
        x.setRequestHeader('Content-Type', 'text/plain');
        x.send(blob);
      }).then(loop);
    }
    Promise.all([loop(), loop(), loop(), loop()]);
    return new Promise(function (resolve) {
      setTimeout(function () { var r = m.rate(); stopped = true; xhrs.forEach(function (x) { try { x.abort(); } catch (e) {} }); resolve(r); }, seconds * 1000);
    });
  }
  window.vlSpeedTest = function (opts) {
    opts = opts || {}; var base = opts.base || ''; var on = opts.onProgress || function () {};
    var secs = opts.seconds || 10;
    var out = { windows: {} }, srv, t0 = 0;
    on({ phase: 'ping' });
    var router = opts.router
      ? fetch(base + '/speedtest/router/start', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json(); }).catch(function () { return { available: false }; })
      : Promise.resolve({ available: false });
    return Promise.all([pickServer(base), router]).then(function (x) {
      srv = x[0]; out.server = srv.name;
      if (x[1] && x[1].available) out.sampler = x[1].id; else out.routerNote = x[1] && x[1].reason;
      t0 = Date.now();
      return ping(srv, 10);
    }).then(function (p) {
      out.ping = p.ping; out.jitter = p.jitter; on({ phase: 'down', ping: p.ping, mbps: 0 });
      var a = Date.now() - t0;
      return download(srv, secs, function (m) { on({ phase: 'down', ping: out.ping, mbps: m }); }).then(function (d) { out.windows.down = [a, Date.now() - t0]; return d; });
    }).then(function (d) {
      out.down = Math.round(d * 100) / 100; on({ phase: 'up', ping: out.ping, down: out.down, mbps: 0 });
      var a = Date.now() - t0;
      return upload(srv, secs, function (m) { on({ phase: 'up', ping: out.ping, down: out.down, mbps: m }); }).then(function (u) { out.windows.up = [a, Date.now() - t0]; return u; });
    }).then(function (u) {
      out.up = Math.round(u * 100) / 100; on({ phase: 'done', ping: out.ping, down: out.down, up: out.up });
      return out;
    });
  };
})();`;

/** The same small speed test panel for the plain pages (wallet, "You're connected"): markup, and the script that drives it. */
export function speedPanel({ apiBase = '', source = 'other', code = null, planMbps = null }) {
  const cfg = JSON.stringify({ base: apiBase, source, code, plan: planMbps }).replace(/</g, '\\u003c');
  return {
    html: `<div class="st"><div class="st-big"><b id="stNum">–</b> <span>Mbps</span></div>
  <div class="st-sub" id="stPhase">Measures your connection: download, upload and ping.</div>
  <div class="st-tri"><div><b id="stDown">–</b><span>Down</span></div><div><b id="stUp">–</b><span>Up</span></div><div><b id="stPing">–</b><span>Ping ms</span></div></div>
  <div class="st-sub" id="stVerdict"></div>
  <button type="button" id="stGo">Test my speed</button></div>`,
    css: `.st{display:grid;gap:8px;text-align:center}.st-big b{font-size:34px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.st-big span,.st-sub{color:#6f766b;font-size:13px}.st-tri{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.st-tri div{border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:6px 2px}.st-tri b{display:block;font-size:15px;font-variant-numeric:tabular-nums}
.st-tri span{font-size:11.5px;color:#6f766b}`,
    js: `(function () {
  var S = ${cfg}; var $ = function (id) { return document.getElementById(id); };
  var load = function () { return window.vlSpeedTest ? Promise.resolve() : new Promise(function (ok, no) { var s = document.createElement('script'); s.src = S.base + '/speedtest/client.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); };
  var f = function (n) { return n >= 100 ? Math.round(n) : (Math.round(n * 10) / 10); };
  $('stGo').onclick = function () {
    $('stGo').disabled = true; $('stVerdict').textContent = '';
    load().then(function () {
      return window.vlSpeedTest({ base: S.base, onProgress: function (p) {
        $('stPhase').textContent = p.phase === 'ping' ? 'Checking ping…' : p.phase === 'down' ? 'Testing download…' : p.phase === 'up' ? 'Testing upload…' : 'Done';
        if (p.ping != null) $('stPing').textContent = p.ping;
        if (p.phase === 'down') { $('stNum').textContent = f(p.mbps); }
        if (p.down != null) $('stDown').textContent = f(p.down);
        if (p.phase === 'up') $('stNum').textContent = f(p.mbps);
        if (p.up != null) { $('stUp').textContent = f(p.up); $('stNum').textContent = f(p.down); }
      } });
    }).then(function (r) {
      return fetch(S.base + '/speedtest/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ down: r.down, up: r.up, ping: r.ping, jitter: r.jitter, server: r.server, source: S.source, code: S.code || (window.vlCode && window.vlCode()) || null }) })
        .then(function (x) { return x.json(); }).catch(function () { return {}; }).then(function (k) {
          var cap = k.capMbps || S.plan;
          if (cap) $('stVerdict').textContent = Math.round(r.down / cap * 100) + '% of your ' + cap + ' Mbps bundle' + (k.ticket ? '. We have opened ticket ' + k.ticket + ' to look into it.' : '.');
        });
    }).catch(function () { $('stPhase').textContent = 'The test could not finish. Check your connection and try again.'; })
      .then(function () { $('stGo').disabled = false; $('stGo').textContent = 'Test again'; });
  };
})();`,
  };
}
