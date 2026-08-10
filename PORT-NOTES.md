# Porting notes — BILLING.SYSTEM.dc.html → frontend/

## Source layout

`BILLING.SYSTEM.dc.html` (542,775 bytes, 5,717 lines) is a Claude Design `DCLogic`
component:

- **lines 1–3137** — `<x-dc>` template. Pure interpolation (`{{ }}`) plus two custom
  elements: `<sc-if value="{{ cond }}">` and `<sc-for list="{{ xs }}" as="x">`.
  Inline styles only, no classes.
- **line 3138** — `<script data-dc-script data-props="…">`; the only declared prop is
  `brandName` (default `ISP BILLING`, though `renderVals()` falls back to `Mtandao Bill`).
- **lines 3139–5717** — the component class: `state` (3140–3286), methods, then
  `renderVals()` at 4563 which computes every `{{ }}` value.

## Template section map (line ranges in the .dc.html)

Line numbers refer to the **current** 5,880-line revision, which added the auth gate
ahead of the app shell and shifted everything below it by ~73 lines.

| Screen | Lines | Ported to |
|---|---|---|
| auth gate | 27–98 | `src/app/AuthGate.jsx` |
| sidebar | 102–241 | `src/app/Sidebar.jsx` |
| topbar | 245–283 | `src/app/Topbar.jsx` |
| live support | 214–308 | `src/screens/LiveSupport.jsx` |
| dashboard | 309–390 | `src/screens/Dashboard.jsx` |
| clients (pppoe) | 391–446 | `src/screens/Clients.jsx` |
| hotspot tab bar | 447–478 | `src/screens/Hotspot.jsx` |
| hotspot · dashboard | 479–513 | `src/screens/hotspot/HotspotDashboard.jsx` |
| hotspot · plans | 514–536 | `src/screens/hotspot/HotspotPlans.jsx` |
| hotspot · vouchers | 537–611 | `src/screens/hotspot/Vouchers.jsx` |
| hotspot · design | 612–678 | `src/screens/hotspot/PortalDesign.jsx` |
| hotspot · revenue | 679–752 | `src/screens/hotspot/HotspotRevenue.jsx` |
| hotspot · settings | 753–845 | `src/screens/hotspot/HotspotSettings.jsx` |
| networks | 846–885 | `src/screens/Networks.jsx` |
| routers | 886–950 | `src/screens/Routers.jsx` |
| tariffs | 951–973 | `src/screens/Tariffs.jsx` |
| payments | 974–1133 | `src/screens/Payments.jsx` |
| automation | 1134–1192 | `src/screens/Automation.jsx` |
| tickets | 1193–1235 | `src/screens/Tickets.jsx` |
| leads | 1236–1290 | `src/screens/Leads.jsx` |
| messaging | 1291–1384 | `src/screens/Messaging.jsx` |
| ISP tenants | 1385–1462 | `src/screens/Tenants.jsx` |
| SaaS revenue | 1463–1512 | `src/screens/SaasRevenue.jsx` |
| analytics | 1513–1567 | `src/screens/Analytics.jsx` |
| knowledge base | 1568–1606 | `src/screens/KnowledgeBase.jsx` |
| staff & roles | 1607–1690 | `src/screens/Staff.jsx` |
| site payment profiles | 1691–1766 | `src/screens/SiteProfiles.jsx` |
| service outages | 1767–1829 | `src/screens/Outages.jsx` |
| SLA management | 1830–1914 | `src/screens/Sla.jsx` |
| settings | 1915–… | `src/screens/Settings.jsx` |
| add client, modals, drawers | …–3137 | `src/screens/AddClient.jsx`, primitives |

## Conventions

- Tokens in `src/theme/tokens.js`; primitives in `src/ui/primitives.jsx`.
- Store in `src/state/store.jsx` mirrors the mockup's `state` slice names.
- **Every data array in the mockup's `state` is empty** — the design was stripped
  of demo data on purpose. Screens must render real empty states, never fixtures.
- Dark mode is the mockup's `filter: invert(1) hue-rotate(180deg)` trick, not a
  second palette. See `global.css`.

## Running it

```bash
docker compose up -d          # Postgres on 5432
cd backend  && npm install && npm run migrate && npm start
cd frontend && npm install && npm run dev
```

Then create an owner account (see "Creating an account" below) and sign in at
http://localhost:5173.

