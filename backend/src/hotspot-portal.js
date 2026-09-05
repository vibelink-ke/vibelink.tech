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

/**
 * Proof that a downloaded page is this page.
 *
 * Caddy served the React bundle for /hotspot/* for a while, so the router
 * fetched 715 bytes of index.html and installed it as the login page — a blank
 * white screen for every guest, and a push that reported success. A size check
 * cannot tell those apart; a marker can.
 */
export const MARKER = 'vibelink-hotspot-login';

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

/**
 * Look, chosen in Hotspot -> Settings or the newer Portal design screen.
 *
 * sleek/dark/bold/plain are colour-only — always the same list of bundle
 * cards, one "Buy" button per bundle. kadogo..bingwa carry the structural
 * flags from frontend/src/screens/hotspot/templates.js's BASE_TEMPLATES too
 * (grid/bigCta/codeBox/banner below, transcribed by hand — the frontend and
 * this backend render engine are separate deployments with no shared import
 * path, so there is no single source of truth to import from):
 *
 *   grid    bundles as a two-column grid of self-contained tiles, not rows
 *   bigCta  the whole bundle row is the tap target (no separate Buy button) —
 *           "one tap" and "oversized tap targets" in their descriptions
 *   codeBox the voucher-code sign-in form gets a highlighted box, not a bare form
 *   banner  a small trust/contact strip under the headline
 *
 * bg and card are equal for the eight because templates.js authored them as
 * one flat surface, not the page-behind-a-card look sleek/dark/bold/plain use.
 */
const TEMPLATES = {
  sleek:  { bg: '#f5f6f3', card: '#ffffff', ink: '#161a17', accent: '#0f7a5f', radius: '14px' },
  dark:   { bg: '#12171a', card: '#1b2227', ink: '#eef2f0', accent: '#2fbf8f', radius: '14px' },
  bold:   { bg: '#0f7a5f', card: '#ffffff', ink: '#161a17', accent: '#0b5c47', radius: '18px' },
  plain:  { bg: '#ffffff', card: '#ffffff', ink: '#111111', accent: '#1b6fd6', radius: '6px' },
  kadogo:    { bg: '#12211d', card: '#12211d', ink: '#eaf3ef', accent: '#2fbf8f', radius: '14px', bigCta: true },
  duka:      { bg: '#ffffff', card: '#ffffff', ink: '#161a17', accent: '#0f7a5f', radius: '14px', codeBox: true, banner: true },
  soko:      { bg: '#f7f8f5', card: '#f7f8f5', ink: '#161a17', accent: '#0f7a5f', radius: '14px', grid: true, bigCta: true },
  sponsored: { bg: '#ffffff', card: '#ffffff', ink: '#161a17', accent: '#c9a227', radius: '14px', banner: true },
  mwanga:    { bg: '#ffffff', card: '#ffffff', ink: '#161a17', accent: '#a5451f', radius: '14px', bigCta: true },
  rahisi:    { bg: '#f4f4f2', card: '#f4f4f2', ink: '#161a17', accent: '#12211d', radius: '14px' },
  kijani:    { bg: '#eef4f1', card: '#eef4f1', ink: '#12211d', accent: '#0f7a5f', radius: '14px', grid: true, banner: true },
  // Monthly (longest-duration) plans front and center, matching "monthly
  // plans up front" — the one template where order isn't just cheapest first.
  bingwa:    { bg: '#1b2430', card: '#1b2430', ink: '#eef2f6', accent: '#c9a227', radius: '14px', bigCta: true, monthlyFirst: true },
};

/**
 * White button text on kadogo's mint and sponsored/bingwa's gold measured
 * under 2.5:1 contrast — well below WCAG's 4.5:1 floor for body text, and
 * still short even of the 3:1 floor that applies to large/bold UI text —
 * on the two buttons (Connect, Send M-Pesa request) that matter most on
 * this entire page. Hardcoding a fixed white next to a per-template accent
 * was never going to hold for every accent that gets added later, so this
 * computes it instead: relative luminance (WCAG's own formula) against
 * both black and white ink, and picks whichever actually contrasts more —
 * correct for the two failing accents above without needing to also predict
 * which way any future accent will lean.
 */
