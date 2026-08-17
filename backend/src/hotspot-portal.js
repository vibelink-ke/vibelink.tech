/**
 * The captive-portal login page served to hotspot guests.
 *
 * Rendered here rather than shipped as a static file because it is per tenant:
 * the company name, the plans and their prices all come from the database, and a
 * file on the router cannot know any of that.
 *
 * The router does not proxy this. RouterOS fetches it once and serves it from
 * its own storage, so everything must be inline — no stylesheet, no script file,
 * no font, no image URL. A guest has not logged in yet, so the only hosts their
 * browser can reach are the router itself and whatever the walled garden allows.
 *
 * The $(...) tokens are MikroTik's. RouterOS substitutes them when it serves the
 * page: $(link-login-only) is the form target, $(error) is the message from a
 * failed attempt, $(link-orig) is where the guest was heading. They must survive
 * into the output untouched, which is why nothing here escapes them.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE')}`;

/** Minutes to something a person reads: 60 -> "1 hour", 1440 -> "1 day". */
function duration(min) {
  const m = Number(min) || 0;
  if (m >= 43200) return `${Math.round(m / 43200)} month${m >= 86400 ? 's' : ''}`;
  if (m >= 1440) return `${Math.round(m / 1440)} day${m >= 2880 ? 's' : ''}`;
  if (m >= 60) return `${Math.round(m / 60)} hour${m >= 120 ? 's' : ''}`;
  return `${m} minutes`;
}

export function loginPage({
  company = 'WiFi', plans = [], supportPhone = null, portalUrl = null, preview = false,
}) {
  const planCards = plans.length
    ? plans.map((p) => `
      <li class="plan">
        <div>
          <strong>${esc(p.title)}</strong>
          <span class="meta">${esc(duration(p.duration_min))} · ${esc(String(p.rate_down / 1000))} Mbps</span>
        </div>
        <span class="price">${esc(money(p.price))}</span>
      </li>`).join('')
    : '<li class="plan"><span class="meta">No bundles are on sale right now.</span></li>';

  // The buy button leaves the walled garden for the tenant's own portal, which
  // is the only place that can take a payment. Rendered only when we know that
  // address — a dead button is worse than none.
  const buyBlock = portalUrl ? `
      <a class="buy" href="${esc(portalUrl)}/customer">Buy a code</a>
      <p class="hint">No code yet? You can pay without connecting first.</p>` : '';

  // Said plainly. Someone looking at this on the root domain is evaluating the
  // product, and letting them think it is their own live page wastes their time
  // when the bundles turn out to be invented.
  const previewNote = preview
    ? '<p class="note">Example page. Each ISP gets this on their own subdomain, '
      + 'with their name, their bundles and their prices.</p>'
    : '';

  const help = supportPhone
    ? `<p class="hint">Need help? Call <a href="tel:${esc(supportPhone)}">${esc(supportPhone)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(company)} WiFi</title>
<style>
  :root { --ink:#161a17; --muted:#6b736c; --line:#e4e6e1; --green:#0f7a5f; --bg:#f5f6f3; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--ink); padding:20px;
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { width:100%; max-width:380px; background:#fff; border:1px solid var(--line);
          border-radius:14px; padding:26px 22px; }
  h1 { margin:0 0 2px; font-size:21px; }
  .sub { margin:0 0 20px; color:var(--muted); font-size:13.5px; }
  label { display:block; font-size:12.5px; color:var(--muted); margin:12px 0 5px; }
  input { width:100%; padding:11px 12px; font-size:16px; border:1px solid var(--line);
          border-radius:9px; background:#fafbf9; color:var(--ink); }
  /* 16px on inputs is deliberate: anything smaller makes iOS Safari zoom in on
     focus, which shoves the form off screen on the phones most guests use. */
  button { width:100%; margin-top:18px; padding:12px; font-size:15px; font-weight:600;
           color:#fff; background:var(--green); border:0; border-radius:9px; cursor:pointer; }
  .plans { list-style:none; margin:20px 0 0; padding:16px 0 0; border-top:1px solid var(--line); }
  .plan { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:7px 0; }
  .meta { display:block; color:var(--muted); font-size:12.5px; }
  .price { font-weight:600; white-space:nowrap; }
  .buy { display:block; margin-top:14px; padding:11px; text-align:center; font-weight:600;
         text-decoration:none; color:var(--green); border:1px solid var(--green); border-radius:9px; }
  .hint { margin:10px 0 0; font-size:12.5px; color:var(--muted); text-align:center; }
  .note { margin:0 0 16px; padding:9px 11px; border-radius:8px; font-size:12.5px;
          color:#7d5c11; background:#fdf3dc; border:1px solid #ecd9a8; }
  .err { margin:0 0 14px; padding:9px 11px; border-radius:8px; font-size:13px;
         color:#8a2d16; background:#fdece5; border:1px solid #f3c7b6; }
  a { color:var(--green); }
</style>
</head>
<body>
  <div class="card">
    <h1>${esc(company)}</h1>
    <p class="sub">Enter your voucher code to get online</p>
    ${previewNote}

    $(if error)<p class="err">$(error)</p>$(endif)

    <!--
      One field, not two.

      A hotspot guest has no account. They buy a voucher and type the code, and
      issueVoucherAccess stores that code as both the RADIUS username and its
      Cleartext-Password — so asking for a username and a password separately
      demanded a distinction that does not exist and left people guessing what
      to put where.

      The router's login form still wants both fields, so the code is copied
      into a hidden password on submit. The script is inline and tiny because
      the page is served by the router to a guest who cannot reach anything
      else; an external file would simply not load.
    -->
    <form action="$(link-login-only)" method="post" onsubmit="document.getElementById('password').value = document.getElementById('username').value;">
      <input type="hidden" name="dst" value="$(link-orig)">
      <label for="username">Voucher code</label>
      <input id="username" name="username" type="text" inputmode="numeric"
             autocomplete="one-time-code" autocapitalize="characters" autocorrect="off"
             spellcheck="false" placeholder="Type the code from your voucher" required>
      <input id="password" name="password" type="hidden">
      <button type="submit">Connect</button>
    </form>

    <ul class="plans">${planCards}</ul>
    ${buyBlock}
    ${help}
  </div>
</body>
</html>`;
}
