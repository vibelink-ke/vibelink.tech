# Vibelink Security Assessment

**Scope:** `backend/src/**`, `frontend/**`, `infra/caddy/Caddyfile`, `docker-compose.prod.yml`
**Method:** manual source review (read-only, no code modified), `npm audit` against installed lockfiles, and external CVE/advisory lookups for notable dependencies.
**Author's ground rules honored:** every finding below is either (a) tied to an exact `file:line` you can re-open and check, or (b) sourced to a public advisory linked in-line. Nothing is asserted from memory of "this package usually has issues."

---

## Executive summary

The codebase is unusually disciplined for its size — tenant scoping is applied consistently (`req.tenant.id` on essentially every query), Postgres RLS is used as defense-in-depth (`withTenant` in `db.js`), passwords are hashed with scrypt + constant-time compare, router credentials are encrypted at rest with AES-256-GCM, and the internal-only endpoints (`/radius/*`, `/internal/*`) are correctly excluded from the public Caddy reverse-proxy config, not just gated in Express.

That said, one issue is genuinely critical: **the Daraja (M-Pesa) payment-confirmation and STK-callback webhooks have no signature verification, no shared secret, and no IP allow-list.** Anyone on the internet who can reach `https://<tenant>.vibelink.tech/webhooks/daraja/confirm` can forge a payment-confirmation POST and credit a subscriber's account, or reach `/webhooks/daraja/stk` and forge a "payment succeeded" callback to issue a free hotspot voucher — without ever sending Safaricom a shilling. This is the standout finding and should be fixed before anything else.

Beyond that, the notable gaps are: no rate limiting anywhere in the stack (admin login, portal login, hotspot STK purchase, M-Pesa code verification are all bruteforceable/hammerable), the KopoKopo webhook signature check silently no-ops if `KOPOKOPO_WEBHOOK_SECRET` is unset ("fail open"), and a handful of outdated frontend dev-tooling dependencies with public advisories (`vite`, `esbuild`, `react-router`). No SQL injection, no cross-tenant IDOR, no RouterOS command-injection, and no SSRF via the `/tool/fetch` hotspot-page push were found — those areas were specifically checked given the brief's concerns and held up.

The system does **not** use JWTs despite the brief's assumption — it uses opaque, random, database-backed session tokens (`admin_sessions`, `portal_sessions`) with `HttpOnly`/`SameSite=Lax` cookies. That is a stronger design than JWT for this use case (instant revocation, no algorithm-confusion surface), so it is noted as a correction, not a finding.

---

## Findings table

| # | Severity | Title | Location |
|---|----------|-------|----------|
| 1 | **Critical** | Daraja (M-Pesa) webhooks accept unauthenticated, unsigned POSTs — forged payments and free hotspot vouchers | `backend/src/payments/daraja.js:108-149` |
| 2 | High | KopoKopo webhook signature check fails open when `KOPOKOPO_WEBHOOK_SECRET` is unset | `backend/src/payments/kopokopo.js:55-60` |
| 3 | High | No rate limiting anywhere — admin login, portal login, STK purchase, code verification all bruteforceable | `backend/src/server.js:118-150, 648-665, 367-447, 771-776` |
| 4 | Medium | Admin login username/email enumeration via distinct 404/401 wording is minimized but STK/portal endpoints leak status via unauthenticated polling of guessable IDs | `backend/src/server.js:455-473, 763-767` |
| 5 | Medium | Any authenticated staff account (any role) can read/write every tenant-admin endpoint — no role-based authorization beyond a single `is_super_admin` platform-owner check | `backend/src/server.js:601-606, 3794` |
| 6 | Medium | Outdated frontend build/runtime dependencies with public advisories (`vite`, `esbuild`, `react-router`) | `frontend/package.json`, `npm audit` output below |
| 7 | Low | `node-cron`'s bundled `uuid` dependency has a public advisory (buffer bounds check) | `backend/package.json:17`, `npm audit` output below |
| 8 | Low | Single point of failure for `/radius/*` and `/internal/*` isolation is the Caddy config, not the app itself | `infra/caddy/Caddyfile:31-64`, `backend/src/server.js:601-606` |
| 9 | Informational | RouterOS "unknown parameter" retry-and-strip loop reviewed — no security-relevant bypass found, but documented as a latent risk if it is ever reused for hand-typed input | `backend/src/routeros.js:153-199` |
| 10 | Informational | No CORS middleware configured — correct for this architecture (same-origin only), noted as a pass, not a gap | `backend/src/server.js` (absence confirmed by search) |
| 11 | Informational | System uses opaque DB-backed session tokens, not JWT — stronger than the brief assumed | `backend/src/auth.js:38-65` |

