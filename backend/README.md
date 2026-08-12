# WiFi Billing — backend

Multi-tenant PPPoE + hotspot billing for Kenyan ISPs. Node 20 + Express + Postgres + FreeRADIUS.

    npm install
    cp .env.example .env      # fill DB + payment credentials
    psql "$DATABASE_URL" -f schema.sql
    npm start                 # API on :8080, cron workers in-process

## Layout

    schema.sql              Postgres schema (tenants, subscribers, plans, vouchers, invoices, payments, sessions)
    src/server.js           Express app + route mounting + tenant resolution
    src/db.js               pg pool, tenant-scoped query helper
    src/payments/daraja.js  M-Pesa Paybill: C2B validate/confirm + STK push (PPPoE and hotspot)
    src/payments/kopokopo.js KopoKopo STK — hotspot only
    src/payments/bankstk.js  Bank STK push (Equity Jenga pattern; same interface for Co-op / KCB)
    src/payments/manual.js   Till/paybill WITHOUT API — SMS forwarder ingest + parser + fuzzy matcher
    src/payments/apply.js    The one place a confirmed payment turns into service
    src/radius.js           FreeRADIUS user upsert + CoA/disconnect via radclient
    src/mikrotik.js         RouterOS API provisioning (PPPoE server, hotspot, walled garden)
    src/jobs.js             Cron: invoicing, auto-charge, grace, suspend, reminders, watchdog, SaaS billing
    src/sms.js              Africa's Talking send + template rendering

## Payment routing rules

| Channel            | PPPoE | Hotspot | How it confirms                      |
|--------------------|-------|---------|--------------------------------------|
| M-Pesa Paybill     | yes   | yes     | Daraja C2B confirmation URL           |
| KopoKopo STK       | no    | yes     | KopoKopo webhook                      |
| Bank STK push      | yes   | yes     | Bank callback                         |
| Till / paybill, no API | yes | yes    | SMS forwarder -> parser -> matcher    |

Everything funnels into `applyPayment()`, which is idempotent on `(tenant_id, provider, provider_ref)`.

## Idempotency and money safety

* Every inbound webhook is written to `payments` first with `status='received'`, unique index on
  `(tenant_id, provider, provider_ref)`. A duplicate callback hits the unique violation and returns 200
  without double-crediting.
* Service extension happens in the same transaction as the invoice settlement.
* Funds settle to each tenant's own shortcode. The platform never holds ISP float; SaaS fees are billed
  separately (see `jobs.billTenants`).

## Multi-tenancy

Every table carries `tenant_id`. `db.forTenant(id)` returns a query helper that sets
`SET LOCAL app.tenant_id` so the row-level security policies in schema.sql apply. Tenant is resolved from
the request host (`zuri.vibelink.tech`), the NAS identifier for RADIUS traffic, or the shortcode on a webhook.

## SMS gateways

Configured per tenant in \`tenant_sms_config\`, tried in \`priority\` order with automatic failover:

| provider | credentials keys |
|---|---|
| \`hostpinnacle\` | userid, password, api_key, sender_id |
| \`africastalking\` | username, api_key, sender_id |
| \`textsms\` | api_key, partner_id, sender_id |
| \`ujumbe\` | api_key, email, sender_id |
| \`mobitech\` | api_key, sender_id |
| \`twilio\` | account_sid, auth_token, from |
| \`custom\` | url, headers, body_template |

## Hotspot preferences

\`hotspot_settings\` backs Hotspot -> Settings -> Preferences one-for-one:
\`payment_method\` (kopokopo | paybill | bankstk | till), \`voucher_expiry\` (creation | login),
\`code_type\` (numeric | mixed | words), \`code_length\` (4-12, default 6).
\`generateCode()\` in src/radius.js is the single implementation; with \`voucher_expiry='login'\`
the voucher is stored with a null \`expires_at\` and the clock starts at the first RADIUS auth
via \`POST /radius/post-auth\`.

## Support & growth modules

New tables (schema.sql): \`tariffs\` (PPPoE pricing), \`ip_pools\` (CIDR ranges bound to a router,
tagged pppoe/hotspot), \`tickets\`, \`leads\`, \`messages\` (SMS/WhatsApp/live-chat log), \`live_chats\`.
All six carry \`tenant_id\` with the same row-level-security policy as the rest of the schema — a
tenant's API token can only ever see its own rows; there is no cross-tenant query path.
Routes are in src/server.js under \`/api/tickets\`, \`/api/leads\`, \`/api/messages\`, \`/api/live-chats\`,
\`/api/tariffs\`, \`/api/ip-pools\`.

## Onboarding a MikroTik over OVPN

\`POST /api/routers/ovpn-script\` mints a per-router OVPN username/password and reserves the next
free IP in 10.50.0.0/24, returning a ready-to-paste RouterOS script. Paste it into the MikroTik's
terminal; it dials the OVPN server and appears at that NAS IP with no port-forwarding or static
public IP required. Confirm the nickname, NAS secret and API port (default 8728, editable) via
\`POST /api/routers\` to finish onboarding — this is what backs the "Add MikroTik (OVPN)" flow on
the Networks page. \`GET /api/routers\` lists everything for that tenant only (RLS-scoped).

### Live SMS balance

\`GET /api/sms/balance\` returns \`{ configured, provider, credits, checkedAt }\` for the tenant's
primary gateway, read from that provider's own balance endpoint (HostPinnacle \`readstatus\`,
Africa's Talking \`/user\`, TextSMS \`getbalance\`, UjumbeSMS, Mobitech, Twilio \`Balance.json\`, or a
custom \`balance_url\`). Results cache for 5 minutes; \`?force=1\` bypasses the cache.

If no gateway is selected, or its required secrets are missing (\`credentialsComplete()\`), the
response is \`configured:false, credits:0\` — the dashboard chip then renders \`0 · not connected\`
instead of a stale figure. A provider error also returns \`credits:0\` plus \`error\`; the balance is
never fabricated.