function bestInkOn(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = chan((n >> 16) & 255), g = chan((n >> 8) & 255), b = chan(n & 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const onWhite = 1.05 / (lum + 0.05);
  const onBlack = (lum + 0.05) / 0.05;
  return onWhite >= onBlack ? '#ffffff' : '#161a17';
}

export function loginPage({
  company = 'WiFi', plans = [], supportPhone = null, portalUrl = null, preview = false,
  headline = null, subtext = null, forRouter = false, template = 'sleek', tvMode = false,
  redirectUrl = null, prefillCode = null, routerId = null, hotspotDns = 'billing.spot',
}) {
  const t = TEMPLATES[template] ?? TEMPLATES.sleek;
  const btnInk = bestInkOn(t.accent);
  // bingwa fronts its longest-duration (monthly) plans; every other template
  // keeps whatever order the caller already sorted by (price ascending).
  const orderedPlans = t.monthlyFirst
    ? [...plans].sort((a, b) => (b.duration_min ?? 0) - (a.duration_min ?? 0))
    : plans;
  // Where the page should send its purchase requests. Empty on the preview,
  // where the page is already being served by the billing system itself.
  const apiBase = portalUrl ?? '';
  // $(link-orig) only means something when the guest was genuinely
  // intercepted mid-request; a guest who opened the portal directly has
  // nothing there to return to and it ends up pointing at the login page
  // itself, which reads exactly like the redirect not happening. Our own
  // confirmation page always resolves, so it is the default rather than
  // link-orig — an operator-set redirectUrl still wins over both.
  const fallbackDst = apiBase ? `${apiBase}/hotspot/connected` : '$(link-orig)';
  /**
   * An operator typing a redirect into Hotspot -> Settings has no reason to
   * know it needs a scheme — "google.com" reads as a complete address to
   * anyone who isn't thinking about how a browser resolves it. Submitted
   * bare as `dst`, RouterOS's own $(link-login-only) target treats it as a
   * path relative to the router's own hotspot address, not an external
   * site — the guest gets redirected to something like
   * http://<router-ip>/google.com, a 404 on a box with nothing there,
   * which reads exactly like "the redirect after login doesn't work" and
   * nothing about it says why. Normalizing to https:// here is the only
   * point that can catch this — hotspot_settings itself stores whatever was
   * typed, unvalidated.
   */
  const normalizedRedirect = redirectUrl?.trim()
    ? (/^https?:\/\//i.test(redirectUrl.trim()) ? redirectUrl.trim() : `https://${redirectUrl.trim()}`)
    : null;

  /**
   * The failed-login message, and only for the copy the router will serve.
   *
   * `error` is defined by RouterOS only when a login has just failed. Referring
   * to it bare stopped the template dead at that point: the header rendered and
   * the form, the bundles and the script after it were all discarded — a page
   * that looked deliberately minimal rather than broken.
   *
   * $(if ...) is the documented way to reference it and is what the stock page
   * uses. It is omitted entirely from the copy a person opens in a browser,
   * where nothing substitutes it and the raw markup would be shown as text.
   */
  const errorBlock = forRouter
    ? '$(if error)<p class="err">$(error)</p>$(endif)'
    : '';

  // RouterOS's own $(mac) — the guest's device, not a real value in the
  // preview or the copy a person opens directly, same reasoning as $(error).
  const macToken = forRouter ? '$(mac)' : '';
  /**
   * A failed attempt just bounced back here with $(error) set — auto-login
   * would otherwise immediately resubmit the same voucher and loop.
   *
   * This used to be substituted as a bare, unquoted JS boolean —
   * `$(if error)true$(else)false$(endif)` spliced directly into `var
   * hadError = ...;` with no quotes around it. If RouterOS ever failed to
   * evaluate that conditional for any reason (a quirk of $(if)/$(endif)
   * inside a <script> block rather than HTML body, a version difference,
   * anything), the literal, un-substituted text landed in the page exactly
   * as written and browsers threw "Unexpected token 'if'" trying to parse
   * it as JavaScript — which is fatal to the *entire* inline script, not
   * just this line: every button on the page (Buy, Talk to support,
   * Connect) silently stopped doing anything, because none of the code
   * defining their click handlers ever ran at all.
   *
   * Wrapped in quotes now instead, the same way mac and prefillCode already
   * are below — a single $(if error)yes$(endif) block (no $(else) needed;
   * RouterOS omits the block entirely when the condition is false) that
   * becomes a quoted string either way. Un-substituted, it is still a
   * harmless string literal, not a syntax error: "$(if error)yes$(endif)"
   * is valid JS, it just isn't "yes", so hadError degrades to false instead
   * of taking the whole script down with it.
   */
  const hadErrorToken = forRouter ? '$(if error)yes$(endif)' : '';
  // Each bundle carries its own button. A single "buy" link elsewhere on the
  // page made the guest choose twice — once here and again on another screen —
  // and the price they had just read was no longer in front of them.
  //
  // Price and Buy are two separate elements, not one button doing both jobs —
  // the price used to be the button itself, so a guest scanning bundles by
  // price had nothing to actually read: every number on the page was already
  // a tappable "buy this now," which reads as more decisive than "how much
  // is this" is meant to be. Price sits still now; Buy is its own explicit
  // action next to it.
  const planCards = orderedPlans.length
    ? orderedPlans.map((p) => {
        const planId = esc(p.id ?? '');
        const title = esc(p.title);
        const meta = `${esc(duration(p.duration_min))} · ${esc(String(p.rate_down / 1000))} Mbps`;
        const price = esc(money(p.price));
        // bigCta: the whole row is the tap target (class="buy" straight on
        // the <li>, same data-plan/data-title the click handler below already
        // reads off whatever element was actually clicked) — no separate
        // button squeezed onto the row, which is the entire point of "one
        // tap" and "oversized tap targets" in these templates' descriptions.
        if (t.bigCta) {
          return `
      <li class="plan bigcta buy" data-plan="${planId}" data-title="${title}">
        <div class="plan-name">
          <strong>${title}</strong>
          <span class="meta">${meta}</span>
        </div>
        <span class="price">${price}</span>
        <span class="chev" aria-hidden="true">&rsaquo;</span>
      </li>`;
        }
        return `
      <li class="plan">
        <div class="plan-name">
          <strong>${title}</strong>
          <span class="meta">${meta}</span>
        </div>
        <span class="price">${price}</span>
        <button type="button" class="buy" data-plan="${planId}"
                data-title="${title}">Buy</button>
      </li>`;
      }).join('')
    : '<li class="plan"><span class="meta">No bundles are on sale right now.</span></li>';

  // grid: bundles as a two-column grid of self-contained tiles instead of a
  // vertical list of rows — soko and kijani's "6+ plans"/"brand-led" look.
  const plansClass = t.grid ? 'plans grid' : 'plans';

  // codeBox: the voucher sign-in form gets a highlighted box instead of
  // sitting as a bare form — duka's "voucher-code box above the fold". The
  // form itself does not move; it was already the first thing after the
  // headline for every template.
  const codeBoxOpen = t.codeBox ? '<div class="codebox">' : '';
  const codeBoxClose = t.codeBox ? '</div>' : '';

  // banner: a small trust/contact strip under the headline — sponsored,
  // duka and kijani's "banner/promo slot". There is no separate ad-content
  // field on the tenant yet, so this surfaces the one thing already true of
  // every hotspot (M-Pesa checkout) plus the support number when one is set,
  // rather than inventing content that isn't there.
  const bannerBlock = t.banner
    ? `<div class="banner">${supportPhone
        ? `Need help? <a href="tel:${esc(supportPhone)}">${esc(supportPhone)}</a> · Secure M-Pesa checkout`
        : 'Secure M-Pesa checkout &middot; instant activation'}</div>`
    : '';

  // No banner on the preview. The page is shown to operators to judge how it
  // looks, and a notice explaining itself is the first thing they asked to have
  // removed. The invented bundles are inert there anyway: they carry no id, so
  // the buttons say so rather than starting a payment that cannot complete.
  const previewNote = '';

  const help = supportPhone
    ? `<p class="hint">Need help? Call <a href="tel:${esc(supportPhone)}">${esc(supportPhone)}</a></p>`
    : '';

  /**
   * RouterOS serves this copy inside the OS's own "Sign in to Wi-Fi" pop-up
   * — a restricted WebView that, on enough phones, either blocks JavaScript
   * outright or kills the pop-up mid-script the moment the OS's own
   * connectivity probe succeeds. Buy is a JS click handler, so on that class
   * of device it looked like the button "did nothing" — the guest already
   * had a working escape hatch (the link below, plain navigation, no JS
   * needed), they just had no reason to notice or use it before trying Buy
   * first. A meta-refresh needs no JavaScript at all to fire, so it reaches
   * every guest regardless of what their WebView allows, and bounces them
   * straight to a real browser tab of the exact same page before they ever
   * see a Buy button that might not work. router is preserved so the sale
   * still attributes to this site.
   */
  //
  // siteRouter, deliberately not router=: that param is what server.js reads
  // as "RouterOS itself fetched this," which is exactly the thing that must
  // stay false on the page this redirects to — router=<id> here would send
  // guests bouncing between the two copies forever. siteRouter only ever
  // carries the attribution id through.
  const routerRedirect = forRouter && apiBase
    ? `<meta http-equiv="refresh" content="0;url=${esc(apiBase)}/hotspot/login.html${routerId ? `?siteRouter=${encodeURIComponent(routerId)}` : ''}">`
    : '';

  return `<!DOCTYPE html>
<!-- ${MARKER} -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${routerRedirect}
<title>${esc(company)} WiFi</title>
${apiBase ? `<link rel="icon" href="${esc(apiBase)}/api/public/favicon">` : ''}
<style>
  :root { --ink:${t.ink}; --muted:#8a9186; --line:rgba(128,128,128,.25);
          --green:${t.accent}; --greenDark:${t.accent}; --bg:${t.bg};
          --card:${t.card}; --rad:${t.radius}; --btnInk:${btnInk}; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--ink); padding:20px;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { width:100%; max-width:${tvMode ? '620px' : '440px'}; background:var(--card);
          border:1px solid var(--line); border-radius:var(--rad);
          padding:${tvMode ? '40px 34px' : '26px 22px'}; }
  /* Television: read from a sofa, and typed with a remote. Everything scales up
     and the code box gets wide, spaced characters so a wrong digit is obvious
     from across the room. */
  ${tvMode ? `
  body { font-size:20px; }
  h1 { font-size:34px !important; }
  .sub { font-size:19px !important; }
  input { font-size:30px !important; letter-spacing:.35em; text-align:center; padding:18px !important; }
  button { font-size:22px !important; padding:18px !important; }
  .plan strong { font-size:21px; }
  .meta, .hint { font-size:16px !important; }
  ` : ''}
  h1 { margin:0 0 2px; font-size:24px; }
  .sub { margin:0 0 20px; color:var(--muted); font-size:15px; }
  label { display:block; font-size:14px; color:var(--muted); margin:12px 0 5px; }
  /* Background is a fixed light color regardless of template, so the text
     color has to be fixed dark too — using var(--ink) here made typed text
     on the 'dark' template (near-white ink) nearly invisible against this
     always-light field. */
  input { width:100%; padding:11px 12px; font-size:17px; border:1px solid var(--line);
          border-radius:9px; background:#fafbf9; color:#161a17; }
  /* 16px+ on inputs is deliberate: anything smaller makes iOS Safari zoom in on
     focus, which shoves the form off screen on the phones most guests use. */
  button { width:100%; margin-top:18px; padding:13px; font-size:16px; font-weight:600;
           color:var(--btnInk); background:var(--green); border:0; border-radius:9px; cursor:pointer; }
  .plans { list-style:none; margin:20px 0 0; padding:16px 0 0; border-top:1px solid var(--line); }
  .plans-title { font-size:14px; color:var(--muted); margin:0 0 10px; }
  /* Three parts now, not two: name (grows to fill the row), then price and
     Buy sitting together at the end — price is no longer the button, so
     space-between alone would strand it in the middle of the row instead of
     next to the action it describes. */
  .plan { display:flex; align-items:center; gap:14px;
          padding:10px 0; border-bottom:1px solid var(--line); }
  .plan:last-child { border-bottom:0; }
  .plan-name { min-width:0; flex:1 1 auto; }
  .plan-name strong { display:block; font-size:16px; }
  .meta { display:block; color:var(--muted); font-size:14px; white-space:nowrap; }
  .price { font-weight:600; white-space:nowrap; flex:0 0 auto; }
  /* width:auto and margin-top:0 undo the global button rule above, which exists
     for Connect. Without them every price button stretched to the full width of
     the card and squeezed the bundle name into a two-line column. */
  .buy { width:auto; margin-top:0; padding:9px 15px; font-size:15px; font-weight:600;
         white-space:nowrap; color:var(--btnInk); background:var(--green); border:0;
         border-radius:8px; cursor:pointer; min-width:96px; }
  .buy:hover { background:var(--greenDark); }
  /* bigCta templates: the row itself is the button (no separate .buy button
     rendered inside it), so it needs its own tap affordance and a bigger
     hit area than a plain list row. */
  li.plan.bigcta { cursor:pointer; padding:16px 4px; }
  /* bigCta rows carry class="buy" too (see planCards above) purely so the
     click handler's existing 'was this a buy tap' check keeps working —
     .buy's solid accent background/text-color rules are NOT wanted here:
     applied to the whole row they turned every bigCta bundle into a block
     of solid accent color, and --muted's subtext (tuned for sitting on
     --card/--bg) read at a barely-legible ~2:1 contrast on top of it. */
  li.plan.bigcta.buy { background:none; color:var(--ink); border-radius:0; }
  li.plan.bigcta.buy:hover, li.plan.bigcta.buy:active { background:rgba(127,127,127,.08); }
  li.plan.bigcta .price { color:var(--green); }
  .plan .chev { color:var(--muted); font-size:22px; flex:0 0 auto; line-height:1; }
  /* grid: bundles as self-contained tiles, two per row, instead of full-width
     rows separated by a bottom border. */
  .plans.grid { display:grid; grid-template-columns:1fr 1fr; gap:10px;
                border-top:0; padding-top:0; }
  .plans.grid .plan { flex-direction:column; align-items:flex-start; gap:6px;
                       border:1px solid var(--line); border-radius:10px;
                       padding:12px; }
  .plans.grid .plan-name { width:100%; }
  .plans.grid .price { align-self:flex-start; }
  /* A whole tappable tile doesn't need the ">" affordance the list layout uses. */
  .plans.grid .chev { display:none; }
  .codebox { margin:0 0 4px; padding:14px 14px 4px; border-radius:12px;
             background:var(--card); border:2px solid var(--green); }
  .banner { margin:0 0 16px; padding:10px 12px; border-radius:10px; font-size:13.5px;
            text-align:center; background:var(--card); border:1px dashed var(--line);
            color:var(--muted); }
  .banner a { font-weight:600; }
  .pay { margin-top:14px; padding:14px; border:1px solid var(--line); border-radius:10px;
         background:var(--bg); display:none; }
  .pay.on { display:block; }
  .pay h2 { margin:0 0 4px; font-size:16px; }
  .code { margin-top:10px; padding:12px; border-radius:9px; text-align:center;
          background:#e8f3ee; border:1px solid #b9dccd; }
  .code b { display:block; font-size:26px; letter-spacing:.12em; font-family:monospace; }
  .chat-open { width:auto; margin:16px auto 0; display:block; padding:9px 15px; font-size:14.5px;
               background:transparent; color:var(--green); border:1px solid var(--green); }
  .chat { margin-top:14px; padding:14px; border:1px solid var(--line); border-radius:10px;
          background:var(--bg); display:none; }
  .chat.on { display:block; }
  .log { max-height:190px; overflow-y:auto; display:flex; flex-direction:column; gap:7px;
         margin:0 0 10px; }
  .msg { padding:7px 10px; border-radius:9px; font-size:14.5px; max-width:85%; }
  .msg.them { background:#fff; border:1px solid var(--line); align-self:flex-start; }
  .msg.me { background:var(--green); color:var(--btnInk); align-self:flex-end; }
  .hint { margin:10px 0 0; font-size:14px; color:var(--muted); text-align:center; }
  .note { margin:0 0 16px; padding:9px 11px; border-radius:8px; font-size:14px;
          color:#7d5c11; background:#fdf3dc; border:1px solid #ecd9a8; }
  .err:empty { display:none; }
  .err { margin:0 0 14px; padding:9px 11px; border-radius:8px; font-size:14.5px;
         color:#8a2d16; background:#fdece5; border:1px solid #f3c7b6; }
  a { color:var(--green); }
  /* A quiet inline note was easy to miss on a phone screen that had just
     been handed off to M-Pesa and back — a guest who glanced away for the
     PIN prompt came back to text that had already changed, with nothing
     drawing the eye to it. This sits over everything until dismissed or
     timed out, the same weight a "payment successful" moment deserves. */
  .popup-overlay { position:fixed; inset:0; background:rgba(15,20,17,.5);
                    display:flex; align-items:center; justify-content:center;
                    padding:20px; z-index:50; }
  .popup { width:100%; max-width:360px; background:var(--card); border-radius:var(--rad);
           padding:26px 22px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,.25); }
  .popup .icon { width:52px; height:52px; margin:0 auto 12px; border-radius:50%;
                 display:flex; align-items:center; justify-content:center; font-size:26px; }
  .popup.success .icon { background:#e8f3ee; color:var(--green);
                          animation:pop-in .35s cubic-bezier(.2,1.4,.4,1); }
  .popup.notice .icon { background:#fdf3dc; color:#a9790f; }
  /* Waiting on M-Pesa: a spinning ring instead of a static glyph, so "we are
     doing something" reads at a glance rather than needing the words below
     it to be read first — the same reason a spinner beats a bare "Loading". */
  .popup.pending .icon { background:#eef1ed; padding:0; }
  .popup.pending .icon::after {
    content:''; width:26px; height:26px; border-radius:50%;
    border:3px solid var(--line); border-top-color:var(--green);
    animation:spin .8s linear infinite;
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes pop-in { 0% { transform:scale(0); } 70% { transform:scale(1.15); } 100% { transform:scale(1); } }
  .popup h3 { margin:0 0 6px; font-size:18px; }
  .popup p { margin:0; color:var(--muted); font-size:14.5px; }
  .popup button { margin-top:16px; }
</style>
</head>
<body>
  <div class="card">
    <!-- Both come from Hotspot -> Settings, so the operator can change what a
         guest reads without anyone touching this file. Falling back to the
         company name and a plain instruction means an operator who sets neither
         still gets a sensible page. -->
    <h1>${esc(headline || company)}</h1>
    <p class="sub">${esc(subtext || 'Enter your voucher code to get online')}</p>
    ${bannerBlock}
    ${previewNote}
    ${errorBlock}

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
    ${codeBoxOpen}
    <form id="loginForm" action="$(link-login-only)" method="post" onsubmit="document.getElementById('password').value = document.getElementById('username').value;">
      <!--
        Where the guest lands once connected. An operator's configured
        redirect (Hotspot -> Settings -> "Redirect after login") is a fixed
        destination they chose, so it wins when set; our own confirmation
        page is the fallback rather than $(link-orig) — see fallbackDst above
        for why link-orig is not reliable enough to depend on by default.
      -->
      <input type="hidden" name="dst" value="${normalizedRedirect ? esc(normalizedRedirect) : fallbackDst}">
      <label for="username">Voucher code</label>
      <input id="username" name="username" type="text" inputmode="numeric"
             autocomplete="one-time-code" autocapitalize="characters" autocorrect="off"
             spellcheck="false" placeholder="Type the code from your voucher" required>
      <input id="password" name="password" type="hidden">
      <button type="submit">Connect</button>
    </form>
    ${codeBoxClose}

    <p class="plans-title">Buy a bundle</p>
    <ul class="${plansClass}">${planCards}</ul>

    <!-- Buying happens here rather than on another page. A guest on the walled
         garden can reach this router and their own bank's USSD, and not much
         else; sending them elsewhere to pay is where they give up. -->
    <div class="pay" id="pay">
      <h2 id="payTitle">Buy a bundle</h2>
      <p class="hint" style="text-align:left;margin:0 0 8px">
        Enter the M-Pesa number to pay from. The code arrives by SMS.
      </p>
      <input id="payPhone" type="tel" inputmode="tel" placeholder="07xx xxx xxx"
             autocomplete="tel">
      <button type="button" id="payGo">Send M-Pesa request</button>
      <p class="hint" id="payNote"></p>
      <div class="code" id="payCode" style="display:none">
        Your code
        <b id="payCodeValue"></b>
        Type it above to get online.
      </div>
      <!-- Shown only if the in-place auto-submit below did not actually get
           the guest online within a few seconds — see the fallback timer in
           poll(). A fresh page load, not another form.submit() attempt: it
           reuses the exact same auto-login path the SMS's tap-to-connect
           link already relies on ($(...) tokens re-resolved fresh by
           RouterOS on that new request), rather than retrying whatever
           already failed once on this same page load. -->
      <button type="button" id="connectNow" style="display:none">Connect now</button>
    </div>
    <!-- Support, before paying. A guest whose code will not work cannot buy
         their way to an answer, and the operator would rather hear it now than
         from somebody who gave up and left. -->
    <!--
      No longer gated on multiDevice. /hotspot/devices lists MACs seen on
      the network and lets the guest pick the TV off that list rather than
      typing a code onto it with a remote — useful for the very first
      device on any code, not only an extra one on a sharing-enabled code.
      The route itself still caps how many devices a code can carry (1
      without sharing, 3 with it), so this is safe to offer unconditionally;
      only once the guest already has a working code, which the page itself
      asks for, so nothing here needs to know it in advance.
    -->
    <p class="hint"><a href="${esc(apiBase)}/hotspot/devices${routerId ? `?router=${encodeURIComponent(routerId)}` : ''}">Adding a TV or console?</a></p>
    <button type="button" class="chat-open" id="chatOpen">Talk to support</button>
    <div class="chat" id="chat">
      <div class="log" id="chatLog"></div>
      <input id="chatText" type="text" placeholder="Type your message" autocomplete="off">
      <button type="button" id="chatSend">Send</button>
      <p class="hint" id="chatNote"></p>
    </div>
    ${help}
    <!-- The old "Using a TV or set-top box?" link (a bigger-text version of
         this same code-entry form, for reading across a room) is gone —
         "Adding a TV or console?" above replaces it: pick the device, pick a
         bundle, pay, nothing to type on the TV at all, which is strictly
         better than a bigger font on a form the TV still could not fill in
         itself. tvMode/?tv=1 stays reachable directly for anyone who still
         wants it; nothing on this page links to it any more. -->
  </div>

  <div class="popup-overlay" id="popupOverlay" style="display:none">
    <div class="popup" id="popup">
      <div class="icon" id="popupIcon"></div>
      <h3 id="popupTitle"></h3>
      <p id="popupBody"></p>
    </div>
  </div>

  <script>
  /**
   * Rebuilt as independent, self-contained sections rather than one script
   * that runs top to bottom — the exact shape of two bugs already found in
   * this file's own history (the unquoted $(if error) block, the TV/set-top
   * link). Either one worked by making some earlier line throw, which
   * silently skipped every addEventListener after it in the same function:
   * a JS error nobody sees (RouterOS serves this with no console attached),
   * on a page where "the button does nothing" and "a wall of buttons all
   * stopped working at once" look identical from the guest's side. Auto-
   * login, Buy, and Talk to support each run inside their own try/catch now,
   * so a failure in one can never prevent the others' listeners from
   * attaching — the actual guarantee this needs, not just this particular
   * bug fixed again.
   */

  // Absolute, not relative. The router serves this page from its own hotspot
  // DNS name (billing.spot), so a relative URL would post to the router
  // itself — which knows nothing about bundles. This host is in the walled
  // garden, so it is reachable before the guest has paid; that is the whole
  // point of putting it there.
  var API = ${JSON.stringify(apiBase)};
  // Which physical router served this page — set at Configure time (see
  // server.js's ?router= on the pushed login URL) so a sale can be
  // attributed to a site for reporting. Null for a page opened directly in
  // a browser, or one cached from before this existed; /hotspot/buy treats
  // it as optional either way.
  var ROUTER_ID = ${JSON.stringify(routerId)};
  // The router's own hotspot DNS name — see submitHotspotLogin below. Not
  // the tenant's real domain: this only resolves on the guest's own LAN,
  // straight to RouterOS's own login handler, in plain HTTP.
  var HOTSPOT_DNS = ${JSON.stringify(hotspotDns)};

  /**
   * A quiet inline note next to the pay button was easy to miss — a guest
   * who hands their phone to M-Pesa for the PIN prompt and comes back finds
   * text that already changed, nothing drawing the eye to it. This covers
   * the screen instead, for a moment, the way a real "payment successful"
   * confirmation should. kind picks the icon/color: "success" (green check)
   * "notice" (amber, session-ended), or "pending" (a spinner, no glyph —
   * dismissing on tap is disabled for it below, since it is describing work
   * still in flight, not something to wave away). Auto-hides after ms unless
   * ms is 0, in which case it waits for the tap anywhere to dismiss — used
   * for success, where the guest is about to be connected and dismissing
   * early would just hide useful status text. Shared by both sections below,
   * but defined at the top level and defensive on its own: a popup that
   * fails to show is not worth taking either section down over.
   */
  function popup(kind, title, body, ms) {
    try {
      var overlay = document.getElementById('popupOverlay');
      var box = document.getElementById('popup');
      box.className = 'popup ' + kind;
      document.getElementById('popupIcon').textContent = kind === 'success' ? '✓' : kind === 'pending' ? '' : '!';
      document.getElementById('popupTitle').textContent = title;
      document.getElementById('popupBody').textContent = body;
      overlay.style.display = 'flex';
      // A guest tapping away mid-payment to check something reads as "close
      // this, it is done" the same as it does for the other two kinds — for
      // pending specifically that would hide the only sign anything is
      // still happening, so this is the one kind that stays up regardless.
      overlay.onclick = kind === 'pending' ? null : function () { overlay.style.display = 'none'; };
      if (ms) setTimeout(function () { overlay.style.display = 'none'; }, ms);
    } catch (e) { /* a missing popup is not worth breaking whatever called it */ }
  }

  /**
   * $(link-login-only) only ever becomes a real URL when RouterOS itself
   * serves this exact markup — it substitutes the token as it hands the page
   * to a guest. The meta-refresh at the top of this page (routerRedirect)
   * fetches this same markup straight from us instead, specifically to
   * escape a broken WebView, and we are not RouterOS: the token reaches the
   * browser untouched, so form.submit() posts to the literal string
   * "$(link-login-only)", resolved as a relative URL against this page —
   * "buys but does not auto-connect" was this, not the payment.
   *
   * The fallback goes straight to HOTSPOT_DNS — the router's own hotspot DNS
   * name (applyHotspotServer in routeros.js, "\${subdomain}.spot") — a real
   * plain-HTTP server RouterOS runs itself, reachable directly on the
   * guest's own LAN with no interception needed. A third-party host relying
   * on the walled-garden NAT rules to transparently redirect unauthenticated
   * traffic was tried first and abandoned: modern browsers opportunistically
   * retry plain HTTP as HTTPS, and RouterOS's HTTPS interception terminates
   * that with its own self-signed certificate, which throws a security
   * interstitial instead of ever reaching a login handler. Going directly to
   * the router's real HTTP server sidesteps that entirely.
   */
  function submitHotspotLogin(code) {
    try {
      var form = document.getElementById('loginForm');
      if (String(form.getAttribute('action') || '').indexOf('\$(') === 0) {
        // RouterOS's own login handler only ever parses this from a POST
        // body — login-by is http-pap, not http-chap (routeros.js pins it,
        // so no challenge/hash dance is needed), but a GET with the same
        // fields in the query string still isn't a POST, and got no further
        // than window.location.href='http://...&username=...' did on its
        // own. A second, real <form> built and submitted here performs a
        // genuine top-level POST navigation to the router's own server,
        // exactly as if the guest had typed the code into a form whose
        // action already pointed there — no fetch/XHR involved, so no CORS
        // question ever comes up either.
        var dst = document.querySelector('input[name="dst"]').value;
        var f = document.createElement('form');
        f.method = 'post';
        f.action = 'http://' + HOTSPOT_DNS + '/login';
        [['username', code], ['password', code], ['dst', dst]].forEach(function (pair) {
          var input = document.createElement('input');
          input.type = 'hidden';
          input.name = pair[0];
          input.value = pair[1];
          f.appendChild(input);
        });
        document.body.appendChild(f);
        f.submit();
        return;
      }
      document.getElementById('username').value = code;
      document.getElementById('password').value = code;
      form.submit();
    } catch (e) { /* nothing left to try but leave the code visible on screen */ }
  }

  /**
   * Recognise a device that already paid, without depending on the router's
   * own add-mac-cookie table — that one lives in RAM and is exactly what a
   * power outage wipes, which is the whole reason a customer who is still
   * well within their paid time lands back on this page instead of being
   * waved straight through. Skipped after a just-failed attempt
   * ($(if error)), so a wrong code cannot loop into auto-resubmitting
   * itself forever.
   */
  try {
    var mac = ${JSON.stringify(macToken)};
    var hadError = ${JSON.stringify(hadErrorToken)} === 'yes';
    // The SMS a guest gets on payment carries the code as text and as a tap
    // link to this page with ?code=... attached — for someone who would
    // rather tap than type it back in on a small keyboard. Takes priority
    // over the MAC lookup below: it names an exact voucher, nothing to look
    // up first.
    var prefillCode = ${JSON.stringify(prefillCode ?? '')};
    if (prefillCode && !hadError) {
      submitHotspotLogin(prefillCode);
    } else if (mac && mac.indexOf('\$') !== 0 && !hadError) {
      fetch(API + '/hotspot/voucher-for-mac?mac=' + encodeURIComponent(mac))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.code) return;
          submitHotspotLogin(d.code);
        })
        .catch(function () { /* stay on the manual form — nothing to recover from here */ });
    }
  } catch (e) { /* falls back to the plain sign-in form, already on screen */ }

  // ── buy a bundle ───────────────────────────────────────────────────
  try {
    var pay = document.getElementById('pay');
    var payTitle = document.getElementById('payTitle');
    var payPhone = document.getElementById('payPhone');
    var payGo = document.getElementById('payGo');
    var payNote = document.getElementById('payNote');
    var payCode = document.getElementById('payCode');
    var payCodeValue = document.getElementById('payCodeValue');
    var pickedPlanId = null;
    var payPollTimer = null;

    document.querySelectorAll('.buy').forEach(function (b) {
      b.addEventListener('click', function () {
        pickedPlanId = b.getAttribute('data-plan');
        // The preview's bundles are illustrations and carry no id. Saying so
        // beats a button that swallows the click and looks broken.
        if (!pickedPlanId) {
          pay.classList.add('on');
          payTitle.textContent = b.getAttribute('data-title');
          payNote.textContent = 'This is an example bundle. On your own subdomain this sends the M-Pesa prompt.';
          payPhone.style.display = 'none';
          payGo.style.display = 'none';
          return;
        }
        payPhone.style.display = '';
        payGo.style.display = '';
        payTitle.textContent = 'Buy ' + b.getAttribute('data-title');
        pay.classList.add('on');
        payNote.textContent = '';
        payCode.style.display = 'none';
        payPhone.focus();
      });
    });

    /**
     * Nothing watched a voucher after it was shown as paid — a guest who kept
     * this tab open just quietly lost internet with no explanation once time
     * ran out, and had to work out on their own that reloading would get them
     * back to a sign-in form. This polls the same status this page's own
     * server-side sweep updates on every read, and the instant it sees
     * anything other than in_use, shows a plain "your time has ended" notice
     * and then sends them to a fresh copy of the sign-in page — RouterOS
     * itself has already stopped treating them as authenticated by then, so
     * that fresh load is what actually puts the sign-in form back in front
     * of them, same as a reload would, just with an explicit reason shown
     * first instead of the page just silently changing under them.
     */
    function watchVoucher(code) {
      var watchTimer = setInterval(function () {
        fetch(API + '/hotspot/voucher-status?code=' + encodeURIComponent(code))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.status && d.status !== 'in_use') {
              clearInterval(watchTimer);
              popup('notice', 'Your time has ended', 'Taking you back to sign in…', 0);
              setTimeout(function () { window.location.href = API + '/hotspot/login.html'; }, 1800);
            }
          })
          .catch(function () { /* keep watching; a dropped check is not expiry */ });
      }, 30000);
    }

    function pollPayment(checkoutId) {
      fetch(API + '/hotspot/buy/' + encodeURIComponent(checkoutId))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.code) {
            clearInterval(payPollTimer);
            payNote.textContent = 'Paid. Connecting…';
            payCodeValue.textContent = d.code;
            payCode.style.display = 'block';
            document.getElementById('username').value = d.code;
            watchVoucher(d.code);
            // 0 = stays up until tapped, not timed out — this is the moment
            // that matters most on the whole page, and the guest is about
            // to be sent through the auto-connect below regardless.
            popup('success', 'Payment successful', 'Your code is ' + d.code + '. Connecting you now…', 0);
            // form.submit() does not fire the 'submit' event, so the form's
            // own onsubmit — which copies the code into the hidden password
            // field — never runs: submitting with the password still empty
            // sends the router a login RouterOS silently rejects the same
            // way a wrong password would. Doing that copy here, the same as
            // onsubmit does, before calling submit() avoids depending on an
            // event .submit() never dispatches.
            setTimeout(function () { submitHotspotLogin(d.code); }, 1200);
            /**
             * A successful hotspot login navigates the guest away from this
             * page entirely — RouterOS redirects to dst the instant it
             * accepts the credentials. So if this script is still running
             * several seconds later, the submit above did not actually get
             * them online, whatever the reason (a $(...) token RouterOS
             * resolved differently for this request than for the original
             * page load, a slow router, anything). Rather than leave a paid
             * guest staring at a page that looks stuck, a fresh load of this
             * same page with the code attached goes through the exact path
             * the SMS's own tap-to-connect link already uses successfully —
             * new request, tokens resolved fresh, same auto-login above.
             */
            setTimeout(function () {
              var btn = document.getElementById('connectNow');
              btn.style.display = 'block';
              btn.addEventListener('click', function () {
                window.location.href = API + '/hotspot/login.html?code=' + encodeURIComponent(d.code);
              });
            }, 2500);
            return;
          }
          if (d.status === 'failed' || d.status === 'cancelled' || d.status === 'timeout') {
            clearInterval(payPollTimer);
            payGo.disabled = false;
            var failMsg = d.detail || 'The payment did not go through.';
            payNote.textContent = failMsg;
            // The pending spinner was the only thing on screen while this was
            // in flight — leaving it up after a failure reads as still
            // waiting on a payment that has already died.
            document.getElementById('popupOverlay').style.display = 'none';
            popup('notice', 'Payment did not go through', failMsg, 4000);
          }
        })
        .catch(function () { /* keep polling; a dropped request is not a failure */ });
    }

    payGo.addEventListener('click', function () {
      if (!pickedPlanId) return;
      payGo.disabled = true;
      payNote.textContent = 'Sending…';
      popup('pending', 'Sending request…', 'Asking Safaricom to prompt your phone.', 0);
      fetch(API + '/hotspot/buy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: pickedPlanId, phone: payPhone.value, routerId: ROUTER_ID }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          payGo.disabled = false;
          if (!res.ok) {
            var msg = res.d.error || 'Could not start the payment.';
            payNote.textContent = msg;
            document.getElementById('popupOverlay').style.display = 'none';
            popup('notice', 'Could not start payment', msg, 4000);
            return;
          }
          payNote.textContent = 'Check your phone and enter your M-Pesa PIN.';
          popup('pending', 'Check your phone', 'Enter your M-Pesa PIN to finish paying.', 0);
          clearInterval(payPollTimer);
          payPollTimer = setInterval(function () { pollPayment(res.d.checkoutId); }, 3000);
        })
        .catch(function () {
          payGo.disabled = false;
          payNote.textContent = 'Could not reach the billing system from here.';
        });
    });
  } catch (e) { /* Buy stays unresponsive; Talk to support below is unaffected */ }

  // ── talk to support ────────────────────────────────────────────────
  try {
    var chatPanel = document.getElementById('chat');
    var chatLog = document.getElementById('chatLog');
    var chatText = document.getElementById('chatText');
    var chatNote = document.getElementById('chatNote');
    var chatId = null, chatToken = null, chatLastId = 0, chatPollTimer = null;

    function appendMessage(sender, body) {
      var el = document.createElement('div');
      el.className = 'msg ' + (sender === 'staff' ? 'them' : 'me');
      el.textContent = body;
      chatLog.appendChild(el);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function pollChat() {
      if (!chatId) return;
      fetch(API + '/chat/' + chatId + '?token=' + encodeURIComponent(chatToken) + '&since=' + chatLastId)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          (d.messages || []).forEach(function (m) {
            chatLastId = m.id;
            // Only the other side: our own were shown the moment they were sent.
            if (m.sender === 'staff') appendMessage('staff', m.body);
          });
          if (d.status === 'closed') {
            clearInterval(chatPollTimer);
            chatNote.textContent = 'Support closed this conversation.';
          }
        })
        .catch(function () { /* a dropped poll is not the end of the chat */ });
    }

    document.getElementById('chatOpen').addEventListener('click', function () {
      chatPanel.classList.toggle('on');
      if (!chatPanel.classList.contains('on') || chatId) return;
      chatNote.textContent = 'Connecting…';
      fetch(API + '/chat/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Hotspot guest' }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.chatId) { chatNote.textContent = d.error || 'Support is not available.'; return; }
          chatId = d.chatId; chatToken = d.token;
          chatNote.textContent = 'Someone will reply here.';
          chatPollTimer = setInterval(pollChat, 3000);
        })
        .catch(function () { chatNote.textContent = 'Could not reach support from here.'; });
    });

    function sendChat() {
      var body = chatText.value.trim();
      if (!body || !chatId) return;
      chatText.value = '';
      appendMessage('visitor', body);
      fetch(API + '/chat/' + chatId + '/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: chatToken, body: body }),
      }).catch(function () { chatNote.textContent = 'That message did not send.'; });
    }
    document.getElementById('chatSend').addEventListener('click', sendChat);
    chatText.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });
  } catch (e) { /* Talk to support stays unresponsive; Buy above is unaffected */ }
  </script>
</body>
</html>`;
}

/**
 * "Adding a TV or console?" — reached from an already-connected phone, for a
 * TV or console that has some browser but no way to type a 6-digit code onto
 * a screen with a remote.
 *
 * Pick the device, pick a bundle, pay — nothing is typed onto the TV at any
 * point, because the device is bound on its router the instant the payment
 * applies (see apply.js's bindDeviceOnRouter), the same ip-binding/queue
 * mechanism the old "already bought a code" flow used, just reached without
 * ever needing a code to exist first. See /hotspot/tv-options and
 * /hotspot/tv-buy in server.js.
 *
 * A second, collapsed section still covers the older case — a code already
 * bought, on a multi-device plan, adding one more device to it — since that
 * is a different transaction (no new payment) and /hotspot/nearby-devices
 * still exists for exactly that.
 *
 * Served directly to the guest's own already-online browser, not fetched
 * and cached by the router the way the login page is, so none of RouterOS's
 * $(...) substitution applies here.
 */
export function devicesPage({ company = 'WiFi', apiBase = '', routerId = null }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Add a device — ${esc(company)}</title>
${apiBase ? `<link rel="icon" href="${esc(apiBase)}/api/public/favicon">` : ''}
<style>
  :root { --ink:#161a17; --muted:#8a9186; --line:rgba(128,128,128,.25); --green:#0f7a5f; --bg:#f5f6f3; --card:#fff; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink); padding:20px;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:440px; margin:0 auto 14px; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:22px; }
  h1 { margin:0 0 4px; font-size:20px; }
  h2 { margin:0 0 4px; font-size:15px; }
  .sub { margin:0 0 16px; color:var(--muted); font-size:14px; }
  input { width:100%; padding:11px 12px; font-size:17px; border:1px solid var(--line);
          border-radius:9px; background:#fafbf9; color:#161a17; }
  button { width:100%; margin-top:12px; padding:13px; font-size:16px; font-weight:600;
           color:#fff; background:var(--green); border:0; border-radius:9px; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  .device, .plan { display:flex; justify-content:space-between; align-items:center; gap:12px;
            padding:12px 10px; border:1px solid var(--line); border-radius:10px; margin-top:8px; cursor:pointer; }
  .device.on, .plan.on { border-color:var(--green); background:#eef7f1; }
  .device-name, .plan-name { font-weight:600; font-size:14.5px; }
  .device-meta, .plan-meta { color:var(--muted); font-size:13px; }
  .plan-price { font-weight:700; color:var(--green); font-size:14.5px; white-space:nowrap; }
  .label { margin:16px 0 0; font-size:13px; font-weight:600; color:var(--muted); }
  .hint { margin:10px 0 0; font-size:13.5px; color:var(--muted); text-align:center; }
  .err { margin:10px 0 0; padding:9px 11px; border-radius:8px; font-size:14px;
         color:#8a2d16; background:#fdece5; border:1px solid #f3c7b6; }
  .toggle { text-align:center; font-size:13px; color:var(--muted); }
  .toggle a { color:var(--green); font-weight:600; text-decoration:none; }
  .add { width:auto; margin-top:0; padding:8px 14px; font-size:13.5px; }
  /* Same popup as the sign-in page — see its stylesheet for why this
     replaces a quiet inline note for a moment that matters this much. */
  .popup-overlay { position:fixed; inset:0; background:rgba(15,20,17,.5);
                    display:flex; align-items:center; justify-content:center;
                    padding:20px; z-index:50; }
  .popup { width:100%; max-width:360px; background:var(--card); border-radius:14px;
           padding:26px 22px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,.25); }
  .popup .icon { width:52px; height:52px; margin:0 auto 12px; border-radius:50%;
                 display:flex; align-items:center; justify-content:center; font-size:26px; }
  .popup.success .icon { background:#e8f3ee; color:var(--green); }
  .popup h3 { margin:0 0 6px; font-size:18px; }
  .popup p { margin:0; color:var(--muted); font-size:14.5px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Add a device</h1>
    <p class="sub">Pick your TV or console, choose a bundle, and pay — nothing to type on it.</p>
    <div id="loading" class="hint">Looking for devices on this network…</div>
    <div id="err0"></div>
    <div id="buyForm" style="display:none">
      <p class="label" id="deviceLabel">Which device is it?</p>
      <div id="devices"></div>
      <p class="label" id="planLabel">Choose a bundle</p>
      <div id="plans"></div>
      <p class="label">Name this device <span style="font-weight:400">(optional)</span></p>
      <input id="deviceName" type="text" placeholder="e.g. Living room TV" maxlength="60" autocomplete="off">
      <p class="label">Your phone number (M-Pesa)</p>
      <input id="phone" type="tel" inputmode="tel" placeholder="07xx xxx xxx" autocomplete="tel">
      <button id="pay">Pay with M-Pesa</button>
      <p class="hint" id="payNote"></p>
    </div>
  </div>

  <div class="card toggle" id="oldFlow">
    <a href="#" id="haveCode">Already have a code and just adding an extra device?</a>
  </div>

  <div class="card" id="step1" style="display:none">
    <h2>Add an extra device to a code</h2>
    <p class="sub">For a bundle that already allows more than one device.</p>
    <input id="code" inputmode="numeric" placeholder="Your voucher code" autocomplete="off">
    <button id="find">Find devices</button>
    <div id="err1"></div>
    <div id="list" style="display:none"></div>
  </div>

  <div class="popup-overlay" id="popupOverlay" style="display:none">
    <div class="popup success" id="popup">
      <div class="icon">✓</div>
      <h3 id="popupTitle"></h3>
      <p id="popupBody"></p>
    </div>
  </div>

  <script>
  (function () {
    var API = ${JSON.stringify(apiBase)};
    // Carried straight through to /hotspot/tv-options and /hotspot/tv-buy —
    // see that route's own comment for why this is what keeps a guest at one
    // site from ever seeing another site's devices.
    var ROUTER_ID = ${JSON.stringify(routerId)};
    var devices = [], plans = [];
    var pickedDevice = null, pickedPlan = null;

    // Device vendor/hostname come off the router's own ARP/lease table, and
    // a hostname is whatever the device itself announced when it joined —
    // guest-controlled, not tenant-controlled, unlike a plan title. Escaped
    // before going into innerHTML so a device cannot inject markup by
    // setting its own hostname to something like "<img onerror=...>".
    // Same popup as the sign-in page — see its script for why this replaces
    // a quiet inline note for the one moment on this page that matters most.
    function popup(title, body) {
      document.getElementById('popupTitle').textContent = title;
      document.getElementById('popupBody').textContent = body;
      var overlay = document.getElementById('popupOverlay');
      overlay.style.display = 'flex';
      overlay.onclick = function () { overlay.style.display = 'none'; };
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    fetch(API + '/hotspot/tv-options' + (ROUTER_ID ? '?router=' + encodeURIComponent(ROUTER_ID) : ''))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        document.getElementById('loading').style.display = 'none';
        if (!res.ok) { document.getElementById('err0').innerHTML = '<p class="err">' + (res.d.error || 'Could not reach the billing system.') + '</p>'; return; }
        devices = res.d.devices || [];
        plans = res.d.plans || [];
        if (!devices.length) {
          document.getElementById('err0').innerHTML = '<p class="hint">No devices seen on this network yet — make sure the TV is connected to the WiFi first, then reload this page.</p>';
          return;
        }
        if (!plans.length) {
          document.getElementById('err0').innerHTML = '<p class="hint">No bundles are on sale right now.</p>';
          return;
        }
        renderDevices();
        renderPlans();
        document.getElementById('buyForm').style.display = 'block';
      })
      .catch(function () {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('err0').innerHTML = '<p class="err">Could not reach the billing system from here.</p>';
      });

    function renderDevices() {
      var el = document.getElementById('devices');
      el.innerHTML = devices.map(function (d, i) {
        // A name typed in on a past purchase wins over the router's own
        // guess — the router has no memory of it at all, only the name a
        // customer actually chose says "this is my TV" rather than
        // "TCL" or a bare MAC.
        var name = esc(d.knownLabel || d.vendor || d.hostname || 'Unknown device');
        var meta = esc([d.hostname && d.vendor ? d.hostname : null, d.address].filter(Boolean).join(' · '));
        return '<div class="device" data-i="' + i + '"><div><div class="device-name">' + name + '</div>' +
          '<div class="device-meta">' + (meta || esc(d.mac)) + '</div></div></div>';
      }).join('');
      el.querySelectorAll('.device').forEach(function (row) {
        row.addEventListener('click', function () {
          el.querySelectorAll('.device').forEach(function (r) { r.classList.remove('on'); });
          row.classList.add('on');
          pickedDevice = devices[Number(row.getAttribute('data-i'))];
          // Pre-filled, not locked — a returning device shows the name it
          // already has so the guest is not asked to retype it every time,
          // but the field stays editable for anyone who wants to rename it.
          document.getElementById('deviceName').value = pickedDevice.knownLabel || '';
        });
      });
      if (devices.length === 1) el.querySelector('.device').click();
    }

    function renderPlans() {
      var el = document.getElementById('plans');
      el.innerHTML = plans.map(function (p, i) {
        return '<div class="plan" data-i="' + i + '"><div><div class="plan-name">' + esc(p.title) + '</div>' +
          '<div class="plan-meta">' + duration(p.duration_min) + ' · ' + (p.rate_down / 1000) + ' Mbps</div></div>' +
          '<div class="plan-price">KES ' + Number(p.price) + '</div></div>';
      }).join('');
      el.querySelectorAll('.plan').forEach(function (row) {
        row.addEventListener('click', function () {
          el.querySelectorAll('.plan').forEach(function (r) { r.classList.remove('on'); });
          row.classList.add('on');
          pickedPlan = plans[Number(row.getAttribute('data-i'))];
        });
      });
      el.querySelector('.plan').click();
    }

    function duration(min) {
      var m = Number(min) || 0;
      if (m >= 1440) return Math.round(m / 1440) + ' day' + (m >= 2880 ? 's' : '');
      if (m >= 60) return Math.round(m / 60) + ' hour' + (m >= 120 ? 's' : '');
      return m + ' minutes';
    }

    document.getElementById('pay').addEventListener('click', function () {
      var note = document.getElementById('payNote');
      var phone = document.getElementById('phone').value.trim();
      if (!pickedDevice) { note.textContent = 'Pick which device this is for.'; return; }
      if (!pickedPlan) { note.textContent = 'Pick a bundle.'; return; }
      if (!phone) { note.textContent = 'Enter the M-Pesa number to pay from.'; return; }
      var btn = document.getElementById('pay');
      btn.disabled = true;
      note.textContent = 'Sending…';
      fetch(API + '/hotspot/tv-buy', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mac: pickedDevice.mac, routerId: pickedDevice.routerId, planId: pickedPlan.id,
          phone: phone, label: document.getElementById('deviceName').value.trim(),
        }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { btn.disabled = false; note.textContent = res.d.error || 'Could not start the payment.'; return; }
          note.textContent = 'Check your phone and enter your M-Pesa PIN.';
          poll(res.d.checkoutId);
        })
        .catch(function () { btn.disabled = false; note.textContent = 'Could not reach the billing system from here.'; });
    });

    function poll(checkoutId) {
      var note = document.getElementById('payNote');
      var timer = setInterval(function () {
        fetch(API + '/hotspot/buy/' + encodeURIComponent(checkoutId))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.code) {
              clearInterval(timer);
              note.textContent = 'Paid — connecting that device now.';
              popup('Payment successful', 'Connecting that device now — it may take a few seconds to come online.');
              return;
            }
            if (d.status === 'failed' || d.status === 'cancelled' || d.status === 'timeout') {
              clearInterval(timer);
              document.getElementById('pay').disabled = false;
              note.textContent = d.detail || 'The payment did not go through.';
            }
          })
          .catch(function () { /* keep polling; a dropped request is not a failure */ });
      }, 3000);
    }

    // ── the older, code-first flow: adding an extra device to a code that
    // already allows more than one ──────────────────────────────────────
    var code = '';
    document.getElementById('haveCode').addEventListener('click', function (e) {
      e.preventDefault();
      document.getElementById('oldFlow').style.display = 'none';
      document.getElementById('step1').style.display = 'block';
    });

    document.getElementById('find').addEventListener('click', function () {
      code = document.getElementById('code').value.trim();
      if (!code) return;
      var err = document.getElementById('err1');
      err.innerHTML = '';
      fetch(API + '/hotspot/nearby-devices?code=' + encodeURIComponent(code))
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { err.innerHTML = '<p class="err">' + (res.d.error || 'Could not check that code.') + '</p>'; return; }
          renderOldList(res.d.devices, res.d.slotsLeft);
        })
        .catch(function () { err.innerHTML = '<p class="err">Could not reach the billing system from here.</p>'; });
    });

    function renderOldList(oldDevices, slotsLeft) {
      var list = document.getElementById('list');
      list.style.display = 'block';
      if (!slotsLeft) {
        list.innerHTML = '<p class="hint">This code already has as many devices as it can take.</p>';
        return;
      }
      if (!oldDevices.length) {
        list.innerHTML = '<p class="hint">No other devices seen on this network yet — make sure the TV is connected to the WiFi first.</p>';
        return;
      }
      list.innerHTML = oldDevices.map(function (d, i) {
        var name = esc(d.vendor || d.hostname || 'Unknown device');
        var meta = esc([d.hostname && d.vendor ? d.hostname : null, d.address].filter(Boolean).join(' · '));
        return '<div class="device"><div><div class="device-name">' + name + '</div>' +
          '<div class="device-meta">' + (meta || esc(d.mac)) + '</div></div>' +
          '<button class="add" data-i="' + i + '">Add</button></div>';
      }).join('') + '<p class="hint" id="bindNote"></p>';
      list.querySelectorAll('.add').forEach(function (btn) {
        btn.addEventListener('click', function () { bind(oldDevices[Number(btn.getAttribute('data-i'))].mac, btn); });
      });
    }

    function bind(mac, btn) {
      var name = window.prompt('Name this device (optional) — e.g. "Living room TV"', '') || '';
      btn.disabled = true;
      btn.textContent = 'Adding…';
      var note = document.getElementById('bindNote');
      fetch(API + '/hotspot/nearby-devices/bind', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code, mac: mac, label: name.trim() }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { note.textContent = res.d.error || 'Could not add that device.'; btn.disabled = false; btn.textContent = 'Add'; return; }
          btn.textContent = 'Added';
          note.textContent = "Done — that device is online now, no code or browser needed on it.";
        })
        .catch(function () { note.textContent = 'Could not reach the billing system from here.'; btn.disabled = false; btn.textContent = 'Add'; });
    }
  }());
  </script>
</body>
</html>`;
}