---

## Detailed findings

### 1. [Critical] Daraja webhooks accept forged payment confirmations and STK callbacks

**OWASP:** A07:2021 – Identification and Authentication Failures (webhook has no way to authenticate its caller); also A01:2021 – Broken Access Control (state-changing endpoint reachable by anyone).
**STRIDE:** Spoofing (of Safaricom as the caller), Tampering (of the payment amount/account), Repudiation is partially mitigated by idempotency but not attribution.

**Evidence.** `backend/src/server.js:78-82` mounts the payment webhook routers above the tenant/auth resolvers, deliberately unauthenticated:

```js
// Webhooks (no auth; verified per provider, idempotent downstream)
app.use('/webhooks/daraja', daraja);
app.use('/webhooks/kopokopo', kopokopo);
```

The comment says "verified per provider" — but for Daraja it isn't. `backend/src/payments/daraja.js:124-138` (C2B confirm):

```js
router.post('/confirm', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });      // ack first, work after
  const b = req.body;
  const tenantId = await tenantByShortcode('daraja', String(b.BusinessShortCode));
  if (!tenantId) return;
  await applyPayment(tenantId, {
    provider: 'daraja',
    ref: b.TransID,
    amount: Number(b.TransAmount),
    phone: normalise(b.MSISDN),
    name: [b.FirstName, b.MiddleName, b.LastName].filter(Boolean).join(' '),
    rawAccount: b.BillRefNumber,
    payload: b
  }).catch(console.error);
});
```

and `backend/src/payments/daraja.js:140-149` (STK callback):

```js
router.post('/stk', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const cb = req.body?.Body?.stkCallback;
  if (!cb) return;
  const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map(i => [i.Name, i.Value]));
  await handleStkResult('daraja', cb.CheckoutRequestID, cb.ResultCode, cb.ResultDesc, {
    ref: items.MpesaReceiptNumber, amount: items.Amount, phone: String(items.PhoneNumber ?? '')
  }).catch(console.error);
});
```

Neither handler checks an HMAC signature, a shared secret, a bearer token, or the source IP. Compare this to the KopoKopo handler in the same codebase (`kopokopo.js:42-60`), which *does* verify an `X-KopoKopo-Signature` HMAC — proving the pattern is known and simply wasn't applied to Daraja. Safaricom's Daraja API does not sign callbacks by default, which is exactly why an application-level shared secret in the callback URL, or Safaricom's published IP range, is the standard mitigation — neither is present here. `CallBackURL` is built in `daraja.js:29` as a bare, guessable path: `` `${process.env.BASE_URL}/webhooks/daraja/stk` ``.

The Caddy config confirms this is reachable from the public internet on every tenant hostname (`infra/caddy/Caddyfile:43-45`):

```
handle /webhooks/* {
    reverse_proxy net:8080
}
```

