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
 * Look, chosen in Hotspot -> Settings.
 *
 * Only colour and weight change — the layout is the same everywhere because it
 * has to work on a cracked phone screen in daylight, and that constrains it far
 * more than taste does.
 */
const TEMPLATES = {
  sleek:  { bg: '#f5f6f3', card: '#ffffff', ink: '#161a17', accent: '#0f7a5f', radius: '14px' },
  dark:   { bg: '#12171a', card: '#1b2227', ink: '#eef2f0', accent: '#2fbf8f', radius: '14px' },
  bold:   { bg: '#0f7a5f', card: '#ffffff', ink: '#161a17', accent: '#0b5c47', radius: '18px' },
  plain:  { bg: '#ffffff', card: '#ffffff', ink: '#111111', accent: '#1b6fd6', radius: '6px' },
};

export function loginPage({
  company = 'WiFi', plans = [], supportPhone = null, portalUrl = null, preview = false,
  headline = null, subtext = null, forRouter = false, template = 'sleek', tvMode = false,
}) {
  const t = TEMPLATES[template] ?? TEMPLATES.sleek;
  // Where the page should send its purchase requests. Empty on the preview,
  // where the page is already being served by the billing system itself.
  const apiBase = portalUrl ?? '';

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
  // Each bundle carries its own button. A single "buy" link elsewhere on the
  // page made the guest choose twice — once here and again on another screen —
  // and the price they had just read was no longer in front of them.
  const planCards = plans.length
    ? plans.map((p) => `
      <li class="plan">
        <div class="plan-name">
          <strong>${esc(p.title)}</strong>
          <span class="meta">${esc(duration(p.duration_min))} · ${esc(String(p.rate_down / 1000))} Mbps</span>
        </div>
        <button type="button" class="buy" data-plan="${esc(p.id ?? '')}"
                data-title="${esc(p.title)}">${esc(money(p.price))}</button>
      </li>`).join('')
    : '<li class="plan"><span class="meta">No bundles are on sale right now.</span></li>';

  // No separate buy block: every bundle above is its own button now.

  // No banner on the preview. The page is shown to operators to judge how it
  // looks, and a notice explaining itself is the first thing they asked to have
  // removed. The invented bundles are inert there anyway: they carry no id, so
  // the buttons say so rather than starting a payment that cannot complete.
  const previewNote = '';

  const help = supportPhone
    ? `<p class="hint">Need help? Call <a href="tel:${esc(supportPhone)}">${esc(supportPhone)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<!-- ${MARKER} -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(company)} WiFi</title>
<style>
  :root { --ink:${t.ink}; --muted:#8a9186; --line:rgba(128,128,128,.25);
          --green:${t.accent}; --greenDark:${t.accent}; --bg:${t.bg};
          --card:${t.card}; --rad:${t.radius}; }
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
  input { width:100%; padding:11px 12px; font-size:17px; border:1px solid var(--line);
          border-radius:9px; background:#fafbf9; color:var(--ink); }
  /* 16px+ on inputs is deliberate: anything smaller makes iOS Safari zoom in on
     focus, which shoves the form off screen on the phones most guests use. */
  button { width:100%; margin-top:18px; padding:13px; font-size:16px; font-weight:600;
           color:#fff; background:var(--green); border:0; border-radius:9px; cursor:pointer; }
  .plans { list-style:none; margin:20px 0 0; padding:16px 0 0; border-top:1px solid var(--line); }
  .plans-title { font-size:14px; color:var(--muted); margin:0 0 10px; }
  .plan { display:flex; justify-content:space-between; align-items:center; gap:14px;
          padding:10px 0; border-bottom:1px solid var(--line); }
  .plan:last-child { border-bottom:0; }
  .plan-name { min-width:0; }
  .plan-name strong { display:block; font-size:16px; }
  .meta { display:block; color:var(--muted); font-size:14px; white-space:nowrap; }
  .price { font-weight:600; white-space:nowrap; }
  /* width:auto and margin-top:0 undo the global button rule above, which exists
     for Connect. Without them every price button stretched to the full width of
     the card and squeezed the bundle name into a two-line column. */
  .buy { width:auto; margin-top:0; padding:9px 15px; font-size:15px; font-weight:600;
         white-space:nowrap; color:#fff; background:var(--green); border:0;
         border-radius:8px; cursor:pointer; min-width:96px; }
  .buy:hover { background:var(--greenDark); }
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
  .msg.me { background:var(--green); color:#fff; align-self:flex-end; }
  .hint { margin:10px 0 0; font-size:14px; color:var(--muted); text-align:center; }
  .note { margin:0 0 16px; padding:9px 11px; border-radius:8px; font-size:14px;
          color:#7d5c11; background:#fdf3dc; border:1px solid #ecd9a8; }
  .err:empty { display:none; }
  .err { margin:0 0 14px; padding:9px 11px; border-radius:8px; font-size:14.5px;
         color:#8a2d16; background:#fdece5; border:1px solid #f3c7b6; }
  a { color:var(--green); }
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
    <form action="$(link-login-only)" method="post" onsubmit="document.getElementById('password').value = document.getElementById('username').value;">
      <input type="hidden" name="dst" value="$(link-orig)">
      <label for="username">Voucher code</label>
      <input id="username" name="username" type="text" inputmode="numeric"
             autocomplete="one-time-code" autocapitalize="characters" autocorrect="off"
             spellcheck="false" placeholder="Type the code from your voucher" required>
      <input id="password" name="password" type="hidden">
      <button type="submit">Connect</button>
    </form>

    <p class="plans-title">Buy a bundle</p>
    <ul class="plans">${planCards}</ul>

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
    </div>
    <!-- Support, before paying. A guest whose code will not work cannot buy
         their way to an answer, and the operator would rather hear it now than
         from somebody who gave up and left. -->
    <button type="button" class="chat-open" id="chatOpen">Talk to support</button>
    <div class="chat" id="chat">
      <div class="log" id="chatLog"></div>
      <input id="chatText" type="text" placeholder="Type your message" autocomplete="off">
      <button type="button" id="chatSend">Send</button>
      <p class="hint" id="chatNote"></p>
    </div>
    ${help}
    ${tvMode ? '' : `
    <!-- Smart TVs and set-top boxes: same page, sized to be read from a sofa
         and typed with a remote. A link rather than sniffing the user agent,
         which gets it wrong on exactly the devices that matter. -->
    <p class="hint"><a href="?tv=1">Using a TV or set-top box?</a></p>`}
  </div>

  <script>
  (function () {
    var pay = document.getElementById('pay');
    var title = document.getElementById('payTitle');
    var phone = document.getElementById('payPhone');
    var go = document.getElementById('payGo');
    var note = document.getElementById('payNote');
    var codeBox = document.getElementById('payCode');
    var codeVal = document.getElementById('payCodeValue');
    var planId = null;
    var timer = null;

    // Absolute, not relative. The router serves this page from wifi.local, so a
    // relative URL would post to the router itself — which knows nothing about
    // bundles. This host is in the walled garden, so it is reachable before the
    // guest has paid; that is the whole point of putting it there.
    var API = ${JSON.stringify(apiBase)};

    document.querySelectorAll('.buy').forEach(function (b) {
      b.addEventListener('click', function () {
        planId = b.getAttribute('data-plan');
        // The preview's bundles are illustrations and carry no id. Saying so
        // beats a button that swallows the click and looks broken.
        if (!planId) {
          pay.classList.add('on');
          title.textContent = b.getAttribute('data-title');
          note.textContent = 'This is an example bundle. On your own subdomain this '
            + 'sends the M-Pesa prompt.';
          phone.style.display = 'none';
          go.style.display = 'none';
          return;
        }
        phone.style.display = '';
        go.style.display = '';
        title.textContent = 'Buy ' + b.getAttribute('data-title');
        pay.classList.add('on');
        note.textContent = '';
        codeBox.style.display = 'none';
        phone.focus();
      });
    });

    function poll(id) {
      fetch(API + '/hotspot/buy/' + encodeURIComponent(id))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.code) {
            clearInterval(timer);
            note.textContent = 'Paid.';
            codeVal.textContent = d.code;
            codeBox.style.display = 'block';
            document.getElementById('username').value = d.code;
            return;
          }
          if (d.status === 'failed' || d.status === 'cancelled') {
            clearInterval(timer);
            note.textContent = d.detail || 'The payment did not go through.';
          }
        })
        .catch(function () { /* keep polling; a dropped request is not a failure */ });
    }

    // ── live chat ──────────────────────────────────────────────────────
    var chat = document.getElementById('chat');
    var chatLog = document.getElementById('chatLog');
    var chatText = document.getElementById('chatText');
    var chatNote = document.getElementById('chatNote');
    var chatId = null, chatToken = null, lastId = 0, chatTimer = null;

    function append(sender, body) {
      var el = document.createElement('div');
      el.className = 'msg ' + (sender === 'staff' ? 'them' : 'me');
      el.textContent = body;
      chatLog.appendChild(el);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function pollChat() {
      if (!chatId) return;
      fetch(API + '/chat/' + chatId + '?token=' + encodeURIComponent(chatToken) + '&since=' + lastId)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          (d.messages || []).forEach(function (m) {
            lastId = m.id;
            // Only the other side: our own were shown the moment they were sent.
            if (m.sender === 'staff') append('staff', m.body);
          });
          if (d.status === 'closed') {
            clearInterval(chatTimer);
            chatNote.textContent = 'Support closed this conversation.';
          }
        })
        .catch(function () { /* a dropped poll is not the end of the chat */ });
    }

    document.getElementById('chatOpen').addEventListener('click', function () {
      chat.classList.toggle('on');
      if (!chat.classList.contains('on') || chatId) return;
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
          chatTimer = setInterval(pollChat, 3000);
        })
        .catch(function () { chatNote.textContent = 'Could not reach support from here.'; });
    });

    function sendChat() {
      var body = chatText.value.trim();
      if (!body || !chatId) return;
      chatText.value = '';
      append('visitor', body);
      fetch(API + '/chat/' + chatId + '/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: chatToken, body: body }),
      }).catch(function () { chatNote.textContent = 'That message did not send.'; });
    }
    document.getElementById('chatSend').addEventListener('click', sendChat);
    chatText.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });

    go.addEventListener('click', function () {
      if (!planId) return;
      go.disabled = true;
      note.textContent = 'Sending…';
      fetch(API + '/hotspot/buy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: planId, phone: phone.value }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          go.disabled = false;
          if (!res.ok) { note.textContent = res.d.error || 'Could not start the payment.'; return; }
          note.textContent = 'Check your phone and enter your M-Pesa PIN.';
          clearInterval(timer);
          timer = setInterval(function () { poll(res.d.checkoutId); }, 3000);
        })
        .catch(function () {
          go.disabled = false;
          note.textContent = 'Could not reach the billing system from here.';
        });
    });
  }());
  </script>
</body>
</html>`;
}