`npm run migrate` is `scripts/migrate.mjs`, not psql — it uses the `pg` dependency
so nothing needs to be on PATH, and takes `-- --reset` to drop and re-apply.

### Error handling

Express 4 does not await handlers, so a rejected async handler becomes an unhandled
rejection — fatal on Node 22+. A single unreachable-database moment used to kill the
whole API from the tenant-resolver middleware. `server.js` now wraps every handler's
rejection into `next()` once, at the top, and ends with an error handler that maps
common Postgres failures to something actionable (`ECONNREFUSED` → "Cannot reach the
database. Is it up? docker compose up -d", `42P01` → "run npm run migrate"). pg raises
an `AggregateError` with an empty `message` when it cannot connect, which would
otherwise surface as a blank red banner in the UI. Cron jobs are individually guarded
in `jobs.js` for the same reason.

The frontend runs standalone — with no backend up, every collection resolves empty
and the screens show their real empty states. To wire it to the API:

```bash
cd backend && npm install && npm run migrate && npm start
```

`vite.config.js` proxies `/api`, `/portal`, `/radius` and `/webhooks` to
`http://localhost:8080` and sets a `Host` header, because `tenantByHost()` resolves
the tenant from the request hostname. Override with `VITE_API_ORIGIN` and
`VITE_TENANT_HOST`.

## What is wired

Every call in `frontend/src/api/client.js` now maps to a route in
`backend/src/server.js` — 72 routes total. There is no `UNWIRED` set any more.

Routes added on top of the ones the design shipped:

| Area | Routes |
|---|---|
| subscribers | `POST /api/subscribers`, `PATCH|DELETE /api/subscribers/:id` |
| money | `GET /api/payments`, `GET|POST /api/invoices`, `GET /api/settlements` |
| catalogue | `GET|POST /api/plans`, `DELETE /api/plans/:id`, `DELETE /api/tariffs/:id` |
| vouchers | `GET|POST /api/vouchers`, `POST /api/vouchers/delete`, `POST /api/vouchers/purge-expired` |
| staff | `GET|POST /api/staff`, `DELETE /api/staff/:id` |
| support | `PATCH|DELETE /api/tickets/:id`, `PATCH /api/leads/:id` |
| outages | `GET|POST /api/outages`, `PATCH /api/outages/:id` |
| SLA | `GET|POST /api/sla-policies`, `DELETE /api/sla-policies/:id` |
| KB | `GET|POST /api/kb-articles`, `DELETE /api/kb-articles/:id` |
| site profiles | `GET|POST /api/site-profiles`, `DELETE /api/site-profiles/:id` |
| payments cfg | `PUT /api/payment-methods/:provider` |
| network | `GET /api/ovpn-clients` |
| SMS | `GET /api/sms/history`, `POST /api/sms/bulk` |
| platform | `GET|POST /api/tenants`, `PATCH /api/tenants/:id` |
| settings | `GET|PUT /api/settings` |

New tables in `schema.sql`: `outages`, `sla_policies`, `kb_articles`,
`site_profiles`, `settlements`, `app_settings` — all with the same
`tenant_isolation` RLS policy as the originals.

## Features added beyond the design

- **Fair use policy** (`/fair-use`, `fup_policies`) — cap, window, throttle speeds,
  warning threshold, all-plans or per-plan scope, pause without deleting. The design
  only had fair use as free text on a tariff.
  **Enforcement is real** (`src/fup.js`): usage is summed from `sessions.bytes_in +
  bytes_out` over the policy's window; at the warning threshold the subscriber gets an
  SMS, and past the cap `radreply.Mikrotik-Rate-Limit` is rewritten to the throttle
  speed and pushed to the live session by CoA — the same mechanism as the walled
  garden. `fup_state` holds one row per subscriber per window recording what has
  already been done, which makes the quarter-hourly job idempotent; a new window
  restores full speed. A plan-specific policy beats an all-plans one, and ties break
  toward the tighter cap. The screen shows live usage bars, and an operator can lift a
  throttle early ("Restore speed") as a goodwill top-up. Verified against seeded
  traffic: 50% → no action, 85% → warned only, 110% → throttled with the rate
  changing from `5000k/10000k` to `1024k/2048k`, re-run → no change.
- **Several paybills per channel.** `tenant_payment_config` used to allow exactly one
  row per provider; the key now includes the shortcode and one row per provider is
  flagged `is_default`. `config()` in db.js picks the default, falling back to the
  oldest. Managed under Settings → Payment gateways. **Secrets are write-only** — the
  API returns only the *names* of credential keys that are set, and a blank field on
  edit keeps the stored value (`credentials || $5::jsonb`).
- **Automation switches** (`automation_jobs`) — every cron in `jobs.js` now filters on
  `tenant_id in (enabledTenants)`, so turning a job off in the UI genuinely stops the
  work rather than just greying out a card. An absent row means enabled, so existing
  tenants keep their behaviour.
- **SLA**: view drawer, edit modal, business-hours cover, escalation contact,
  pause/activate, and a tracking tab sorted by proximity to breach.
- **Tickets**: detail drawer with internal notes (`ticket_notes`), edit modal,
  inline assignee and status pickers, due dates and an Overdue filter.
- **Tenants**: view drawer, edit modal, suspend/reactivate, and delete behind a
  type-the-subdomain confirmation. The API refuses to delete the tenant you are
  signed in to.

## Testing the SMS pipeline

`backend/scripts/sms-sink.mjs` is a local stand-in provider — start it, point the
`custom` gateway at it, and every message the app would send is printed instead of
leaving the machine:

```bash
node scripts/sms-sink.mjs        # http://127.0.0.1:7788
```

Then Settings → SMS gateways → `custom`:

| field | value |
|---|---|
| `url` | `http://127.0.0.1:7788/send` |
| `body_template` | `{"phone":"{to}","text":"{message}"}` |
| `balance_url` | `http://127.0.0.1:7788/balance` |

`GET /sent` on the sink lists everything received; the balance endpoint counts down
from 1000 so the header credit chip has something real to show.

For a live-but-free test use the Africa's Talking **sandbox** (username `sandbox`).
Daraja also has a sandbox — `DARAJA_ENV=sandbox` switches the base URL — but its
callbacks need a publicly reachable `BASE_URL`, so it wants a tunnel. The manual
entry and reconcile paths exercise the same `applyPayment` funnel with no callbacks.

### Bugs found while testing SMS

- **A rejected message was logged as "sent".** Most of these gateways answer HTTP 200
  and put the real outcome in the body, so `axios` not throwing proved nothing.
  `send()` recorded success and returned, which also meant **failover never ran** —
  the message silently vanished while the log claimed delivery. `sms.js` now has an
  `ACCEPTED` check per provider (HostPinnacle status field, Africa's Talking
  `Recipients[].status`, TextSMS `respose-code`, Twilio `status`, …) and falls
  through to the next gateway on rejection.
- **A half-configured gateway shadowed a working one.** Gateways are tried in
  priority order, and one with missing credentials sat in front of a good one,
  failing every message. `send()` now skips gateways failing `credentialsComplete()`
  and logs them as `skipped`.
- SMS gateways could be added but never removed — there is now a
  `DELETE /api/sms/gateways/:provider` and a Remove action in Settings.

### Bugs found by making the buttons work

- **`radcheck` / `radreply` were never created.** `src/radius.js` writes RADIUS
  check/reply attributes on every activation and voucher issue, but `schema.sql`
  had no such tables — the design assumed FreeRADIUS's own schema was already
  present. Applying *any* payment failed with `relation "radcheck" does not exist`.
  Both tables are now in `schema.sql`; point FreeRADIUS at the same database.
- **`activateSubscriber` assumed every subscriber has `pppoe_user`.** It is
  nullable (CSV imports, hotspot-only accounts, not-yet-provisioned lines), and
  `radcheck.username` is NOT NULL, so applying a payment to such an account
  aborted the whole transaction. Both it and `walledGarden` now return early when
  there is nothing provisioned to write.
- **`npm run migrate` silently dropped statements.** The statement splitter
  attached preceding comment lines to each statement and then discarded anything
  starting with `--`, which threw away the DDL underneath. Comments are now
  stripped only to test for emptiness. Migrate also skips already-present objects
  so it runs against an existing database (`--strict` to disable, `--reset` to
  start clean).

### Things corrected while wiring

- `subscribers.plan_id` references **`plans`**, not `tariffs`. The Clients and Add
  client screens were reading the wrong table; the store now loads a `plans` slice.
  Tariffs and plans are parallel catalogues with no FK between them, so the Tariffs
  screen's subscriber count can only match on title.
- `sms.js` `DEFAULTS` had no `custom` template, so `POST /api/messages` (which the
  design shipped) rendered the literal string `undefined` as the message body.
  Added `custom: '{body}'`.
- Messaging's "By location" audience was removed — `subscribers` has no location
  column, so the server could not narrow it and would have messaged everyone.
- `POST /api/sms/bulk` resolves the audience server-side; the browser never
  receives or sends a phone list.

## Authentication

The design revision that added `sc-if value="{{ auth.needed }}"` keeps accounts in
component state (`accounts: []`) and compares passwords with `acct.password !== f.password`.
That is fine for a mockup and would be a fake security control in a real app, so the
port keeps the **UI verbatim** and replaces the **mechanism**:

- `staff.password_hash` holds a scrypt hash (`scrypt$N$salt$key`, all base64) —
  `backend/src/auth.js`, no new dependency, `node:crypto` only.
- Sessions are server-side rows in `admin_sessions`, keyed by 32 random bytes, handed
  to the browser as an **httpOnly, SameSite=Lax** cookie (`Secure` in production).
  "Keep me signed in" picks a 30-day vs 12-hour expiry.
- `POST /api/auth/signup` provisions tenant + owner staff + `hotspot_settings` in one
  transaction and rolls back as a unit.
- Auth routes mount **before** the tenant resolver — signing in is how you learn which
  tenant you belong to, so they cannot require one. Afterwards the session is the
  authoritative tenant, with hostname as the fallback for the portal and webhooks.
- The password never leaves the keystroke path: it is cleared from component state on
  success and never stored, logged, or echoed back.

### Auth gate layout

A later design revision reworked the gate so the signup form fits on a laptop
screen, and the port follows it:

- the shell width is conditional — `620px` on signup, `430px` on sign-in
  (`auth.shellWidth` in the mockup)
- the card is capped at `calc(100vh - 122px)` with `align-items: flex-start` and
  `margin: auto`, so it centres when short and clamps when tall
- signup fields sit in a two-column grid; company name and subdomain span both
  columns, and **only that grid scrolls** — the terms line and the submit button
  stay pinned, which is the bug the revision fixed

The optional username field (not in the design — see below) slots into the grid
beside Full name, keeping three clean rows of two.

### Signing in with a username

An addition beyond the design, which only had an email field. `staff.username` is
nullable and globally unique (case-insensitive, partial index). `POST /api/auth/login`
takes an `identifier` and matches it against `lower(email) OR lower(username)`; the
old `email` key is still accepted so nothing breaks. Signup has an optional username
field. Both the client and the server normalise it with the same rule
(`[^a-z0-9._-]` stripped, lowercased) so the field shows exactly what gets stored.

### Creating an account

`backend/scripts/create-account.mjs` provisions a tenant plus its owner:

```bash
node scripts/create-account.mjs --email you@example.com --password '…' \
  --company Acme --subdomain acme --name 'Your Name' --username you --super
```

Credentials come from the command line (or `SEED_PASSWORD`) rather than living in a
file, the password is scrypt-hashed before it reaches the database, and it is never
logged. Re-running against the same email resets that account's password instead of
failing, which is the recovery path for a locked-out owner.

**Platform-owner screens are enforced server-side.** `GET|POST /api/tenants` and
`PATCH /api/tenants/:id` sit behind `superAdminOnly`, which reads
`session.is_super_admin`. Hiding the nav items would not have been access control —
every tenant's revenue is behind those routes. The topbar role toggle is now shown
only to super admins, since it does nothing for anyone else.

### Local development

`tenantByHost()` resolves the tenant from the request hostname, which never matches
on localhost. Set `DEV_TENANT=<subdomain>` in `backend/.env` to pin one. Never set
it in production.

## Backend

`backend/` is imported from the same design project. `backend/src/server.js` is the
full HTTP surface. Routes that exist are wired in `src/api/client.js`; the rest are
listed under `UNWIRED` there and resolve empty.

Two files in the design project contained escaped backticks (`` \` ``) inside template
literals, which is a syntax error in JS — `backend/src/sms.js` (twilio provider) and
`backend/src/radius.js` (`generateCode`). Both now use real backticks; all 12 backend
modules pass `node --check`.

`backend/README.md` was not imported.