**Exploit scenario A — free money on the C2B path.** `BusinessShortCode` is a paybill/till number, which is public (printed on receipts, SMS confirmations, and often the ISP's own marketing). `BillRefNumber` is the subscriber's account code, which many ISPs also expose to the customer (it's what they're told to enter when paying) and which is guessable/enumerable for sequential or phone-derived account codes (see the fuzzy-matcher in `apply.js:76-98`, which already anticipates typo'd/near-miss account codes). An attacker who knows or guesses a valid `(shortcode, account_code)` pair can POST:

```
POST https://<tenant>.vibelink.tech/webhooks/daraja/confirm
{"BusinessShortCode":"<known shortcode>","TransID":"<any unique string>",
 "TransAmount":"100000","MSISDN":"254700000000","BillRefNumber":"<victim's account code>"}
```

`applyPayment` (`backend/src/payments/apply.js:12-42`) will insert a `payments` row keyed on `(tenant_id, provider, provider_ref)` — since `TransID` is attacker-chosen and arbitrary, the `on conflict ... do nothing` idempotency guard does not stop a *new* forged transaction ID from being accepted every time — and then extend the subscriber's `expires_at` and mark their invoice paid, for any amount the attacker names. Repeated calls with fresh `TransID` values can top up service indefinitely for free, or credit an account with dollars — this reaches money, not just data.

**Exploit scenario B — free hotspot access.** A guest calls `POST /hotspot/buy` (`server.js:367-447`) to get a real `checkoutId` from Daraja's `stkPush` without ever paying (the STK prompt just needs to be sent — Safaricom returns a `CheckoutRequestID` immediately, before the customer approves or declines on their phone). The guest then forges:

```
POST https://<tenant>.vibelink.tech/webhooks/daraja/stk
{"Body":{"stkCallback":{"CheckoutRequestID":"<their own real checkoutId>","ResultCode":0,
 "CallbackMetadata":{"Item":[{"Name":"MpesaReceiptNumber","Value":"FAKE123"},
 {"Name":"Amount","Value":100},{"Name":"PhoneNumber","Value":254700000000}]}}}}
```

`handleStkResult` (`daraja.js:151-194`) looks the row up purely by `checkout_id`, sees `ResultCode === 0`, and calls `applyPayment` with `target: { type: 'hotspot', planId, mac }`, which issues a real voucher via `issueVoucherAccess` and texts it to the phone number the attacker supplied — all without ever approving the M-Pesa STK prompt or paying anything. This is a direct "get a hotspot voucher without paying" bypass, one of the specific concerns in the brief.

**Remediation.**
- Generate a per-tenant (or platform-wide) random webhook secret and embed it in the callback URL path or as a query parameter (e.g. `CallBackURL: .../webhooks/daraja/stk?k=<secret>`), then reject requests where it doesn't match, using `crypto.timingSafeEqual` the same way `kopokopo.js:58-59` already does.
- Additionally allow-list Safaricom's published Daraja callback source IPs at the Caddy layer for `/webhooks/daraja/*`, mirroring the `/radius/*` "not proxied to strangers" pattern already used elsewhere in the same `Caddyfile`.
- Treat `TransID`/`MpesaReceiptNumber` as attacker-controlled until a secret/IP check passes — do not trust it for idempotency alone.

---

### 2. [High] KopoKopo webhook verification fails open with no secret configured

**OWASP:** A05:2021 – Security Misconfiguration.
**STRIDE:** Spoofing.

**Evidence.** `backend/src/payments/kopokopo.js:55-60`:

```js
function verify(req) {
  const secret = process.env.KOPOKOPO_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(req.get('X-KopoKopo-Signature') ?? ''));
}
```

If the operator (or the platform owner, at deploy time) never sets `KOPOKOPO_WEBHOOK_SECRET`, `verify()` unconditionally returns `true` and the endpoint behaves exactly like the unauthenticated Daraja one in Finding 1 — same "forge a hotspot voucher for free" exploit path via `router.post('/stk', ...)` at `kopokopo.js:42-51`. This is a reasonable default for local development but is dangerous as a silent production fallback: there's no startup check, log warning, or health-check flag that fires when the secret is absent, so a misconfigured production deploy degrades to "anyone can forge M-Pesa STK callbacks" with no visible symptom.

**Remediation.** In production (`NODE_ENV === 'production'` or equivalent), fail closed instead: refuse to start, or reject all `/webhooks/kopokopo/*` requests with 503, if `KOPOKOPO_WEBHOOK_SECRET` is unset. At minimum, log a loud warning at boot.

---

### 3. [High] No rate limiting anywhere in the stack

**OWASP:** A07:2021 – Identification and Authentication Failures (credential stuffing / brute force on login); also A04:2021 – Insecure Design (unbounded STK push spending).
**STRIDE:** Denial of Service (repeated hotspot-buy calls trigger real M-Pesa/KopoKopo API calls, which typically carry a per-request cost or rate quota from the payment provider), Spoofing (credential brute force).

**Evidence.** `backend/package.json` has no `express-rate-limit`, no `rate-limiter-flexible`, nor any hand-rolled limiter — confirmed by searching the whole backend source tree for `rate.?limit` (only doc-comment matches, no implementation). The admin login (`server.js:118-150`), portal login (`server.js:648-665`), the hotspot bundle-purchase endpoint that triggers a real STK push to Safaricom/KopoKopo (`server.js:367-447`), and the M-Pesa code verification lookup (`server.js:771-776`) are all reachable at unlimited request rates from any IP.

**Exploit scenario.** 1) An attacker scripts repeated `POST /api/auth/login` or `POST /portal/login` attempts against a known email/account-code with a password dictionary — scrypt with `N=16384` (`auth.js:16-17`) is deliberately slow per-attempt, which helps, but nothing stops parallel connections from many IPs. 2) An attacker scripts repeated `POST /hotspot/buy` calls with a plan ID and arbitrary phone numbers — each call is a live, billable Daraja/KopoKopo STK-push API call; hammering this can exhaust the tenant's provider API quota or run up STK push volume charges, and combined with Finding 1/2 lets an attacker mint unlimited free vouchers per second rather than one at a time.

