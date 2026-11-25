import crypto from 'node:crypto';

/**
 * A speed test customers run themselves: from their portal, the visitor wallet and the "You're connected" page.
 *
 * It measures from the customer's device to this server: through their router, your network and your internet link. A test
 * that is slow here and fast on a big public speed test points at the route between your link and this server, so the
 * result is shown next to the speed the customer pays for, not as a verdict on its own.
 *
 * The browser does the measuring (client.js below): a short ping, then about eight seconds of download on four streams and
 * eight seconds of upload on three. Every test a signed-in customer runs is kept on their client page, and a home customer
 * who tests far below their package twice in a day gets a ticket opened for them, at most once every three days.
 */

const CHUNK = crypto.randomBytes(1 << 20);         // 1 MB of noise, sent over and over: random so nothing on the way can compress it
const MAX_DOWN = 30 * 1024 * 1024;                  // per stream
const MAX_UP = 12 * 1024 * 1024;                    // per request
const SLOW_SHARE = 0.4;                             // below 40% of the package counts as slow

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

export function registerSpeedTest(app, { pool, tenantByHost, wrap, portalSession = null }) {
  const noStore = (res) => res.set({ 'Cache-Control': 'no-store, no-transform', 'Content-Encoding': 'identity' });
  const tenantOf = async (req) => await tenantByHost(req.hostname) ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);

  app.get('/speedtest/client.js', (req, res) => {
    // no-cache: the browser asks again each time (a tiny file), so a fix to the measuring reaches everyone at once.
    res.set('Cache-Control', 'no-cache').type('application/javascript').send(CLIENT_JS);
  });

  app.get('/speedtest/ping', (req, res) => { noStore(res); res.status(204).end(); });

  app.get('/speedtest/down', budget('down', 60), (req, res) => {
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

  /** Keep a finished test. Signed-in portal customers are known; a hotspot guest is known by the code they are using, if any. */
  app.post('/speedtest/result', budget('result', 20), wrap(async (req, res) => {
    const t = await tenantOf(req);
    if (!t) return res.status(404).json({ error: 'Unknown network' });
    const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null; };
    const down = num(req.body?.down, 10000), up = num(req.body?.up, 10000), ping = num(req.body?.ping, 10000), jitter = num(req.body?.jitter, 10000);
    if (down == null) return res.status(400).json({ error: 'No result' });
    const source = ['portal', 'wallet', 'connected'].includes(req.body?.source) ? req.body.source : 'other';

    const s = portalSession ? await portalSession(req).catch(() => null) : null;
    const sub = s && s.tenant_id === t.id ? s : null;
    const code = /^[A-Za-z0-9-]{3,20}$/.test(String(req.body?.code ?? '')) ? String(req.body.code) : null;
    let planKbps = sub?.rate_down ? Number(sub.rate_down) : null;
    if (!sub && code) {
      const { rows: [v] } = await pool.query(
        'select p.rate_down from vouchers v join plans p on p.id = v.plan_id where v.tenant_id=$1 and v.code=$2', [t.id, code]).catch(() => ({ rows: [] }));
      planKbps = v?.rate_down ? Number(v.rate_down) : null;
    }
    try {
      await pool.query(
        `insert into speed_tests (tenant_id, subscriber_id, voucher_code, down_mbps, up_mbps, ping_ms, jitter_ms, plan_down_kbps, source, ip)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [t.id, sub?.subscriber_id ?? null, code, down, up, ping, jitter, planKbps, source, String(req.ip ?? '').slice(0, 60)]);
    } catch (e) {
      // The speed_tests table not created yet: the visitor still sees their result.
      return res.json({ ok: true, kept: false, share: planKbps ? down * 1000 / planKbps : null });
    }
    const share = planKbps ? down * 1000 / planKbps : null;
    let ticket = null;
    if (sub && share != null && share < SLOW_SHARE) ticket = await maybeTicket(pool, t.id, sub).catch(() => null);
    res.json({ ok: true, kept: true, share, planMbps: planKbps ? planKbps / 1000 : null, ticket });
  }));
}

/** Two slow tests in a day and no speed ticket in the last three days: open one, with the numbers in it. */
async function maybeTicket(pool, tenantId, sub) {
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
  const plan = Number(sub.rate_down) / 1000;
  const { rows: [t] } = await pool.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority, source)
     values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, 'medium', 'speedtest') returning id, number`,
    [tenantId, `Slow speed: ${slow[0].down_mbps} of ${plan} Mbps`, sub.subscriber_id]);
  const lines = slow.map((x) => `${new Date(x.created_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}: `
    + `${x.down_mbps} Mbps down, ${x.up_mbps ?? '-'} up, ${x.ping_ms ?? '-'} ms ping`);
  await pool.query(
    `insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,'Speed test',$3,true)`,
    [tenantId, t.id, `The customer's own speed tests came in under ${Math.round(SLOW_SHARE * 100)}% of their ${plan} Mbps package:\n${lines.join('\n')}`]);
  return t.number;
}

/**
 * The measuring itself, run in the customer's browser. One file for every page that offers the test (the React portal loads it
 * as a script too), so they all measure the same way. window.vlSpeedTest({ base, onProgress }) -> Promise<{ down, up, ping, jitter }>.
 */
export const CLIENT_JS = `(function () {
  var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };
  function ping(base, n) {
    var times = []; var i = 0;
    function one() {
      var t0 = now();
      return fetch(base + '/speedtest/ping?r=' + Math.random(), { cache: 'no-store' }).then(function () {
        times.push(now() - t0); i += 1; return i < n ? one() : null;
      });
    }
    return one().then(function () {
      var t = times.slice(2).sort(function (a, b) { return a - b; });
      var med = t[Math.floor(t.length / 2)] || 0;
      var j = 0; for (var k = 1; k < times.length; k++) j += Math.abs(times[k] - times[k - 1]);
      return { ping: Math.round(med), jitter: Math.round(j / Math.max(1, times.length - 1)) };
    });
  }
  function download(base, seconds, onRate) {
    var total = 0, t0 = now(), stopped = false, ctrls = [];
    function stream() {
      if (stopped) return Promise.resolve();
      var c = window.AbortController ? new AbortController() : null; if (c) ctrls.push(c);
      return fetch(base + '/speedtest/down?bytes=' + (30 * 1024 * 1024) + '&r=' + Math.random(), { cache: 'no-store', signal: c && c.signal }).then(function (r) {
        if (!r.body || !r.body.getReader) return r.arrayBuffer().then(function (b) { total += b.byteLength; return stream(); });
        var rd = r.body.getReader();
        function pump() { return rd.read().then(function (x) { if (x.done) return stream(); total += x.value.length; if (!stopped) onRate(total * 8 / ((now() - t0) / 1000) / 1e6); return stopped ? rd.cancel() : pump(); }); }
        return pump();
      }).catch(function () {});
    }
    var all = Promise.all([stream(), stream(), stream(), stream()]);
    return new Promise(function (resolve) {
      var done = function () { if (stopped) return; stopped = true; ctrls.forEach(function (c) { try { c.abort(); } catch (e) {} }); resolve(total * 8 / ((now() - t0) / 1000) / 1e6); };
      var timer = setTimeout(done, seconds * 1000);
      all.then(function () { clearTimeout(timer); done(); });
    });
  }
  function upload(base, seconds, onRate) {
    var blob = new Uint8Array(1024 * 1024); var seed = 7;
    for (var i = 0; i < blob.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; blob[i] = seed & 255; }
    var total = 0, t0 = now(), stopped = false, xhrs = [];
    function loop() {
      if (stopped) return Promise.resolve();
      return new Promise(function (res) {
        var x = new XMLHttpRequest(), last = 0; xhrs.push(x);
        x.open('POST', base + '/speedtest/up?r=' + Math.random());
        x.upload.onprogress = function (e) { if (stopped) return; total += e.loaded - last; last = e.loaded; onRate(total * 8 / ((now() - t0) / 1000) / 1e6); };
        x.onloadend = function () { res(); };
        x.setRequestHeader('Content-Type', 'application/octet-stream');
        x.send(blob);
      }).then(loop);
    }
    var all = Promise.all([loop(), loop(), loop()]);
    return new Promise(function (resolve) {
      setTimeout(function () { var rate = total * 8 / ((now() - t0) / 1000) / 1e6; stopped = true; xhrs.forEach(function (x) { try { x.abort(); } catch (e) {} }); resolve(rate); }, seconds * 1000);
      all.then(function () {});
    });
  }
  window.vlSpeedTest = function (opts) {
    opts = opts || {}; var base = opts.base || ''; var on = opts.onProgress || function () {};
    var out = {};
    on({ phase: 'ping' });
    return ping(base, 8).then(function (p) {
      out.ping = p.ping; out.jitter = p.jitter; on({ phase: 'down', ping: p.ping, mbps: 0 });
      return download(base, opts.seconds || 8, function (m) { on({ phase: 'down', ping: out.ping, mbps: m }); });
    }).then(function (d) {
      out.down = Math.round(d * 100) / 100; on({ phase: 'up', ping: out.ping, down: out.down, mbps: 0 });
      return upload(base, opts.seconds || 8, function (m) { on({ phase: 'up', ping: out.ping, down: out.down, mbps: m }); });
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
  <div class="st-sub" id="stPhase">Measures your connection to us: download, upload and ping.</div>
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
        body: JSON.stringify({ down: r.down, up: r.up, ping: r.ping, jitter: r.jitter, source: S.source, code: S.code || (window.vlCode && window.vlCode()) || null }) })
        .then(function (x) { return x.json(); }).catch(function () { return {}; }).then(function (k) {
          var plan = k.planMbps || S.plan;
          if (plan) $('stVerdict').textContent = Math.round(r.down / plan * 100) + '% of your ' + plan + ' Mbps package' + (k.ticket ? '. We have opened ticket ' + k.ticket + ' to look into it.' : '.');
        });
    }).catch(function () { $('stPhase').textContent = 'The test could not finish. Check your connection and try again.'; })
      .then(function () { $('stGo').disabled = false; $('stGo').textContent = 'Test again'; });
  };
})();`,
  };
}