**Remediation.** Add IP- and/or account-based rate limiting (e.g. `express-rate-limit` backed by Redis, or Caddy's own `rate_limit` directive) on `/api/auth/login`, `/portal/login`, `/hotspot/buy`, `/portal/buy`, and `/portal/verify-code` at minimum.

---

### 4. [Medium] Unauthenticated status-polling endpoints trust a guessable identifier

**OWASP:** A01:2021 – Broken Access Control (weak object reference).
**STRIDE:** Information Disclosure.

**Evidence.** `backend/src/server.js:455-473` (`GET /hotspot/buy/:checkoutId`) and `server.js:763-767` (`GET /portal/status/:checkoutId`) both return payment status and, in the hotspot case, the voucher code itself, keyed only on `checkoutId` — no session, no proof of ownership beyond knowing the ID:

```js
app.get('/hotspot/buy/:checkoutId', wrap(async (req, res) => {
  ...
  const { rows: [v] } = await pool.query(
    `select v.code, v.expires_at
       from payments p join vouchers v on v.id = p.voucher_id
      where p.tenant_id=$1 and p.provider_ref=$2`, [tenant.id, req.params.checkoutId]);
  res.json({ status: r.status, detail: r.result_desc ?? null, code: v?.code ?? null });
}));
```

Daraja's `CheckoutRequestID` and KopoKopo's incoming-payment ID are long, provider-generated, effectively unguessable identifiers in normal operation, so this is not independently exploitable at Medium severity on its own — it is flagged because it compounds Finding 3 (no rate limiting means this can be polled/brute-forced without friction) and because it's the same class of "identifier as sole authorization" pattern used throughout the captive-portal flow (also see `chat/:id` at `server.js:529-533`, which does correctly pair the id with a random `token` — the hotspot/portal status endpoints are the outliers that don't).

**Remediation.** Low urgency given the entropy of the identifiers involved; if hardened, pair `checkoutId` with a short-lived client-side token the way `/chat/:id` already does, and rate-limit the polling endpoint regardless.

---

### 5. [Medium] No role-based authorization — any staff login can reach every admin endpoint

**OWASP:** A01:2021 – Broken Access Control.
**STRIDE:** Elevation of Privilege (within a tenant).

**Evidence.** The global admin-route guard is binary — signed in or not — with no per-route role check:

```js
// server.js:601-606
app.use((req, res, next) => {
  if (req.path.startsWith('/portal/') || req.path.startsWith('/radius/')
      || req.path.startsWith('/hotspot/')) return next();
  if (!req.session) return res.status(401).json({ error: 'sign in required' });
  next();
});
```

`staff.role` exists and is used for UI purposes and for one specific carve-out — only an owner (or platform `is_super_admin`) can delete another owner (`server.js:3794`, `target.role === 'owner' && !req.session.is_super_admin`) — but nothing else in the ~4900-line route table checks `req.session.role`. A `support`-role staff account (created at `server.js:3762-3768` with `role = 'support'` by default) can call every router-credential, payment-gateway, SMS-gateway, and email-gateway endpoint that an `owner` can, including reading decrypted router credentials (`/api/subscribers/:id/credentials`, `/api/routers/:id/...`), configuring M-Pesa/KopoKopo API keys (`/api/payment-methods/:provider/test`), and issuing settlement payouts.

**Exploit scenario.** A disgruntled or compromised low-privilege support account (phished credentials, or an insider) can exfiltrate router admin passwords, M-Pesa consumer secrets, and initiator credentials for the whole tenant, or delete/modify billing data, with no privilege escalation needed — the "escalation" is simply having any login at all.

**Remediation.** Add a lightweight `requireRole([...])` middleware and apply it to router-credential, payment-gateway-credential, and staff-management routes, gating them to `owner` (and `is_super_admin`) the way the owner-deletion check already does in one place.

---

### 6 & 7. [Medium/Low] Dependency findings — see the Dependency/CVE section below for full detail and citations.

---

### 8. [Low] `/radius/*` and `/internal/*` isolation lives only in the reverse proxy

**OWASP:** A05:2021 – Security Misconfiguration.
**STRIDE:** Spoofing (of FreeRADIUS / Caddy as the caller).

**Evidence.** `backend/src/server.js:601-606` explicitly *allows* unauthenticated access to `/radius/*` at the Express layer (`req.path.startsWith('/radius/')` skips the session check), relying entirely on `infra/caddy/Caddyfile:62-64` never forwarding those paths from the public listener:

```
# /radius/* is deliberately not proxied. FreeRADIUS reaches the API over the
# compose network, so exposing it here would only let strangers POST to
# /radius/post-auth and start voucher clocks.
```

This is a sound and clearly-documented design, but it means the entire protection for `/radius/post-auth` (which calls `startVoucherClock`, `server.js:1123-1128`) and `/internal/tls-check` (the Caddy on-demand-TLS gate) is a single Caddyfile correctly omitting a `handle` block. Any future change to the Caddy config (a wildcard `handle /*`, a misconfigured second reverse proxy, a container network change that exposes port 8080 directly) removes that protection with no defense-in-depth at the app layer to catch it.

**Remediation.** Consider a defense-in-depth check in Express itself for `/radius/*` and `/internal/*` — e.g. a shared secret header set by FreeRADIUS/Caddy, or a source-IP check against the known compose-network CIDR — so a proxy misconfiguration doesn't silently become a public voucher/TLS-gate abuse endpoint.

---

### 9. [Informational] RouterOS "unknown parameter" retry loop — reviewed, no bypass found

**OWASP:** N/A (robustness review, not a vulnerability in itself).

**Evidence.** `backend/src/routeros.js:153-199`, the `cmd()` wrapper strips *only* parameters RouterOS itself names as `unknown parameter <name>` and retries, capped at 4 rounds (`for (let round = 0; round < 4; round++)`, line 183). This fires when a menu doesn't recognize a property name at all (e.g. an older RouterOS build lacking `one-session-per-host`), not when RouterOS rejects a *value* as invalid — those come back as different error text (`"invalid value"`, `"failure"`, etc.) that this regex does not match, so a legitimate validation rejection (e.g. a malformed IP, an out-of-range rate limit) is not silently swallowed by this path. All call sites construct their `args` from server-side, already-validated data (tenant plan rates, router-generated secrets, DB rows) — none pass raw, unsanitized end-user text as a RouterOS property name that could later be "unknown-parameter-stripped" to defeat a security-relevant field. No exploitable bypass was found in the current code.

This is flagged informationally because the pattern is generic ("strip whatever RouterOS calls unknown") rather than an explicit allow-list of droppable property names — if a future call site ever passes attacker-influenceable property *names* (not just values) into `cmd()`, this loop would silently drop any of them RouterOS objects to, including a would-be security-relevant one. Recommend a small comment/guard restricting the strip-and-retry behavior to an explicit list of cosmetic/optional properties (`comment`, `one-session-per-host`, etc.) rather than "anything RouterOS calls unknown," so the blast radius of a future mistake is bounded.

---

### 10. [Informational / Pass] No CORS middleware — correct for this architecture

**OWASP:** A05:2021 – Security Misconfiguration (checked; not applicable here).

No `cors` package, no `Access-Control-Allow-Origin` header, and no `app.options`/preflight handling exist anywhere in `backend/src` (confirmed by full-text search). Because the frontend is served from the same origin as the API via Caddy (`infra/caddy/Caddyfile:68-72`, the React bundle and `/api/*` both live under `*.{$ROOT_DOMAIN}`), the browser's default same-origin policy already blocks cross-origin reads of session-cookie-authenticated responses from third-party sites — there is no wildcard CORS hole to find. This is recorded as a checked-and-passed item, not a gap.

---

### 11. [Informational / Correction] Session model is opaque DB tokens, not JWT

The brief's framing mentions "JWT-based auth" — the actual implementation (`backend/src/auth.js:1-147`) uses `crypto.randomBytes(32)` opaque tokens stored in `admin_sessions`/`portal_sessions` tables, validated by DB lookup on every request (`auth.js:49-62`), with `HttpOnly; SameSite=Lax` cookies (`Secure` added in production, `auth.js:109-120`). There is no `jsonwebtoken` dependency in `package.json` and no JWT decode/verify calls anywhere in the tree. This avoids the classic JWT pitfalls entirely (algorithm confusion, `alg: none`, unrevocable tokens, secret management) at the cost of a DB round-trip per request, which is a reasonable tradeoff at this scale. No action needed; noted so the assessment doesn't leave a JWT-shaped gap in the record that doesn't actually exist in the code.

---

## Areas specifically checked at the owner's request, with results

| Area | Result |
|---|---|
| Cross-tenant data leakage / IDOR on subscriber, router, voucher IDs | **Pass.** Every sampled query across `server.js` (90+ routes reviewed) scopes by `tenant_id` derived from `req.tenant.id`, which itself is set only from the authenticated session or resolved hostname (`server.js:547-556`). No route was found selecting/mutating by a bare `:id` param without an accompanying `tenant_id=$N` predicate. |
| SQL injection | **Pass.** All queries reviewed use parameterized `pool.query(text, [params])` / `c.query(text, [params])` calls; no string concatenation of request input into SQL text was found. |
| RouterOS command injection | **Pass.** RouterOS API arguments are constructed as `=key=value` array entries passed to `conn.write(path, args)` (the `routeros-client` library), not concatenated into a shell or CLI string — there is no shell/CLI syntax for user input to break out of. |
| SSRF via `/tool/fetch` hotspot-page push | **Pass, verified specifically.** `pushHotspotPage(conn, { url })` (`routeros.js:888-926`) does reach `/tool/fetch` on the router with an attacker-network-adjacent target — but the `url` passed in is always server-constructed from the tenant's own subdomain (`` `https://${portal}/hotspot/login.html?router=1` ``, `server.js:1926` and `server.js:2408`), never taken from request body/query. No caller was found passing user-supplied input into this parameter. |
| M-Pesa/KopoKopo webhook signature verification | **Fail (Daraja) — see Finding 1. Conditional pass (KopoKopo) — see Finding 2.** |
| Guest hotspot voucher without paying | **Fail — see Finding 1, Exploit scenario B.** |
| RouterOS credential handling | **Pass.** Encrypted at rest with AES-256-GCM (`secrets.js:36-42`), authenticated so tampering fails loudly on decrypt; key derived via scrypt from `APP_SECRET_KEY`, which must live outside the DB. |
| JWT secret handling / token validation | **N/A — no JWT in use; see Finding 11.** |
| Session/password handling | **Pass.** scrypt (N=16384) with per-password salt, constant-time compare (`auth.js:14-34`); login timing is equalized between "no such account" and "wrong password" by always calling `verifyPassword` (`server.js:133-138`). |
| File upload endpoints | **N/A.** No file-upload endpoint (multipart/binary ingest) was found anywhere in `backend/src`. |
| Rate limiting | **Fail — see Finding 3.** |
| CORS configuration | **Pass — see Finding 10.** |

---

## Dependency / CVE review

### Backend (`backend/package.json`, versions as actually installed in `node_modules`)

| Package | Declared range | Installed | Notes |
|---|---|---|---|
| express | ^4.19.2 | 4.22.2 | No open advisory found for this line at time of review. |
| axios | ^1.7.2 | 1.19.0 | No open advisory found for this line at time of review. |
| pg | ^8.12.0 | 8.23.0 | No open advisory found for this line at time of review. |
| routeros-client | ^0.9.0 | 0.9.0 | Small, low-traffic package; no advisory found in `npm audit` or GitHub Advisory Database search. |
| node-cron | ^3.0.3 | 3.0.3 | **Moderate advisory via its `uuid` dependency**, see below. |
| nodemailer | ^9.0.5 | 9.0.5 | No open advisory found. |
| pino | ^9.2.0 | 9.14.0 | No open advisory found. |
| dotenv | ^16.4.5 | 16.6.1 | No open advisory found. |

**`npm audit --json` output (backend), reproduced verbatim:**

```
node-cron  3.0.2 - 3.0.3  (moderate, via uuid)
  fixAvailable: node-cron@4.6.0 (semver-major)
uuid       <11.1.1        (moderate, direct advisory)
  GHSA-w5hq-g745-h8pq — "uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided"
  CVSS 3.1: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N), CWE-787 / CWE-1285
  https://github.com/advisories/GHSA-w5hq-g745-h8pq

Totals: 0 critical, 0 high, 2 moderate, 0 low
```

This advisory affects `uuid` only when the caller supplies its own output buffer to `v3()`/`v5()`/`v6()` — `node-cron` uses `uuid` internally for job IDs and is very unlikely to hit this call pattern, so real-world exploitability here is low, but it is a genuine open advisory on a transitive dependency and the fix (`node-cron@4.6.0`) is a semver-major bump the project hasn't taken.

**Remediation:** `npm audit fix --force` in `backend/` (review breaking changes in node-cron 4.x's API before deploying — it changed its module shape).

### Frontend (`frontend/package.json`)

`npm audit --json` (frontend), key findings:

```
esbuild   <=0.24.2   (moderate)
  GHSA-67mh-4wv8-2f99 — "esbuild enables any website to send any requests to the
  development server and read the response" (dev-server only; CVSS 5.3)

vite      <=6.4.2    (high)
  GHSA-fx2h-pf6j-xcff — "vite: server.fs.deny bypass on Windows alternate paths" (CVSS 7.5, CWE-22)
  GHSA-4w7w-66w2-5vf9 — "Vite Vulnerable to Path Traversal in Optimized Deps .map Handling"
  GHSA-v6wh-96g9-6wx3 — "launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows"
  fixAvailable: vite@8.2.1 (semver-major)

react-router-dom  6.0.0-alpha.0 - 7.17.0  (moderate, via react-router)
  GHSA-wrjc-x8rr-h8h6 — "React Router: Open redirect via backslash in <Link>/useNavigate
  (CVE-2025-68470 bypass)"
  GHSA-337j-9hxr-rhxg — "React Router: Arbitrary Constructor Injection via deserializeErrors()
  in React Router SSR Hydration" (CVSS 6.1, CWE-470)
  fixAvailable: react-router-dom@7.18.2 (semver-major)

Totals: 0 critical, 1 high, 3 moderate, 0 low
```

**Assessment of real-world impact.** The `vite`/`esbuild` advisories are dev-server-only (they concern `vite dev`/`vite preview` accepting requests from arbitrary origins or serving files outside the project root) and do not affect the production build artifact served by Caddy — but the Windows path-traversal one (`GHSA-fx2h-pf6j-xcff`) is relevant if anyone runs `vite dev`/`vite preview` on a Windows host reachable by others (matches this project's dev environment, per the system context). The React Router open-redirect and SSR-hydration advisories are more relevant to production since `react-router-dom` ships in the built bundle — the SSR/hydration one (CWE-470, "Arbitrary Constructor Injection") is not applicable since this app is not doing SSR, but the open-redirect via `<Link>`/`useNavigate` (CVE-2025-68470 bypass) could matter if any route ever builds a redirect target from user input.

**Remediation:** Bump `vite` to 6.x's latest patch (not necessarily the major 8.x jump) if a compatible patched 6.x/7.x exists, and take the `react-router-dom` update; both `fixAvailable` entries above are flagged as semver-major, so schedule as a planned upgrade with a smoke test rather than a blind `--force`.

---

## OWASP Top 10 (2021) coverage checklist

| # | Category | Checked | Result |
|---|---|---|---|
| A01 | Broken Access Control | Yes | **Fail** — Finding 5 (no per-route role check beyond owner-deletion). Cross-tenant IDOR specifically: **Pass**. |
| A02 | Cryptographic Failures | Yes | **Pass** — scrypt for passwords (`auth.js:14-34`), AES-256-GCM for router credentials (`secrets.js`), RSA-encrypted B2C initiator credential per Safaricom's own scheme (`daraja-credential.js`, referenced from `daraja.js:72,79`). |
| A03 | Injection | Yes | **Pass** — parameterized SQL throughout; no shell/CLI injection surface in RouterOS calls (array-based API, not string commands). |
| A04 | Insecure Design | Yes | **Fail** — Finding 3 (unlimited STK-push triggering is a design gap, not just a missing filter); webhook trust model in Finding 1 is also a design-level gap, not an implementation typo. |
| A05 | Security Misconfiguration | Yes | **Fail** — Finding 2 (fail-open webhook verification), Finding 8 (single-layer network isolation for `/radius`). **Pass** on CORS (Finding 10) and on `NODE_ENV`-gated `Secure` cookie flag (`auth.js:118`). |
| A06 | Vulnerable and Outdated Components | Yes | **Fail (Low/Medium)** — see Dependency section: `uuid` via `node-cron` (backend), `vite`/`esbuild`/`react-router-dom` (frontend). No critical/high in production-reachable backend code. |
| A07 | Identification and Authentication Failures | Yes | **Fail** — Finding 1 (webhook caller not authenticated at all), Finding 3 (no login rate limiting). **Pass** on password hashing, session token entropy/expiry, and enumeration-resistant login error handling. |
| A08 | Software and Data Integrity Failures | Yes | **Fail** — Finding 1 is fundamentally a data-integrity failure (payment records trusted without verifying their origin). Idempotency (`on conflict do nothing` in `apply.js:17`) protects against *replay* of the same transaction but not forgery of a new one. |
| A09 | Security Logging and Monitoring Failures | Yes | **Partial fail** — webhook and payment failures are logged to `console.error`/`console.log` only (e.g. `daraja.js:110,117`, `kopokopo.js` has no logging at all on verification failure), with no structured audit trail, alerting, or persisted security-event log distinguishing a forged webhook attempt from a legitimate one. Given Finding 1, there is currently no way to retroactively detect that forged payments occurred. |
| A10 | Server-Side Request Forgery (SSRF) | Yes, specifically per the brief | **Pass** — see "Areas specifically checked" table above; `/tool/fetch` target URL is always server-constructed, never attacker-supplied, in every call site found. |

---

## STRIDE coverage table

| Threat | Checked | Result |
|---|---|---|
| **S**poofing | Yes | **Fail** — Finding 1 (Daraja webhook caller unverified), Finding 2 (KopoKopo verification fail-open path). Session/login spoofing itself: **Pass** (scrypt, timing-safe compare, opaque tokens). |
| **T**ampering | Yes | **Fail** — Finding 1 (payment amount/account tamperable via forged webhook body). SQL/RouterOS command tampering: **Pass** (parameterized queries, structured RouterOS args). |
| **R**epudiation | Yes | **Partial fail** — Finding A09 above; payments carry `payload` (raw webhook body, `apply.js:15-19`) which does provide forensic evidence *after the fact*, but nothing flags a forged webhook as suspicious at ingest time, and there's no signed/append-only audit log distinct from the mutable `payments` table itself. |
| **I**nformation Disclosure | Yes | **Mostly pass** — tenant isolation holds throughout; Finding 4 is a minor disclosure-adjacent issue (status/voucher code behind a guessable-in-theory identifier, mitigated by high entropy in practice). Router/M-Pesa credentials are encrypted at rest and only decrypted server-side for use (not found being sent to the client in any reviewed route). |
| **D**enial of Service | Yes | **Fail** — Finding 3; unlimited STK pushes and login attempts can exhaust provider quotas or hammer the DB/scrypt CPU cost with no backpressure. |
| **E**levation of Privilege | Yes | **Fail** — Finding 5 (no role gating beyond a single owner-deletion check; any staff role reaches every tenant-admin capability). Cross-tenant privilege escalation specifically: **Pass** (no route found that lets tenant A staff act on tenant B's data). |

---

## Summary of remediation priority

1. **Immediately:** Add signature/secret verification to the Daraja webhooks (Finding 1) — this is actively exploitable for financial fraud and free service theft today, on every tenant, with no authentication required.
2. **This week:** Make KopoKopo verification fail closed in production (Finding 2); add rate limiting to login and STK-push endpoints (Finding 3).
3. **This sprint:** Add role-based route authorization beyond the single owner-deletion check (Finding 5); update `react-router-dom` and `vite` (dependency section); add structured logging/alerting on webhook verification failures (A09).
4. **Backlog / hardening:** Bound the RouterOS unknown-parameter retry to an explicit property allow-list (Finding 9); add a defense-in-depth check on `/radius/*` independent of the Caddy config (Finding 8); pair guessable status-poll identifiers with a short-lived token (Finding 4).
