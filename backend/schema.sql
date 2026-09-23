-- WiFi billing · Postgres schema
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ─────────────── platform / tenants ───────────────
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  subdomain     text unique not null,
  status        text not null default 'trial',        -- trial | active | readonly | suspended
  plan_type     text not null default 'flat',         -- flat | per_device | revshare
  plan_amount   numeric(12,2),                        -- flat monthly, or per-device rate
  revshare_pct  numeric(5,2),
  currency      char(3) not null default 'KES',
  timezone      text not null default 'Africa/Nairobi',
  kra_pin       text,
  support_phone text,
  licence_ends  date,
  created_at    timestamptz not null default now()
);

create table tenant_payment_config (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  provider      text not null,       -- daraja | kopokopo | bankstk | manual_till
  enabled_pppoe boolean not null default false,
  enabled_hotspot boolean not null default false,
  shortcode     text,                -- paybill or till
  credentials   jsonb not null default '{}'::jsonb,   -- encrypted at rest by the app
  last_callback_at timestamptz,
  unique (tenant_id, provider)
);

create table staff (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  phone      text not null,
  email      text,
  role       text not null,          -- owner | cashier | technician | support
  last_seen  timestamptz,
  unique (tenant_id, phone)
);

-- ─────────────── network ───────────────
create table routers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  site       text,
  host       inet not null,            -- NAS IP; from the OVPN tunnel when onboarded that way
  api_port   int not null default 8728, -- RouterOS API port, editable per router
  nas_identifier text not null,
  role       text not null default 'both',   -- pppoe | hotspot | both
  secret     text not null,            -- RADIUS shared secret for this NAS
  onboarding text not null default 'manual', -- manual | ovpn
  status     text not null default 'unknown',
  last_seen  timestamptz,
  unique (tenant_id, nas_identifier)
);

-- ─────────────── catalogue ───────────────
create table plans (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  service      text not null,          -- pppoe | hotspot
  title        text not null,
  price        numeric(12,2) not null,
  duration_min int not null,           -- 60, 180, 1440, 10080, 43200
  devices      int not null default 1,
  rate_down    int not null,           -- kbps
  rate_up      int not null,
  data_cap_mb  bigint,                 -- null = uncapped
  radius_profile text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────── customers ───────────────
create table subscribers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  account_code text not null,          -- what the customer types as the paybill account no.
  name         text not null,
  phone        text not null,
  service      text not null default 'pppoe',
  plan_id      uuid references plans,
  router_id    uuid references routers,
  pppoe_user   text,
  pppoe_pass   text,
  static_ip    inet,
  status       text not null default 'active',  -- active | grace | expired | suspended
  expires_at   timestamptz,
  credit       numeric(12,2) not null default 0,
  autopay      text,                   -- null | daraja | kopokopo | bankstk
  created_at   timestamptz not null default now(),
  unique (tenant_id, account_code)
);
create index if not exists subscribers_tenant_id_expires_at_idx on subscribers (tenant_id, expires_at);
create index if not exists subscribers_phone_idx on subscribers using gin (phone gin_trgm_ops);

create table vouchers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  code        text not null,
  plan_id     uuid not null references plans,
  phone       text,
  mac         macaddr,
  batch       text,
  status      text not null default 'unused',   -- unused | in_use | expired | compensated
  starts_at   timestamptz,
  expires_at  timestamptz,
  data_used_mb bigint not null default 0,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists vouchers_tenant_id_status_expires_at_idx on vouchers (tenant_id, status, expires_at);

-- A second (or third) device sharing one voucher — a TV or console added
-- from the guest's own phone once it is online. voucher.mac is the device
-- the code was bought from; this is everything added after, capped per
-- voucher at 3 (see the nearby-devices/bind route). Each row records the
-- router it was added on, because that's the only way expiry cleanup knows
-- which box to connect to and undo routeros.bindDeviceByMac on — nothing
-- else here names one.
create table if not exists voucher_devices (
  id         uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references vouchers on delete cascade,
  mac        macaddr not null,
  router_id  uuid references routers on delete set null,
  label      text,
  added_at   timestamptz not null default now(),
  unique (voucher_id, mac)
);
alter table voucher_devices add column if not exists router_id uuid references routers on delete set null;

-- Set once expireAndSuspend actually confirms the router-side unbind
-- succeeded — null means "still bound (or never confirmed)", which is what
-- lets that job's retry query stay bounded to genuinely-outstanding devices
-- instead of re-attempting a live router connection for every device ever
-- bound, forever (this row is never deleted, by design, as history).
alter table voucher_devices add column if not exists unbound_at timestamptz;

-- PPPoE MAC-lock rows written the old way — a radcheck Calling-Station-Id
-- check-item (op '=='). rlm_sql rejects its ENTIRE authorize() result on any
-- check-item mismatch, discarding everything else it loaded in that call
-- (including Cleartext-Password) before mschap/pap ever ran, so a stale or
-- legitimately-changed MAC broke authentication outright for that line, on
-- every reconnect, regardless of protocol — not a clean "wrong device"
-- rejection. The FreeRADIUS site config now checks subscribers.locked_mac
-- directly instead; these rows are dead weight that would otherwise keep
-- reproducing the exact same failure for every subscriber ever locked.
delete from radcheck where attribute = 'Calling-Station-Id';

-- ─────────────── money ───────────────
create table invoices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  subscriber_id uuid references subscribers on delete cascade,
  plan_id     uuid references plans,
  number      text not null,
  amount      numeric(12,2) not null,
  paid        numeric(12,2) not null default 0,
  due_date    date not null,
  status      text not null default 'open',    -- open | partial | paid | void
  created_at  timestamptz not null default now(),
  unique (tenant_id, number)
);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  provider      text not null,        -- daraja | kopokopo | bankstk | manual_till
  provider_ref  text not null,        -- M-Pesa code / KopoKopo id / bank ref
  amount        numeric(12,2) not null,
  payer_phone   text,
  payer_name    text,
  raw_account   text,                 -- what the customer typed
  subscriber_id uuid references subscribers,
  invoice_id    uuid references invoices,
  voucher_id    uuid references vouchers,
  status        text not null default 'received', -- received | applied | unmatched | refunded
  match_confidence numeric(4,3),
  received_at   timestamptz not null default now(),
  applied_at    timestamptz,
  payload       jsonb,
  unique (tenant_id, provider, provider_ref)
);
create index if not exists payments_tenant_id_status_received_at_idx on payments (tenant_id, status, received_at desc);

create table stk_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  provider     text not null,
  checkout_id  text not null,
  phone        text not null,
  amount       numeric(12,2) not null,
  purpose      jsonb not null,         -- {subscriber_id} or {plan_id, mac}
  status       text not null default 'pending',  -- pending | success | failed | timeout
  result_code  text,
  result_desc  text,
  attempts     int not null default 1,
  created_at   timestamptz not null default now(),
  unique (tenant_id, provider, checkout_id)
);

-- Raw M-Pesa SMS forwarded by the companion Android app (no-API till/paybill)
create table sms_inbox (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  body       text not null,
  received_at timestamptz not null default now(),
  parsed     boolean not null default false,
  payment_id uuid references payments
);

-- ─────────────── sessions / accounting ───────────────
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  service      text not null,
  subscriber_id uuid references subscribers,
  voucher_id   uuid references vouchers,
  router_id    uuid references routers,
  username     text,
  mac          macaddr,
  ip           inet,
  started_at   timestamptz not null default now(),
  stopped_at   timestamptz,
  bytes_in     bigint not null default 0,
  bytes_out    bigint not null default 0
);
create index if not exists sessions_tenant_id_stopped_at_idx on sessions (tenant_id, stopped_at) where stopped_at is null;

create table audit_log (
  id        bigserial primary key,
  tenant_id uuid not null,
  actor     text not null,      -- staff uuid, 'system', or 'webhook:<provider>'
  action    text not null,
  target    text,
  detail    jsonb,
  at        timestamptz not null default now()
);

-- ─────────────── row level security ───────────────
alter table subscribers enable row level security;
alter table vouchers    enable row level security;
alter table payments    enable row level security;
alter table invoices    enable row level security;
alter table sessions    enable row level security;
do $$ declare t text;
begin
  foreach t in array array['subscribers','vouchers','payments','invoices','sessions'] loop
    execute format($f$create policy tenant_isolation on %I
      using (tenant_id = current_setting('app.tenant_id', true)::uuid)$f$, t);
  end loop;
end $$;

-- ─────────────── hotspot settings, SMS gateways ───────────────
create table hotspot_settings (
  tenant_id        uuid primary key references tenants on delete cascade,
  ssid             text not null default 'WiFi',
  portal_path      text not null default '/portal',
  redirect_url     text,
  trial_minutes    int not null default 15,
  idle_timeout_min int not null default 10,   -- superseded by idle_timeout_sec below; kept, not written to
  bind_mac         boolean not null default true,
  -- Preferences (mirrors Hotspot -> Settings -> Preferences)
  payment_method   text not null default 'kopokopo',   -- kopokopo | paybill | bankstk | till
  voucher_expiry   text not null default 'login',      -- creation | login
  code_type        text not null default 'numeric',    -- numeric | mixed | words
  code_length      int  not null default 6,
  sms_voucher      boolean not null default true,
  auto_login       boolean not null default true,
  multi_device     boolean not null default false,
  template         text not null default 'sleek',
  banner_url       text,
  banner_headline  text,
  banner_subtext   text,
  constraint payment_method_valid check (payment_method in ('kopokopo','paybill','bankstk','till')),
  constraint code_type_valid      check (code_type in ('numeric','mixed','words')),
  constraint code_length_valid    check (code_length between 4 and 12)
);

create table tenant_sms_config (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  provider    text not null,     -- hostpinnacle | africastalking | textsms | ujumbe | mobitech | twilio | twilio_whatsapp | custom
  credentials jsonb not null default '{}'::jsonb,
  templates   jsonb not null default '{}'::jsonb,
  priority    int not null default 1,
  enabled     boolean not null default true,
  unique (tenant_id, provider)
);

create table sms_log (
  id        bigserial primary key,
  tenant_id uuid not null references tenants on delete cascade,
  provider  text not null,
  phone     text not null,
  body      text not null,
  status    text not null,
  detail    text,
  at        timestamptz not null default now()
);
create index if not exists sms_log_tenant_id_at_idx on sms_log (tenant_id, at desc);

-- KopoKopo is hotspot-only by policy; enforce it in the database too.
alter table tenant_payment_config
  add constraint kopokopo_hotspot_only
  check (provider <> 'kopokopo' or enabled_pppoe = false);

-- ─────────────── tickets, leads, messaging, live support, tariffs, IP pools ───────────────
create table tariffs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  title        text not null,
  price        numeric(12,2) not null,
  speed_down   int not null,
  speed_up     int not null,
  fair_use     text,
  active       boolean not null default true
);

create table ovpn_clients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  username     text not null,
  password     text not null,
  assigned_ip  inet not null,
  connected_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, username)
);
alter table ovpn_clients enable row level security;
create policy tenant_isolation on ovpn_clients using (tenant_id = current_setting('app.tenant_id', true)::uuid);

create table ip_pools (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  cidr       cidr not null,
  router_id  uuid references routers,
  service    text not null default 'pppoe',   -- pppoe | hotspot
  -- 'expired' pools are a distinct range for suspended/expired/paused
  -- subscribers, so the whole range can be dropped in one static firewall
  -- rule instead of chasing individual sessions into an address-list.
  purpose    text not null default 'normal' check (purpose in ('normal', 'expired')),
  unique (tenant_id, name)
);

create table tickets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  number       text not null,
  subject      text not null,
  subscriber_id uuid references subscribers,
  priority     text not null default 'medium',
  status       text not null default 'open',   -- open | in_progress | resolved
  assigned_to  uuid references staff,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table leads (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  phone      text not null,
  source     text,
  status     text not null default 'new',    -- new | contacted | won | lost
  created_at timestamptz not null default now()
);

create table messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  subscriber_id uuid references subscribers,
  direction     text not null,     -- in | out
  channel       text not null default 'sms',   -- sms | whatsapp | live_chat
  body          text not null,
  sent_at       timestamptz not null default now()
);

create table live_chats (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  visitor_ref  text not null,     -- phone or portal session id
  status       text not null default 'waiting',   -- waiting | active | closed
  staff_id     uuid references staff,
  started_at   timestamptz not null default now(),
  closed_at    timestamptz
);

alter table tariffs    enable row level security;
alter table ip_pools   enable row level security;
alter table tickets    enable row level security;
alter table leads      enable row level security;
alter table messages   enable row level security;
alter table live_chats enable row level security;
do $$ declare t text;
begin
  foreach t in array array['tariffs','ip_pools','tickets','leads','messages','live_chats'] loop
    execute format($f$create policy tenant_isolation on %I
      using (tenant_id = current_setting('app.tenant_id', true)::uuid)$f$, t);
  end loop;
end $$;

-- ─────────────── outages, SLA, knowledge base, site profiles ───────────────
-- These back the screens of the same name. Everything above this line came with
-- the original design; the tables below were added when those screens were wired up.

create table outages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  site        text not null,
  router_id   uuid references routers on delete set null,
  cause       text,
  eta         text,
  note        text,
  status      text not null default 'active',    -- active | resolved
  started_at  timestamptz not null default now(),
  resolved_at timestamptz,
  constraint outage_status_valid check (status in ('active','resolved'))
);
create index if not exists outages_tenant_id_status_started_at_idx on outages (tenant_id, status, started_at desc);

create table sla_policies (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  name         text not null,
  priority     text not null default 'high',     -- matches tickets.priority
  respond_mins int  not null default 60,
  resolve_mins int  not null default 480,
  uptime       numeric(5,2) not null default 99.5,
  unique (tenant_id, name)
);

create table kb_articles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  title      text not null,
  category   text,
  body       text not null default '',
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kb_articles_title_idx on kb_articles using gin (title gin_trgm_ops);

-- Which paybill/till the customers at a given site pay into. Only needed when a
-- tenant runs more than one shortcode.
create table site_profiles (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants on delete cascade,
  site           text not null,
  router_id      uuid references routers on delete set null,
  provider       text not null,      -- daraja | kopokopo | bankstk | manual_till
  shortcode      text not null,
  account_prefix text,
  unique (tenant_id, site)
);

-- Payouts from the collection account to the ISP's own bank.
create table settlements (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  amount     numeric(12,2) not null,
  method     text not null default 'bank',
  reference  text,
  status     text not null default 'pending',   -- pending | paid | failed
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Free-form per-tenant config that does not deserve its own column yet
-- (SMTP credentials, billing preferences).
create table app_settings (
  tenant_id uuid primary key references tenants on delete cascade,
  smtp      jsonb not null default '{}'::jsonb,
  prefs     jsonb not null default '{}'::jsonb
);

-- ─────────────── fair use policy ───────────────
-- The design carried fair-use as a free-text column on tariffs. These are the
-- enforceable version: a cap, a window, and what to throttle to once it is hit.
create table if not exists fup_policies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  name          text not null,
  applies_to    text not null default 'all',      -- all | plan
  plan_id       uuid references plans on delete cascade,
  data_cap_gb   numeric(10,2) not null,
  window_period text not null default 'monthly',  -- daily | weekly | monthly
  throttle_down int  not null,                    -- kbps once the cap is hit
  throttle_up   int  not null,
  notify_at_pct int  not null default 80,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, name),
  constraint fup_window_valid check (window_period in ('daily','weekly','monthly')),
  constraint fup_scope_valid  check (applies_to in ('all','plan')),
  constraint fup_notify_valid check (notify_at_pct between 1 and 100)
);

-- What the enforcer has already done to a subscriber in the current window, so a
-- job running every quarter hour does not re-throttle or re-SMS the same person.
-- One row per subscriber per window; the previous window's row is the audit trail.
create table if not exists fup_state (
  tenant_id     uuid not null references tenants on delete cascade,
  subscriber_id uuid not null references subscribers on delete cascade,
  policy_id     uuid references fup_policies on delete set null,
  window_start  date not null,
  used_mb       bigint  not null default 0,
  warned        boolean not null default false,
  throttled     boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (subscriber_id, window_start)
);
create index if not exists fup_state_tenant on fup_state (tenant_id, window_start);

-- ─────────────── SLA and ticket detail ───────────────
alter table sla_policies add column if not exists business_hours text;
alter table sla_policies add column if not exists escalate_to    uuid references staff on delete set null;
alter table sla_policies add column if not exists enabled        boolean not null default true;

alter table tickets add column if not exists description text;
alter table tickets add column if not exists due_at      timestamptz;
-- sla_policies (below) has existed as long as tickets has, with its own
-- respond_mins/resolve_mins/escalate_to fully editable from Settings — but
-- nothing ever connected a real ticket to one. due_at above stayed null
-- until an operator typed a date in by hand, "SLA management" configured
-- rules that governed nothing, and stats.breaching on the Tickets screen
-- only ever counted open high/critical tickets, not an actual breach.
alter table tickets add column if not exists sla_policy_id uuid references sla_policies on delete set null;
-- Set once a breach is actually acted on (see checkSlaBreaches in jobs.js),
-- so the escalation fires exactly once per ticket rather than every five
-- minutes for as long as it stays open past its deadline.
alter table tickets add column if not exists sla_breach_notified boolean not null default false;

create table if not exists ticket_notes (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  ticket_id uuid not null references tickets on delete cascade,
  author    text,
  body      text not null,
  internal  boolean not null default true,
  at        timestamptz not null default now()
);
create index if not exists ticket_notes_ticket on ticket_notes (ticket_id, at);

-- ─────────────── several paybills per provider ───────────────
-- The original unique (tenant_id, provider) allowed exactly one shortcode per
-- channel. ISPs commonly run more than one paybill, so the key now includes the
-- shortcode and a single row per provider is flagged as the default.
alter table tenant_payment_config add column if not exists label      text;
alter table tenant_payment_config add column if not exists is_default boolean not null default false;
alter table tenant_payment_config drop constraint if exists tenant_payment_config_tenant_id_provider_key;
create unique index if not exists tpc_tenant_provider_shortcode
  on tenant_payment_config (tenant_id, provider, coalesce(shortcode, ''));
create unique index if not exists tpc_one_default_per_provider
  on tenant_payment_config (tenant_id, provider) where is_default;

-- ─────────────── automation switches ───────────────
-- One row per tenant per cron job. Absent means enabled, so existing tenants keep
-- their current behaviour until someone turns something off.
create table if not exists automation_jobs (
  tenant_id  uuid not null references tenants on delete cascade,
  job        text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, job)
);

-- ─────────────── FreeRADIUS auth tables ───────────────
-- src/radius.js writes check/reply attributes here on every activation and
-- voucher issue, but the original schema never created them — applying a payment
-- failed with "relation radcheck does not exist". These match the layout
-- FreeRADIUS's rlm_sql expects; point FreeRADIUS at this same database.
create table if not exists radcheck (
  id        serial primary key,
  username  text        not null,
  attribute text        not null,
  op        varchar(2)  not null default ':=',
  value     text        not null,
  unique (username, attribute)
);
create index if not exists radcheck_username on radcheck (username);

create table if not exists radreply (
  id        serial primary key,
  username  text        not null,
  attribute text        not null,
  op        varchar(2)  not null default ':=',
  value     text        not null,
  unique (username, attribute)
);
create index if not exists radreply_username on radreply (username);

/*
 * tenant_id belongs with the tables, not 500 lines further down.
 *
 * These columns were added late in the file, next to the backfill that
 * explains them — which is fine for a database that already exists, and
 * impossible for one that does not: statements above that point insert into
 * radreply (tenant_id, ...), so applying this schema to an empty database
 * failed with "column tenant_id of relation radreply does not exist". Every
 * install since has worked only because the column was already there.
 *
 * The reasoning is unchanged and still recorded with the backfill below: the
 * lookup would otherwise be by username alone across every tenant, and two
 * ISPs numbering their customers from 10001 would share credentials.
 */
alter table radcheck add column if not exists tenant_id uuid references tenants on delete cascade;
alter table radreply add column if not exists tenant_id uuid references tenants on delete cascade;

-- A username is only unique within a tenant now, not across the platform.
alter table radcheck drop constraint if exists radcheck_username_attribute_key;
alter table radreply drop constraint if exists radreply_username_attribute_key;
create unique index if not exists radcheck_tenant_user_attr
  on radcheck (tenant_id, username, attribute);
create unique index if not exists radreply_tenant_user_attr
  on radreply (tenant_id, username, attribute);

-- ─────────────── FreeRADIUS accounting and clients ───────────────
-- rlm_sql writes sessions here. The app's own `sessions` table is kept in step by
-- the trigger below, so fair-use usage counts real traffic.
create table if not exists radacct (
  radacctid           bigserial primary key,
  acctsessionid       text not null,
  acctuniqueid        text not null unique,
  username            text,
  realm               text,
  nasipaddress        inet not null,
  nasportid           text,
  nasporttype         text,
  acctstarttime       timestamptz,
  acctupdatetime      timestamptz,
  acctstoptime        timestamptz,
  acctinterval        bigint,
  acctsessiontime     bigint,
  acctauthentic       text,
  connectinfo_start   text,
  connectinfo_stop    text,
  acctinputoctets     bigint,
  acctoutputoctets    bigint,
  calledstationid     text,
  callingstationid    text,
  acctterminatecause  text,
  servicetype         text,
  framedprotocol      text,
  framedipaddress     inet,
  framedipv6address   inet,
  framedipv6prefix    inet,
  framedinterfaceid   text,
  delegatedipv6prefix inet
);
create index if not exists radacct_active_session on radacct (acctuniqueid) where acctstoptime is null;
create index if not exists radacct_start_user on radacct (acctstarttime, username);

-- FreeRADIUS reads its NAS list from here. A view over `routers` means adding a
-- router in the UI authorises it immediately — no config file, no restart.
create or replace view nas as
  select
    ('x' || substr(md5(r.id::text), 1, 8))::bit(32)::int as id,
    host(r.host)        as nasname,
    r.name              as shortname,
    'mikrotik'          as type,
    0                   as ports,
    r.secret            as secret,
    ''                  as server,
    ''                  as community,
    r.nas_identifier    as description
  from routers r;

-- Data moved through a tenant's routers, in 5-minute buckets, added up from the
-- growth of each accounting session (see sync_session_from_radacct). A session's
-- counters only ever say "so far, in total", so "the last 24 hours" cannot be read
-- off them — the growth has to be recorded as it happens.
create table if not exists usage_buckets (
  tenant_id uuid not null references tenants on delete cascade,
  bucket    timestamptz not null,
  bytes_in  bigint not null default 0,
  bytes_out bigint not null default 0,
  primary key (tenant_id, bucket)
);
-- Of which hotspot (a session that is not PPP), so the two can be told apart.
alter table usage_buckets add column if not exists hotspot_bytes bigint not null default 0;
-- Voucher and PPPoE usage is read by username.
create index if not exists radacct_username on radacct (username);

/**
 * Mirror accounting into the app's `sessions` table.
 * FUP enforcement sums sessions.bytes_in/out; without this it would always read
 * zero no matter how much traffic flowed.
 */
create or replace function sync_session_from_radacct() returns trigger as $$
declare
  v_tenant uuid;
  v_sub    uuid;
  v_router uuid;
  v_in     bigint;
  v_out    bigint;
begin
  select id, tenant_id into v_router, v_tenant from routers where host = new.nasipaddress limit 1;
  if v_tenant is null then return new; end if;

  -- Record how much this update added. Never allowed to break accounting itself.
  begin
    if tg_op = 'UPDATE' then
      v_in  := greatest(coalesce(new.acctinputoctets, 0)  - coalesce(old.acctinputoctets, 0), 0);
      v_out := greatest(coalesce(new.acctoutputoctets, 0) - coalesce(old.acctoutputoctets, 0), 0);
    else
      v_in  := coalesce(new.acctinputoctets, 0);
      v_out := coalesce(new.acctoutputoctets, 0);
    end if;
    if v_in > 0 or v_out > 0 then
      insert into usage_buckets (tenant_id, bucket, bytes_in, bytes_out, hotspot_bytes)
      values (v_tenant,
              date_trunc('hour', now()) + (floor(extract(minute from now()) / 5)::int * 5) * interval '1 minute',
              v_in, v_out,
              case when coalesce(new.framedprotocol, '') = 'PPP' then 0 else v_in + v_out end)
      on conflict (tenant_id, bucket) do update
        set bytes_in      = usage_buckets.bytes_in  + excluded.bytes_in,
            bytes_out     = usage_buckets.bytes_out + excluded.bytes_out,
            hotspot_bytes = usage_buckets.hotspot_bytes + excluded.hotspot_bytes;
    end if;
  exception when others then
    null;
  end;

  select id into v_sub from subscribers
   where tenant_id = v_tenant and pppoe_user = new.username limit 1;

  insert into sessions (tenant_id, service, subscriber_id, router_id, username,
                        ip, started_at, stopped_at, bytes_in, bytes_out, radius_unique_id)
  values (v_tenant, 'pppoe', v_sub, v_router, new.username,
          new.framedipaddress, coalesce(new.acctstarttime, now()), new.acctstoptime,
          coalesce(new.acctinputoctets, 0), coalesce(new.acctoutputoctets, 0),
          new.acctuniqueid)
  on conflict (radius_unique_id) do update
    set stopped_at = excluded.stopped_at,
        bytes_in   = excluded.bytes_in,
        bytes_out  = excluded.bytes_out;
  return new;
end;
$$ language plpgsql;

-- Correlation key so the interim-updates FreeRADIUS sends every few minutes
-- update one row instead of piling up duplicates.
alter table sessions add column if not exists radius_unique_id text;
-- Deliberately NOT a partial index: ON CONFLICT cannot infer a partial one
-- without repeating its predicate, and Postgres already treats NULLs as distinct,
-- so pre-existing rows with no RADIUS id coexist fine.
drop index if exists sessions_radius_unique;
create unique index if not exists sessions_radius_unique on sessions (radius_unique_id);

drop trigger if exists radacct_to_sessions on radacct;
create trigger radacct_to_sessions after insert or update on radacct
  for each row execute function sync_session_from_radacct();

-- ─────────────── OVPN credentials ───────────────
-- The tunnel password is shown once in the generated MikroTik script and stored
-- only as a pgcrypto hash, the same way the WireGuard private key is handled. A
-- database dump should not hand someone every router's tunnel password.
alter table ovpn_clients add column if not exists password_hash text;
alter table ovpn_clients alter column password drop not null;

-- 'staff' peers are a tenant's own laptop, not a router — issued so an
-- operator can Winbox into their own MikroTik over the same tunnel their
-- routers already use. auth.sh and client-connect.sh don't care about the
-- distinction (any row here authenticates and gets its assigned_ip pinned
-- the same way); it exists so client-connect.sh knows to punch this peer's
-- laptop a narrow firewall hole to its own tenant's routers — see
-- infra/openvpn/entrypoint.sh's VIBELINK_TUNNEL_ISOLATION chain — and so a
-- router peer, which needs none, doesn't get one by mistake.
alter table ovpn_clients add column if not exists kind text not null default 'router';
alter table ovpn_clients drop constraint if exists ovpn_clients_kind_check;
alter table ovpn_clients add constraint ovpn_clients_kind_check check (kind in ('router', 'staff'));
alter table ovpn_clients add column if not exists staff_id uuid references staff on delete cascade;

-- ─────────────── the rest of the standard FreeRADIUS schema ───────────────
-- The app only ever writes radcheck and radreply, so these looked unnecessary.
-- They are not: the stock queries.conf reads the group tables on every single
-- authorisation, and a missing table makes the whole sql module return `fail`,
-- which rejects the user. Every login failed with "relation radusergroup does
-- not exist" buried in the FreeRADIUS log while radcheck matched perfectly.
create table if not exists radusergroup (
  id        serial primary key,
  username  text not null default '',
  groupname text not null default '',
  priority  int  not null default 0
);
create index if not exists radusergroup_username on radusergroup (username);

create table if not exists radgroupcheck (
  id        serial primary key,
  groupname text not null default '',
  attribute text not null default '',
  op        varchar(2) not null default '==',
  value     text not null default ''
);
create index if not exists radgroupcheck_groupname on radgroupcheck (groupname);

create table if not exists radgroupreply (
  id        serial primary key,
  groupname text not null default '',
  attribute text not null default '',
  op        varchar(2) not null default '=',
  value     text not null default ''
);
create index if not exists radgroupreply_groupname on radgroupreply (groupname);

-- Written by the post-auth section on every accept and reject.
create table if not exists radpostauth (
  id       bigserial primary key,
  username text not null default '',
  pass     text,
  reply    text,
  authdate timestamptz not null default now()
);
create index if not exists radpostauth_username on radpostauth (username, authdate desc);

-- ─────────────── one router per address ───────────────
-- Two rows sharing a NAS address cannot both be right, and the consequences are
-- ugly rather than obvious: FreeRADIUS looks a router up by source address, and
-- with duplicates it could take the name from one row and the secret from
-- another — reporting "invalid Message-Authenticator" for ever while both the
-- router and the database looked correct.
--
-- Nothing enforced this before, and re-onboarding after a failed delete left
-- exactly that. Globally unique, not per tenant: each tenant owns a distinct /24
-- out of the tunnel supernet, so an address collision across tenants is already
-- a fault, and RADIUS resolves clients by address alone with no tenant in hand.
create unique index if not exists routers_host_unique on routers (host);

-- ─────────────── customer portal sessions ───────────────
-- Separate from admin_sessions on purpose. A customer signing in must never end
-- up holding something the admin app would accept: same table, one bug, and a
-- subscriber is reading their operator's books. Different table, different
-- cookie, and the portal routes only ever read this one.
create table if not exists portal_sessions (
  token         text primary key,
  subscriber_id uuid not null references subscribers on delete cascade,
  tenant_id     uuid not null references tenants on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index if not exists portal_sessions_expiry on portal_sessions (expires_at);

-- ─────────────── deleting a router ───────────────
-- Three tables referenced routers with no delete behaviour, so removing one
-- failed on a raw foreign-key error. The screen removed the row optimistically
-- and the server refused, so the router came back on the next reload — deleted
-- as far as the operator could tell, and still there.
--
-- sessions is accounting history and must survive the router it was recorded on;
-- ip_pools is an address range the operator may reassign. Both are detached
-- rather than deleted. subscribers is deliberately left blocking: the route
-- checks it first and explains, because silently unlinking customers would stop
-- enforcement for them without saying so.
alter table sessions  drop constraint if exists sessions_router_id_fkey;
alter table sessions  add  constraint sessions_router_id_fkey
  foreign key (router_id) references routers on delete set null;

alter table ip_pools  drop constraint if exists ip_pools_router_id_fkey;
alter table ip_pools  add  constraint ip_pools_router_id_fkey
  foreign key (router_id) references routers on delete set null;

-- ─────────────── pause vs suspend, and a second number ───────────────
-- "Pause" wrote status='suspended', so the two were the same thing wearing
-- different labels and an operator could not tell a customer they had stopped on
-- purpose from one the system cut off for not paying. They are separate now:
--
--   paused     an admin stopped the service deliberately. Automation leaves it
--              alone — nothing re-enables it, and the nightly sweep will not
--              "expire" someone who is already off by choice.
--   suspended  the system blocked them, normally for non-payment. A payment
--              clears it.
--
-- Both are admin actions. Neither is ever offered to the customer.
alter table subscribers drop constraint if exists subscribers_status_check;
alter table subscribers add constraint subscribers_status_check
  check (status in ('active','grace','expired','paused','suspended'));

-- Households share a connection but not a handset: the person who pays is often
-- not the person who notices it is down. Both numbers get every notification.
alter table subscribers add column if not exists phone_alt text;

-- The MAC a PPPoE line first successfully dialled from. Once set, FreeRADIUS
-- itself refuses the login from anywhere else — see radius.lockPppoeMac —
-- so a shared password stops being usable from a different router, a
-- reseller, or after the customer's own CPE is swapped without telling
-- anyone. Null means not yet locked (a fresh line, or one an admin cleared
-- to let a new router dial in after an equipment change).
alter table subscribers add column if not exists locked_mac macaddr;

-- When a pause started. A pause froze the status but not the clock: expires_at
-- kept counting down underneath it, so a customer paused for a week came back
-- to find their remaining days had quietly burned away regardless. On resume,
-- the elapsed pause is added back onto expires_at so paused time is never
-- billed; null the rest of the time.
alter table subscribers add column if not exists paused_at timestamptz;

-- ip_pools created before the 'expired' purpose existed are all 'normal' —
-- there is nothing to reinterpret, an operator has to actually set one of
-- these ranges aside for suspended/expired/paused subscribers.
alter table ip_pools add column if not exists purpose text not null default 'normal';
alter table ip_pools drop constraint if exists ip_pools_purpose_check;
alter table ip_pools add constraint ip_pools_purpose_check check (purpose in ('normal', 'expired'));

-- Every router now gets its own expired-customers pool the moment it's
-- created — an operator forgetting to set one up was the actual cause of
-- "0kb" quietly downgrading to a rate-limit-only fallback. Locked so it
-- can't be deleted out from under that router by mistake; the delete route
-- refuses while it's still attached to one. Detached automatically (see the
-- existing ip_pools_router_id_fkey ON DELETE SET NULL) if the router itself
-- is removed, at which point it is just an ordinary unlocked pool.
alter table ip_pools add column if not exists locked boolean not null default false;

-- What a customer signs in to the portal with. Hashed like a staff password —
-- the plaintext is shown once when it is generated and never stored, so a
-- database dump does not hand someone every customer's account.
alter table subscribers add column if not exists portal_password_hash text;

-- The same password again, encrypted rather than hashed, so support can read it
-- back to a customer who has lost it instead of resetting and re-texting.
--
-- This is deliberately weaker than the hash beside it and the reason is worth
-- stating: a hash cannot be shown to anybody, which meant every forgotten portal
-- password became a reset. Encrypting instead keeps a database dump useless on
-- its own -- the key lives in APP_SECRET_KEY, outside the database -- but anyone
-- holding both the dump and the key can read every customer's portal password.
-- The hash stays authoritative for sign-in; this column is only ever read to
-- display. pppoe_pass has always been stored in clear, so this is not the
-- weakest link, but it is a real one.
alter table subscribers add column if not exists portal_password_enc text;

-- Where invoices and notices go when the tenant has an email gateway. Optional:
-- most residential customers in this market are reachable by SMS and nothing
-- else, so nothing may depend on this being present.
alter table subscribers add column if not exists email text;

-- Mikrotik-Group named a PPP profile that has to exist on the router, and
-- plans.radius_profile holds labels generated here ("pppoe-Home 10 Mbps") that
-- exist nowhere else. The router accepted each login, could not find the
-- profile, and dropped the session at once: a clean "Login OK" in the log every
-- thirty seconds while nobody could get online. Drop the attribute; the pushed
-- PPPoE server's default-profile supplies addressing and the speed comes from
-- Mikrotik-Rate-Limit.
delete from radreply where attribute = 'Mikrotik-Group';

-- ─────────────── the address pool a router hands out ───────────────
-- Recorded when the PPPoE server is configured, so RADIUS can tell whether a
-- subscriber's static IP is one this router can actually give out.
--
-- Sending Framed-IP-Address for an address outside the pool is not ignored: the
-- router assigns it, finds it collides with one of its own interfaces, and
-- terminates the session about a second after authenticating. The log reads
-- "logged in, 192.168.0.110" then "terminating..." — an authentication that
-- succeeds followed by a disconnect, which is nothing like a credentials
-- problem and gets diagnosed as one.
alter table routers add column if not exists pppoe_pool text;

-- Clear every Framed-IP-Address written before the pool check existed.
--
-- Refusing to write a bad one does nothing about the ones already stored, and
-- those are what the router reads at the next login: a subscriber carrying
-- 192.168.0.110 keeps being handed it, keeps colliding with the router's own
-- LAN, and keeps being disconnected a second after authenticating. The upgrade
-- has to remove them, not merely stop adding more.
--
-- Deleting all of them rather than only the ones out of range: working out
-- which are valid needs the router's pool, which is recorded on the next
-- Configure, and a subscriber briefly on a pool address is online while one on
-- a colliding address is not. scripts/sync-radius.mjs --apply writes back the
-- ones that are genuinely in range.
delete from radreply where attribute = 'Framed-IP-Address';

-- Point existing vouchers at the hotspot profile the router push creates.
--
-- The profile carries the shared-users limit that stops one code being used on
-- a whole building, and nothing selected it — so every voucher issued so far
-- ran on the router's own "default" profile and the limit never applied.
insert into radreply (tenant_id, username, attribute, op, value)
select v.tenant_id, v.code, 'Mikrotik-Group', ':=', 'hs-default'
  from vouchers v
 where v.status <> 'expired'
   and exists (select 1 from radcheck rc
                where rc.username = v.code and rc.tenant_id = v.tenant_id)
on conflict (tenant_id, username, attribute) do nothing;

-- ─────────────── what automation actually did ───────────────
-- Automation and the dashboard both showed "0" for work done in the last 24
-- hours, hardcoded, because nothing recorded a run. A number presented as data
-- and always zero is worse than no number: it tells an operator the system is
-- idle when it has been working all night.
create table if not exists job_runs (
  id         bigserial primary key,
  job        text not null,
  ok         boolean not null,
  error      text,
  ms         int,
  ran_at     timestamptz not null default now()
);
create index if not exists job_runs_recent on job_runs (ran_at desc);

-- Where router alerts go.
--
-- The watchdog texts whoever is recorded as the owner in staff, which is not
-- necessarily the person on call at 2am. A number set here takes precedence.
alter table app_settings add column if not exists alert_phone text;

-- One person, several lines.
--
-- A household or a business commonly takes a second connection, and the phone
-- number is how M-Pesa payments are matched — so the number has to be allowed
-- to repeat while still catching the far more common case of an operator
-- creating the same customer twice by accident. Unique on (tenant, phone,
-- account) rather than (tenant, phone): a second line needs its own account
-- number anyway, and that is what the customer types when paying.
-- Superseded by (tenant_id, account_code, line_label) below. Keeping it would
-- block the very thing several lines on one account is for: the same person,
-- the same number, the same account, two connections.
drop index if exists subscribers_phone_account;

-- Starter knowledge base.
--
-- A support team with an empty knowledge base writes the same four answers
-- every week by hand. These are the questions every WISP in this market
-- actually gets, seeded per tenant so they can be edited rather than written
-- from nothing. Only added where a tenant has none, so an operator's own
-- articles are never overwritten.
insert into kb_articles (tenant_id, title, category, body, published)
select t.id, a.title, a.category, a.body, true
  from tenants t
  cross join (values
    ('My internet is slow',
     'Connection',
     E'Restart the router first: unplug it, wait ten seconds, plug it back in. It fixes most slowdowns.

'
     'If it is still slow, check how many devices are connected — a package shared across a full house behaves like a slower one.

'
     'If you have passed your fair-use allowance for the month your speed is reduced until the allowance resets. Your remaining allowance is on your customer portal.

'
     'Still slow after that? Send us your account number and roughly when it started, and we will check the tower.'),
    ('I have paid but I am still disconnected',
     'Payments',
     E'Payments usually reconnect the line within a minute or two.

'
     'If it has been longer, check the M-Pesa message: the account number you typed has to match your account number exactly. A payment sent with the wrong account cannot match itself to you automatically.

'
     'Send us the M-Pesa confirmation code and we will apply it by hand. Nothing is lost — a payment that did not match is held, not returned.'),
    ('How do I pay',
     'Payments',
     E'Pay by M-Pesa to the paybill on your invoice, using your account number as the account.

'
     'The account number is the important part: it is how the payment finds you. It is on your invoice, in your welcome SMS, and on your customer portal.

'
     'You can also pay from the portal, which sends the M-Pesa prompt to your phone so there is nothing to type.'),
    ('WiFi is connected but there is no internet',
     'Connection',
     E'This usually means the line is up to the router but not past it.

'
     'Check whether other devices in the house have the same problem. If only one device is affected, forget the network on that device and join it again.

'
     'If every device is affected, restart the router. If that does not fix it, your account may have expired — check the portal.'),
    ('Using a hotspot voucher',
     'Hotspot',
     E'Connect to the WiFi and a login page opens by itself. If it does not, open a browser and go to any http page.

'
     'Type the code from your voucher and press Connect. There is no username — the code is all you need.

'
     'Your device is remembered for the life of the bundle, so switching WiFi off and on will reconnect you without typing it again.')
  ) as a(title, category, body)
 where not exists (select 1 from kb_articles k where k.tenant_id = t.id);

-- ─────────────── several lines on one account ───────────────
-- A customer with two connections — a house and a shop, a landlord with three
-- flats — is one person paying one account number, not three strangers who
-- happen to share a phone.
--
-- Rather than a parent table, which every query and every payment path would
-- have to learn, a line is still a subscriber row and the account number is
-- what ties them together. The tag says which one it is, so an operator sending
-- a technician knows whether it is the shop or the house.
alter table subscribers add column if not exists line_label text;

-- account_code stops being unique on its own and becomes unique per line.
-- Without this a second line cannot be created at all; with it, two lines on
-- one account must still be told apart by their tag.
alter table subscribers drop constraint if exists subscribers_tenant_id_account_code_key;
create unique index if not exists subscribers_account_line
  on subscribers (tenant_id, account_code, coalesce(line_label, ''));

-- The PPPoE username has to stay unique regardless: it is what the router
-- authenticates, and two lines answering to one name is a collision, not a
-- feature.
create unique index if not exists subscribers_pppoe_user_unique
  on subscribers (tenant_id, pppoe_user) where pppoe_user is not null;

-- A tunnel username must be unique across the platform, not per tenant.
--
-- OpenVPN knows only the username when a router connects, and client-connect.sh
-- resolves the address from it with no tenant to scope by. With names unique
-- only per tenant, two tenants both had "router-2" and a router could be pinned
-- to another tenant's address — which is how the address on the router stopped
-- matching the one on screen.
create unique index if not exists ovpn_clients_username_unique on ovpn_clients (username);

-- Tunnel logins that were turned away.
--
-- A revoked credential does not stop the router using it: RouterOS retries
-- every few seconds for ever, the log fills with AUTH_FAILED, and nothing in
-- the product says why — the router simply reads as down. Recording the
-- attempt lets the Routers page say "a router is dialling in with a credential
-- that no longer exists", which is a sentence an operator can act on.
create table if not exists ovpn_auth_failures (
  id       bigserial primary key,
  username text not null,
  at       timestamptz not null default now()
);
create index if not exists ovpn_auth_failures_recent on ovpn_auth_failures (at desc);

-- ─────────────── live chat ───────────────
-- live_chats recorded that a conversation existed and never held a word of it.
-- Support could see somebody waiting and had nothing to read or reply with.
create table if not exists chat_messages (
  id         bigserial primary key,
  tenant_id  uuid not null references tenants on delete cascade,
  chat_id    uuid not null references live_chats on delete cascade,
  sender     text not null,                    -- visitor | staff
  body       text not null,
  staff_id   uuid references staff,
  created_at timestamptz not null default now(),
  constraint chat_sender_valid check (sender in ('visitor', 'staff'))
);
create index if not exists chat_messages_chat on chat_messages (chat_id, id);

-- A visitor has no account and no session — a hotspot guest has not even paid
-- yet. The token is what proves this browser started this conversation, so one
-- guest cannot read another's by guessing an id.
alter table live_chats add column if not exists token text;
alter table live_chats add column if not exists display_name text;
alter table live_chats add column if not exists last_visitor_at timestamptz;
create index if not exists live_chats_token on live_chats (token);

-- ─────────────── router downtime ───────────────
-- When a router first stopped answering, and whether anyone has been told.
--
-- The watchdog has always written status='up'/'down' and has never notified
-- anybody, despite the comment above it promising exactly that. Status alone
-- cannot support a notification: without knowing when it went down there is no
-- way to wait out a brief blip, and without knowing whether a message was sent
-- a minutely job would text the owner sixty times an hour.
alter table routers add column if not exists offline_since timestamptz;
alter table routers add column if not exists offline_notified boolean not null default false;

-- ─────────────── where the customer is ───────────────
-- Add client has collected a location and coordinates since it was built and
-- had nowhere to put them. A technician sent to a fault needs the house, not
-- the account number, and the nearest tower is a coverage question nobody can
-- answer from a list of names.
--
-- Plain numerics rather than PostGIS: this is for showing pins and reading out
-- directions, not for spatial queries, and PostGIS is a heavy dependency to add
-- to every deployment for a decimal pair.
alter table subscribers add column if not exists location text;
alter table subscribers add column if not exists lat numeric(9,6);
alter table subscribers add column if not exists lng numeric(9,6);

-- Towers have a place too, so coverage can be seen rather than remembered.
alter table routers add column if not exists lat numeric(9,6);
alter table routers add column if not exists lng numeric(9,6);

-- ─────────────── deleting a customer ───────────────
-- Four tables referenced subscribers with no delete rule, so a customer who had
-- ever paid, raised a ticket, been texted or held a session could not be
-- deleted at all: the delete failed on a foreign key and the UI reported
-- success, because the route did not check.
--
-- These detach rather than cascade. A payment is a financial record and a
-- ticket is a support record; both must outlive the customer row, and deleting
-- someone's account should not erase the money they paid. Losing the link is
-- acceptable, losing the row is not.
alter table payments drop constraint if exists payments_subscriber_id_fkey;
alter table payments add constraint payments_subscriber_id_fkey
  foreign key (subscriber_id) references subscribers on delete set null;

alter table tickets drop constraint if exists tickets_subscriber_id_fkey;
alter table tickets add constraint tickets_subscriber_id_fkey
  foreign key (subscriber_id) references subscribers on delete set null;

alter table messages drop constraint if exists messages_subscriber_id_fkey;
alter table messages add constraint messages_subscriber_id_fkey
  foreign key (subscriber_id) references subscribers on delete set null;

alter table sessions drop constraint if exists sessions_subscriber_id_fkey;
alter table sessions add constraint sessions_subscriber_id_fkey
  foreign key (subscriber_id) references subscribers on delete set null;

-- Same problem, same fix, for vouchers: payments.voucher_id and
-- sessions.voucher_id had no delete rule either, so deleting a voucher —
-- "Purge expired" on the Vouchers screen, or the automatic purge job —
-- failed outright on any voucher that had ever actually been paid for,
-- which in practice is nearly all of them. "Could not purge: update or
-- delete on table 'vouchers' violates foreign key constraint
-- 'payments_voucher_id_fkey'" is what that looks like on screen. Same
-- reasoning as above: a payment is a financial record and must outlive the
-- voucher it paid for, so this detaches rather than cascades.
alter table payments drop constraint if exists payments_voucher_id_fkey;
alter table payments add constraint payments_voucher_id_fkey
  foreign key (voucher_id) references vouchers on delete set null;

-- Which service a payment was actually for, set once at apply time and never
-- touched again — unlike inferring it from voucher_id/subscriber_id being
-- non-null, which used to silently reclassify a payment as "other" the
-- moment its voucher got auto-purged (nightly, 24h after expiry — the
-- default for every tenant, see jobs.js's purgeExpiredVouchers) or its
-- subscriber got deleted, both of which detach rather than cascade
-- specifically so the payment record itself survives (see the comments just
-- above). The record survived; every report that inferred its kind from
-- those two columns did not — real hotspot and PPPoE revenue history was
-- quietly draining into "other" within a day or two of being earned.
alter table payments add column if not exists service text check (service in ('pppoe', 'hotspot'));
update payments set service = case when voucher_id is not null then 'hotspot'
                                    when subscriber_id is not null then 'pppoe' end
 where service is null;

alter table sessions drop constraint if exists sessions_voucher_id_fkey;
alter table sessions add constraint sessions_voucher_id_fkey
  foreign key (voucher_id) references vouchers on delete set null;

-- ─────────────── RADIUS tenant scoping ───────────────
-- Which tenant a RADIUS credential belongs to.
--
-- Without this the lookup is by username alone, across every tenant on the
-- platform. Two tenants that both number their customers from 10001 would share
-- credentials, and one tenant's customer could dial in on another tenant's
-- router. The account numbers are five digits precisely so people can read them
-- over the phone, so collisions are not a remote possibility -- they are the
-- expected case once there is more than one ISP here.
--
-- Scoping by tenant rather than by router is also what makes roaming work: a
-- customer who moves from one of their ISP's towers to another authenticates
-- normally, while a customer of a different ISP never does.
-- The columns themselves are added with the tables, several hundred lines
-- above, because statements between here and there already write to them.
create index if not exists radcheck_tenant_user on radcheck (tenant_id, username);
create index if not exists radreply_tenant_user on radreply (tenant_id, username);

-- Backfill from the subscriber that owns each username, so an existing install
-- keeps working when the scoped query below goes live. Vouchers are matched the
-- same way. Anything still unattributed is left null and reported by
-- scripts/sync-radius.mjs rather than being guessed at.
update radcheck rc set tenant_id = s.tenant_id
  from subscribers s where s.pppoe_user = rc.username and rc.tenant_id is null;
update radreply rr set tenant_id = s.tenant_id
  from subscribers s where s.pppoe_user = rr.username and rr.tenant_id is null;
update radcheck rc set tenant_id = v.tenant_id
  from vouchers v where v.code = rc.username and rc.tenant_id is null;
update radreply rr set tenant_id = v.tenant_id
  from vouchers v where v.code = rr.username and rr.tenant_id is null;

-- The uniqueness rule moved up with the columns: statements above depend on
-- it, since they upsert on (tenant_id, username, attribute).

-- ─────────────── tenant billing reference ───────────────
-- A short, stable, human-readable handle for each tenant, for reconciling
-- against WHMCS. The uuid is the key everywhere internally, but nobody reads a
-- uuid down the phone or types one into an invoice line.
create sequence if not exists tenant_ref_seq start 1001;
alter table tenants add column if not exists billing_ref text unique;
update tenants set billing_ref = 'VL-' || nextval('tenant_ref_seq') where billing_ref is null;

-- A default, not only a backfill. Without this every tenant created after the
-- migration had no billing reference at all, which is precisely the ones being
-- invoiced from now on.
alter table tenants alter column billing_ref set default ('VL-' || nextval('tenant_ref_seq'));

-- ─────────────── email gateway ───────────────
-- SMTP per tenant, shaped like tenant_sms_config so both are managed the same
-- way. The password inside credentials is encrypted with APP_SECRET_KEY before
-- it is written, exactly as gateway credentials are -- an SMTP password is often
-- the tenant's real mailbox password, so a database dump must not hand it over.
create table if not exists tenant_email_config (
  tenant_id   uuid primary key references tenants on delete cascade,
  host        text not null,
  port        int  not null default 587,
  secure      boolean not null default false,   -- true for 465, false for 587 STARTTLS
  username    text,
  password_enc text,
  from_name   text,
  from_email  text not null,
  enabled     boolean not null default true,
  last_error  text,
  last_sent_at timestamptz
);

create table if not exists email_log (
  id        bigserial primary key,
  tenant_id uuid not null references tenants on delete cascade,
  to_email  text not null,
  subject   text,
  status    text not null,          -- sent | failed
  error     text,
  created_at timestamptz not null default now()
);
create index if not exists email_log_tenant_idx on email_log (tenant_id, created_at desc);

-- ─────────────── hotspot walled garden ───────────────
-- What a guest can reach before they have paid. The only thing a guest's
-- browser actually needs pre-auth is this tenant's own portal — the login
-- page, its status polling, and the STK-push prompt. M-Pesa itself needs
-- nothing here: Daraja is called from our backend, and the approval happens
-- over the phone's own SIM/USSD channel, outside this network entirely.
-- The tenant's subdomain is set explicitly wherever a hotspot_settings row
-- is created (onboarding, the Hotspot settings save) — this bare column
-- default only covers a row inserted some other way and stays empty rather
-- than guess at a hostname that belongs to a different tenant.
alter table hotspot_settings add column if not exists walled_garden text[] not null default '{}';
-- add column if not exists only sets a default for a column that doesn't
-- exist yet — it does not change the default of one already there, so this
-- has to be stated explicitly for a database that's had this column since
-- before the Safaricom/blanket-*.vibelink.tech default was retired.
alter table hotspot_settings alter column walled_garden set default '{}';
-- Any tenant still sitting on exactly that old default (never edited it
-- themselves) gets moved onto their own subdomain instead — the thing that
-- default always should have been, one tenant at a time rather than a
-- platform-wide wildcard that let every tenant's guests reach every other
-- tenant's portal before paying.
update hotspot_settings hs set walled_garden = array[t.subdomain || '.vibelink.tech']
  from tenants t
 where t.id = hs.tenant_id and t.subdomain is not null
   and hs.walled_garden = array['*.safaricom.co.ke','api.safaricom.co.ke','sandbox.safaricom.co.ke','*.vibelink.tech'];

-- The LAN the hotspot serves. Kept per tenant because two sites behind the same
-- platform must not be told to use the same subnet by default.
alter table hotspot_settings add column if not exists hotspot_network text
  not null default '10.5.50.0/24';

-- idle_timeout_min could only ever express whole minutes — pushed to the
-- router as `00:${minutes}:00`, which breaks outright for anything under a
-- minute. A used voucher's username stays locked to whoever is holding it
-- until the router notices they've gone idle, so ten minutes (the old
-- default) is ten minutes nobody else can use a code that already froze.
-- Seconds is what the router setting actually is; the column name should
-- say so. Existing values are minutes and are converted once, not
-- reinterpreted — a tenant who set 10 keeps a 600-second idle timeout, not a
-- sudden 10-second one. idle_timeout_min stays in place (expand, don't
-- contract) but nothing writes to it after this.
alter table hotspot_settings add column if not exists idle_timeout_sec int;
update hotspot_settings set idle_timeout_sec = idle_timeout_min * 60 where idle_timeout_sec is null;
alter table hotspot_settings alter column idle_timeout_sec set default 1200;
alter table hotspot_settings alter column idle_timeout_sec set not null;

-- 30 seconds — the column default just above, until now — is short enough
-- that ordinary browsing (reading a page, a paused video, a screen lock)
-- routinely exceeds it, disconnecting a guest who has not actually left.
-- No tenant is plausibly running on this on purpose; every row still sitting
-- at exactly the old default gets the same fix new rows get going forward.
update hotspot_settings set idle_timeout_sec = 1200 where idle_timeout_sec = 30;

-- The Vouchers screen has always shown an "Auto-purge expired vouchers"
-- toggle, checked by default, with a detail line naming the expiry job by
-- name — reading as if it were already wired to something. It never
-- persisted anywhere and nothing ever read it: flipping it did precisely
-- nothing, on or off, and the only thing that actually deleted an expired
-- voucher was an operator remembering to press "Purge expired" by hand.
-- This column, jobs.js's new purgeExpiredVouchers, and the toggle's real
-- wiring together make it true rather than decorative.
alter table hotspot_settings add column if not exists auto_purge_vouchers boolean not null default true;

-- ─────────────── platform billing and dunning ───────────────
-- Every tenant is billed on the 1st. A tenant that signs up mid-month gets the
-- rest of that month free, which needs no special case: billTenants only runs on
-- the 1st, so their first invoice is the following one.
--
-- Chasing an unpaid invoice used to be all or nothing — status went straight to
-- 'suspended' and every API call returned 402, so an operator with an overdue
-- bill could not even look at their own customers to work out who owed them. The
-- escalation is graded instead, counted in days from the invoice date:
--   day 1  invoice raised
--   day 2  banner on their dashboard
--   day 4  SMS to the owner
--   day 5  read-only: they can see everything, change nothing
alter table invoices add column if not exists dunning_stage int not null default 0;
alter table invoices add column if not exists notified_at   timestamptz;
-- What the invoice is actually for — every one raised by hand looked
-- identical on screen but for the amount and due date, with nothing to
-- say why it existed once the person who created it forgot.
alter table invoices add column if not exists reason text;

-- Which invoices are the platform's own, rather than a subscriber's.
create index if not exists invoices_saas_open
  on invoices (tenant_id, due_date) where subscriber_id is null and status <> 'paid';

-- ─────────────── fold tariffs into plans ───────────────
-- `tariffs` and `plans` were parallel catalogues of the same thing, and only
-- `plans` was real: subscribers.plan_id references it, activateSubscriber reads
-- its rates, and fair use measures against its cap. Nothing ever read `tariffs`
-- except the screen that wrote it — so an operator would create a tariff, open
-- the client form, and be told there were no plans yet.
--
-- Carry anything already entered over, matching on title so re-running is safe.
-- PPPoE is billed monthly, hence 43200 minutes.
insert into plans (tenant_id, service, title, price, duration_min, devices,
                   rate_down, rate_up, radius_profile, active)
select t.tenant_id, 'pppoe', t.title, t.price, 43200, 1,
       t.speed_down, t.speed_up, 'pppoe-' || t.title, t.active
  from tariffs t
 where not exists (
   select 1 from plans p
    where p.tenant_id = t.tenant_id and p.service = 'pppoe' and p.title = t.title);

-- ─────────────── router service account ───────────────
-- The app pushes RADIUS, PPPoE and hotspot settings over the RouterOS API rather
-- than having operators paste commands. It logs in as its own account, created
-- on first push using the operator's admin credentials, so that when they change
-- their own password — and they will — pushes keep working instead of silently
-- failing until someone notices.
--
-- Same username on every router so it is recognisable, but a different password
-- on each: one shared password would turn a single compromised site into access
-- to every customer's router. Stored encrypted (see src/secrets.js), because a
-- database dump must not be a set of keys to the whole fleet.
alter table routers add column if not exists service_user         text;
alter table routers add column if not exists service_password_enc text;
alter table routers add column if not exists service_created_at   timestamptz;
alter table routers add column if not exists ros_version          text;
alter table routers add column if not exists ros_identity         text;
alter table routers add column if not exists autoconfig_last_at   timestamptz;
alter table routers add column if not exists autoconfig_last_ok   boolean;
alter table routers add column if not exists autoconfig_last_error text;

-- ─────────────── CoA result ───────────────
-- CoA is best-effort — radreply is already correct, so a failure only delays the
-- new speed until the subscriber reconnects. That makes a permanently broken CoA
-- path invisible, which is how it went unnoticed that the old code shelled out to
-- a `radclient` binary that was never installed. Record every attempt instead.
alter table routers add column if not exists coa_last_at    timestamptz;
alter table routers add column if not exists coa_last_ok    boolean;
alter table routers add column if not exists coa_last_error text;

-- ─────────────── per-tenant tunnel subnet ───────────────
-- Every tenant gets its own /24 carved out of 10.50.0.0/16, so router addresses
-- cannot collide across tenants. They used to: onboarding handed every tenant's
-- first router 10.50.0.1, which puts duplicate nasname rows in the `nas` view and
-- leaves FreeRADIUS unable to tell two routers apart.
alter table tenants add column if not exists tunnel_subnet cidr;
create unique index if not exists tenants_tunnel_subnet on tenants (tunnel_subnet);

-- ─────────────── WireGuard peers ───────────────
-- One peer per router. Keys are minted by the app (node:crypto does X25519), so
-- nothing shells out to `wg` and the private key can be shown once at onboarding
-- and never stored in the clear on the router side.
create table if not exists wg_peers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  router_id     uuid references routers on delete cascade,
  name          text not null,
  public_key    text not null unique,
  preshared_key text,
  assigned_ip   inet not null unique,
  last_handshake timestamptz,
  rx_bytes      bigint not null default 0,
  tx_bytes      bigint not null default 0,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists wg_peers_tenant on wg_peers (tenant_id);

-- ─────────────── admin portal authentication ───────────────
-- The design's sign-in screen keeps accounts in component state and compares
-- passwords in plain text. That is fine for a mockup and unacceptable here, so
-- credentials live on `staff` as a scrypt hash and sessions are server-side.

-- `if not exists` throughout so re-applying the schema over an existing database
-- is a no-op here rather than a hard failure. (`npm run migrate -- --reset` drops
-- everything first if you want a clean slate.)
alter table staff add column if not exists password_hash  text;
alter table staff add column if not exists is_super_admin boolean not null default false;
-- Sign-in accepts either identifier, so both must be globally unique and are
-- compared case-insensitively.
alter table staff add column if not exists username       text;
create unique index if not exists staff_email_unique    on staff (lower(email))    where email    is not null;
create unique index if not exists staff_username_unique on staff (lower(username)) where username is not null;

-- No RLS on staff, tenants or admin_sessions: login has to find the account before
-- any tenant context exists, so app.tenant_id is not set yet at that point.
-- Named admin_sessions to avoid colliding with `sessions` (RADIUS accounting).
create table if not exists admin_sessions (
  token      text primary key,            -- 32 random bytes, base64url
  staff_id   uuid not null references staff on delete cascade,
  tenant_id  uuid not null references tenants on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists admin_sessions_expires_at_idx on admin_sessions (expires_at);

-- ─────────────── signing in across subdomains ───────────────
-- Signup happens on the apex, but a tenant's portal lives at its own subdomain,
-- and the session cookie is host-only — so a redirect would land them on a login
-- screen seconds after choosing a password.
--
-- Widening the cookie to .vibelink.tech would fix that and is the wrong trade:
-- it would then be sent to every tenant's hostname, and since sibling subdomains
-- count as same-site, SameSite=Lax would not hold a malicious tenant back.
-- Instead the apex mints a single-use token, valid for a minute, that the
-- subdomain exchanges for its own host-only cookie on the same session row.
create table if not exists session_handoffs (
  token         text primary key,
  session_token text not null references admin_sessions on delete cascade,
  expires_at    timestamptz not null,
  used_at       timestamptz
);
create index if not exists session_handoffs_expiry on session_handoffs (expires_at);

-- ─────────────── password reset / magic-link sign-in ───────────────
-- Same one-use-ticket shape as session_handoffs, but minted before any session
-- exists (that is the whole point: the operator has just said they cannot get
-- one) so it points at a staff row instead of an existing session.
create table if not exists login_tokens (
  token      text primary key,
  staff_id   uuid not null references staff on delete cascade,
  purpose    text not null check (purpose in ('reset', 'magic')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists login_tokens_staff_idx on login_tokens (staff_id);
create index if not exists login_tokens_expiry_idx on login_tokens (expires_at);

alter table outages       enable row level security;
alter table sla_policies  enable row level security;
alter table kb_articles   enable row level security;
alter table site_profiles enable row level security;
alter table settlements   enable row level security;
do $$ declare t text;
begin
  foreach t in array array['outages','sla_policies','kb_articles','site_profiles','settlements'] loop
    execute format($f$create policy tenant_isolation on %I
      using (tenant_id = current_setting('app.tenant_id', true)::uuid)$f$, t);
  end loop;
end $$;

-- ─────────────── who is connected, according to the router ───────────────
-- Presence was read from radacct alone, which is right only while RADIUS
-- accounting is arriving. It stops arriving for reasons that have nothing to do
-- with the customer: the tunnel drops, the router reboots, accounting was never
-- enabled because Configure failed. The customer stays connected throughout,
-- and the screen calls them offline — then closeStaleSessions stamps a stop
-- time and even "last seen" becomes a fiction.
--
-- This is the router's own answer to the same question, filled in on demand by
-- reading /ppp/active and /ip/hotspot/active. Kept apart from radacct on
-- purpose: radacct is billing data and must only ever hold what the router
-- actually accounted for. Nothing here is billed from.
create table if not exists live_sessions (
  tenant_id  uuid not null references tenants on delete cascade,
  router_id  uuid references routers on delete cascade,
  username   text not null,
  address    inet,
  service    text,                       -- pppoe | hotspot
  seen_at    timestamptz not null default now(),
  primary key (tenant_id, username)
);
create index if not exists live_sessions_seen on live_sessions (seen_at);

alter table live_sessions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='live_sessions' and policyname='tenant_isolation') then
    create policy tenant_isolation on live_sessions
      using (tenant_id = current_setting('app.tenant_id', true)::uuid);
  end if;
end $$;

-- ─────────────── per-tenant favicon ───────────────
-- Stored in the row rather than on disk or in object storage: these are a
-- few KB each, there is exactly one per tenant, and every other per-tenant
-- asset this app has (branding strings, templates) already lives in the
-- database rather than the filesystem. Small enough that a bytea column and
-- one query is simpler than standing up anything else for it.
alter table tenants add column if not exists favicon bytea;
alter table tenants add column if not exists favicon_mime text;

-- ─────────────── referrals & commission ───────────────
-- Whoever brings in a client — a staff member working a lead, an existing
-- customer sending their own friends and neighbours your way, or someone
-- outside the business entirely (a shop owner, anyone else). staff_id and
-- subscriber_id link back to an existing row for the first two; both left
-- null for an external referrer, who exists only in this table.
create table if not exists referrers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants on delete cascade,
  staff_id         uuid references staff on delete set null,
  subscriber_id    uuid references subscribers on delete set null,
  name             text not null,
  phone            text,
  -- percent: commission_rate is 0-100, applied to the client's first payment.
  -- fixed: commission_rate is a flat KES amount, paid regardless of that
  -- payment's size.
  commission_type  text not null default 'percent',
  commission_rate  numeric(12,2) not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  constraint referrers_commission_type_valid check (commission_type in ('percent','fixed'))
);
-- referrers was first created without subscriber_id (staff and external
-- referrers only) — added when customers were let refer their own friends.
-- create table if not exists is a no-op on a database where the narrower
-- version already ran, so the column and its constraint have to be added
-- here explicitly rather than only in the table definition above.
alter table referrers add column if not exists subscriber_id uuid references subscribers on delete set null;
alter table referrers drop constraint if exists referrers_not_both_staff_and_subscriber;
-- A referrer is staff, an existing customer, or external — never both a
-- staff row and a customer row at once, which would just be ambiguous
-- about which relationship actually earned the commission.
alter table referrers add constraint referrers_not_both_staff_and_subscriber
  check (not (staff_id is not null and subscriber_id is not null));
create index if not exists referrers_tenant_id_idx on referrers (tenant_id);
-- Both looked up whenever a referrer is created or edited, to confirm the
-- staff/customer row actually belongs to this tenant — a sequential scan of
-- every referrer for that check gets slower with every referrer a tenant
-- has, for a lookup that has nothing to do with how many referrers exist.
create index if not exists referrers_staff_id_idx on referrers (staff_id) where staff_id is not null;
create index if not exists referrers_subscriber_id_idx on referrers (subscriber_id) where subscriber_id is not null;

-- Which referrer brought in this lead, chosen alongside the channel/source
-- it came through — set at creation, same reasoning as subscribers.referred_by
-- below: a fact about how the lead arrived, not something to quietly rewrite.
alter table leads add column if not exists referrer_id uuid references referrers on delete set null;
create index if not exists leads_referrer_id_idx on leads (referrer_id) where referrer_id is not null;

-- Set at client creation, not changeable after — the referral is a fact
-- about how this client came to sign up, same as the account was created;
-- reassigning it later would let a payout dispute be resolved by editing
-- history instead of the commission record itself.
alter table subscribers add column if not exists referred_by uuid references referrers on delete set null;
-- GET /api/referrers joins every subscriber against referrers on this
-- column to compute clients_referred — without an index that's a full
-- table scan of subscribers on every single load of the Referrals screen.
create index if not exists subscribers_referred_by_idx on subscribers (referred_by) where referred_by is not null;

-- One row per client, ever — the unique constraint on subscriber_id is what
-- makes "one-time, on the first payment" actually true rather than a rule
-- the application code has to remember to enforce everywhere a payment can
-- be applied.
create table if not exists referral_commissions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants on delete cascade,
  referrer_id    uuid not null references referrers on delete cascade,
  subscriber_id  uuid not null references subscribers on delete cascade,
  payment_id     uuid references payments on delete set null,
  basis_amount   numeric(12,2) not null,   -- the payment this was computed from
  amount         numeric(12,2) not null,   -- the commission itself
  status         text not null default 'owed',
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  unique (subscriber_id),
  constraint referral_commissions_status_valid check (status in ('owed','paid'))
);
create index if not exists referral_commissions_tenant_id_idx on referral_commissions (tenant_id);
create index if not exists referral_commissions_referrer_id_idx on referral_commissions (referrer_id);

-- ─────────────── lead follow-up, assignment, notes ───────────────
-- Every write-up on what a real lead pipeline needs beyond a stage and a
-- source agrees on the same three things: who owns it, when to touch it
-- next, and a running record of what's actually happened — a pipeline with
-- none of those is a list, not a pipeline.
alter table leads add column if not exists assigned_to    uuid references staff on delete set null;
alter table leads add column if not exists next_follow_up timestamptz;
create index if not exists leads_assigned_to_idx on leads (assigned_to) where assigned_to is not null;
create index if not exists leads_next_follow_up_idx on leads (next_follow_up) where next_follow_up is not null;

-- Same shape as ticket_notes — one append-only history per lead rather than
-- a single "notes" text field that only ever remembers the last thing
-- anyone typed over whatever was there before.
create table if not exists lead_notes (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants on delete cascade,
  lead_id   uuid not null references leads on delete cascade,
  author    text,
  body      text not null,
  at        timestamptz not null default now()
);
create index if not exists lead_notes_lead_idx on lead_notes (lead_id, at);

-- ─────────────── the expired-customers IP pool is back ───────────────
-- Briefly retired in favor of a RADIUS-reply-attribute-only block (the
-- update/constraint right above this one) — restored because the dedicated
-- range is what actually catches a subscriber who never reconnects at all,
-- not just the live-session case CoA can reach. The reply attribute stays
-- too (radius.js's walledGarden still sets it) as the belt to this range's
-- braces, same as routeros.js's applyExpiredPool always described it.
--
-- Unlike before, this pool is never offered under Networks — it's
-- auto-created per router (server.js's autoExpiredCidr/ensureExpiredPool)
-- and pushed by Configure, not something an operator sets up by hand.
alter table ip_pools drop constraint if exists ip_pools_purpose_check;
alter table ip_pools add constraint ip_pools_purpose_check check (purpose in ('normal', 'expired'));

-- ─────────────── payment monitoring by site/router ───────────────
-- Which physical router a hotspot voucher was bought at — set from
-- stk_requests.purpose.router_id when the payment lands (payments/apply.js),
-- itself carried by the login page's own ?router= query param, plumbed
-- through from a hardcoded, always-"1" placeholder that never actually
-- identified a router. Nullable: a purchase from a page cached before this
-- existed, or without a known router, simply has nothing to attribute.
alter table vouchers add column if not exists router_id uuid references routers on delete set null;
create index if not exists vouchers_router_id_idx on vouchers (router_id) where router_id is not null;

-- A router-scoped expired-customers pool detached (router_id set to null)
-- rather than deleted when its router was removed — an orphan by
-- definition, since one is only ever created for exactly one router and is
-- never offered under Networks for an operator to notice or clean up by
-- hand. DELETE /api/routers/:id now drops it outright instead; this clears
-- any left behind before that fix.
delete from ip_pools where purpose='expired' and router_id is null;

-- ─────────────── web push (installed PWA notifications) ───────────────
-- One row per browser install that opted in, not per staff member — the
-- same person on their phone and their laptop gets two independent
-- subscriptions, and each is pushed to separately. endpoint is unique
-- because it already uniquely identifies one browser's one subscription
-- (assigned by the browser's own push service), which is what makes
-- upserting on it safe: resubscribing the same install updates in place
-- rather than piling up duplicates.
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  staff_id   uuid references staff on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_tenant_id_idx on push_subscriptions (tenant_id);

-- Which side raised this ticket — 'staff' (the default, for every existing
-- row and every ticket raised from the Tickets screen) or 'portal' (the
-- customer's own "report a problem"/plan-change request). The Dashboard
-- highlights open 'portal' tickets separately: a customer's own report
-- getting lost inside the general open-ticket count is worse than a staff
-- one, since nobody else necessarily knows it exists yet.
alter table tickets add column if not exists source text not null default 'staff';

-- Every WireGuard/failover-onboarded router before this fix left its peer's
-- router_id unset — there was no router row to point at yet when the peer
-- was minted, and nothing ever went back to link them once one existed
-- (see POST /api/routers' new wgPeerId handling). Backfilled here by the
-- one fact that does tie them together: the router's own NAS address is
-- exactly the tunnel address the peer was assigned.
update wg_peers p set router_id = r.id
  from routers r
 where p.router_id is null
   and host(r.host)::text = host(p.assigned_ip)::text
   and r.tenant_id = p.tenant_id;

-- Which plan a portal plan-change-request ticket is actually asking for —
-- the subject line and ticket_notes both say so in free text (readable by
-- a person, not safe to parse back into an id to actually apply), so
-- approving one needs a real column to act on rather than string-matching
-- a plan title that could have been renamed or gone inactive since.
alter table tickets add column if not exists requested_plan_id uuid references plans on delete set null;

-- ─────────────── platform-owned SMS gateway (shared, per-tenant credit) ───────────────
-- For a tenant with no SMS gateway of their own configured (or one that ran
-- dry) to still send, on the platform owner's own account and credentials —
-- not pooled: each tenant only ever spends from a balance the platform
-- owner explicitly gave them, so one tenant's usage can never eat into
-- another's or run up a bill nobody agreed to.
create table if not exists platform_sms_config (
  id          boolean primary key default true,
  provider    text,
  credentials jsonb not null default '{}'::jsonb,
  constraint platform_sms_config_singleton check (id)
);
alter table tenants add column if not exists platform_sms_balance int not null default 0;

-- What a tenant pays (to the platform owner, not to their own gateway) to
-- buy more platform SMS credit once their given balance runs out.
alter table platform_sms_config add column if not exists price_per_credit numeric(12,2) not null default 2;

-- More than one platform-owned gateway can now exist — e.g. two approved
-- sender IDs under the same provider account — so specific tenants can be
-- pinned to a specific one instead of every tenant sharing the single row
-- above (still read nowhere in code; left in place rather than dropped).
create table if not exists platform_sms_gateways (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  provider         text not null,
  credentials      jsonb not null default '{}'::jsonb,
  price_per_credit numeric(12,2) not null default 2,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now()
);
create unique index if not exists platform_sms_gateways_one_default
  on platform_sms_gateways (is_default) where is_default;

-- One-time carry-over of whatever was already configured in the old
-- singleton row, as the new default gateway — an operator who had already
-- set up platform SMS keeps sending exactly as before after this migration.
do $$
begin
  if not exists (select 1 from platform_sms_gateways) then
    insert into platform_sms_gateways (name, provider, credentials, price_per_credit, is_default)
    select 'Default', provider, credentials, price_per_credit, true
      from platform_sms_config where id = true and provider is not null;
  end if;
end $$;

-- null = falls back to whichever platform_sms_gateways row is flagged
-- default, rather than a specific sender pinned for this tenant.
alter table tenants add column if not exists platform_sms_gateway_id uuid references platform_sms_gateways(id) on delete set null;

-- Optional customer-profile fields for the Client-info tab — none of these
-- drive billing or RADIUS, they're just what an operator records about who
-- the customer is, so all three are nullable with no default.
alter table subscribers add column if not exists email text;
alter table subscribers add column if not exists category text;
alter table subscribers add column if not exists identification text;
alter table subscribers add column if not exists billing_type text;
alter table subscribers add column if not exists tags text[] not null default '{}';

-- Splynx's "linked accounts": one customer with several separate sites —
-- a landlord's flats, a business with branches — each billed as its own
-- account_code (not one account with several lines, which line_label
-- already covers), grouped only for a consolidated view. An arbitrary
-- operator-chosen string rather than a parent/child table: the grouping is
-- informational, nothing downstream (billing, RADIUS) needs to know about
-- it, and a free-text tag is enough to bring them all up together.
alter table subscribers add column if not exists customer_ref text;
create index if not exists subscribers_customer_ref_idx on subscribers (tenant_id, customer_ref) where customer_ref is not null;

-- ─────────────── role permission matrix ───────────────
-- The "Roles & permissions" tab on Staff always looked real but was pure
-- decoration: DEFAULT_PERMISSIONS lived in a useState with nothing to load
-- from or save to, and no backend route ever checked a role against a
-- permission key — a support login could hit any route an owner could,
-- the matrix's checkboxes notwithstanding. This table is what a checkbox
-- there now actually controls; requirePermission() in server.js reads it.
-- Only overrides from the built-in default are stored — an unrecognized
-- (tenant, role, key) falls back to DEFAULT_PERMISSIONS, so a fresh tenant
-- needs no rows here at all to behave exactly as the matrix always showed.
create table if not exists role_permissions (
  tenant_id uuid not null references tenants on delete cascade,
  role      text not null,
  perm_key  text not null,
  allowed   boolean not null default false,
  primary key (tenant_id, role, perm_key)
);

-- What actually happened to an account, for the Activity log tab — status
-- changes, edits, credential resets. subscriber_id is set null (not
-- cascaded) on delete so the history of a removed line still shows under
-- the account it belonged to, tagged by account_code in the detail text.
create table if not exists activity_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  subscriber_id uuid references subscribers on delete set null,
  account_code  text,
  actor         text,
  action        text not null,
  detail        text,
  created_at    timestamptz not null default now()
);
create index if not exists activity_log_subscriber_idx on activity_log (subscriber_id, created_at desc);

-- ─────────────── platform collect-and-settle ───────────────
-- For a tenant with no payment gateway of their own: customers pay into
-- the platform owner's own Daraja paybill instead (account reference
-- carries which tenant/subscriber it's for), and the platform settles the
-- collected money out to the tenant on a schedule — jobs.js's
-- settleTenants(), via daraja.js's b2c(). Opt-in per tenant, off by
-- default: a tenant already collecting on their own paybill is untouched.
alter table tenants add column if not exists platform_collect_enabled boolean not null default false;
alter table tenants add column if not exists settlement_phone text;
alter table tenants add column if not exists settlement_commission_pct numeric(5,2) not null default 5;

-- settlements existed already (a read-only GET /api/settlements, nothing
-- ever wrote to it) — this is what actually makes it real. One open
-- 'pending' row per tenant, accrued into by accrueSettlement()
-- (payments/apply.js) as payments come in, closed out once paid.
create unique index if not exists settlements_one_pending_per_tenant on settlements (tenant_id) where status = 'pending';
-- Matches a payout back to its settlements row when Safaricom's
-- b2c-result webhook reports the outcome, minutes after the payout call
-- itself returned "queued".
alter table settlements add column if not exists conversation_id text;

-- A dedicated paybill for platform-collect, separate from whatever the
-- platform owner's own tenant uses for its ordinary SaaS billing. Deliberate:
-- commingling a third party's customer payments with the platform's own
-- paybill traffic is exactly the aggregator-style mixing that makes the
-- regulatory question (see the collect-and-settle design notes) worse than
-- it needs to be, and it makes reconciliation unreadable either way. At most
-- one per (tenant, provider) — payments/daraja.js's stkPushForSubscriber and
-- jobs.js's payoutRow prefer this over the tenant's default gateway when set,
-- and fall back to the default if it isn't (so this stays optional, not a
-- breaking requirement for collect-and-settle to keep working).
alter table tenant_payment_config add column if not exists is_platform_collect boolean not null default false;
create unique index if not exists tpc_one_platform_collect_per_provider
  on tenant_payment_config (tenant_id, provider) where is_platform_collect;

-- Safaricom charges the *sending* paybill a B2C transaction fee, tiered by
-- amount, on every payout — separate from settlement_commission_pct, which is
-- Vibelink's own cut. Per tenant, whether that Safaricom-side cost is passed
-- on to them (deducted from their payout, on top of the commission) or just
-- absorbed into the platform's margin.
alter table tenants add column if not exists settlement_fee_mode text not null default 'commission_only'
  check (settlement_fee_mode in ('commission_only', 'tiered'));

-- Editable rather than hardcoded: Safaricom updates this tariff periodically,
-- and a stale number baked into code either shortchanges a tenant or eats
-- into the platform's own margin without anyone noticing. Seeded below with
-- Safaricom's last-published B2C tariff as a starting point — the platform
-- owner should verify/correct it against their current Daraja tariff sheet
-- before relying on it for real payouts.
create table if not exists b2c_fee_tiers (
  id         uuid primary key default gen_random_uuid(),
  min_amount numeric(12,2) not null,
  max_amount numeric(12,2),              -- null = no upper bound
  fee        numeric(12,2) not null,
  unique (min_amount)
);
insert into b2c_fee_tiers (min_amount, max_amount, fee) values
  (1,      499,    0),
  (500,    2500,   11),
  (2501,   5000,   22),
  (5001,   7500,   32),
  (7501,   10000,  42),
  (10001,  15000,  57),
  (15001,  20000,  67),
  (20001,  null,   76)
on conflict (min_amount) do nothing;

-- What a payout actually cost the tenant beyond commission — recorded at
-- send time (jobs.js's payoutRow) so the Settlements tab can show the real
-- deduction, not just infer it after the fact from a changed tariff table.
alter table settlements add column if not exists fee numeric(12,2) not null default 0;

-- ─────────────── platform changelog ───────────────
-- "What's new" feed, authored by the platform owner (POST is superAdminOnly)
-- and readable by every tenant — so a feature shipped centrally actually
-- reaches the people running on it, instead of living only in a commit
-- message nobody but the platform owner ever reads.
create table if not exists platform_updates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
-- Per tenant, not per staff member: one admin opening the feed clears the
-- badge for their whole team, the same way a shared inbox works. Simpler
-- than per-staff read receipts, and nobody asked for those.
alter table tenants add column if not exists last_update_seen_at timestamptz;

-- ─────────────── inventory ───────────────
-- Physical gadgets — routers, ONTs, CPEs, switches — tracked per tenant.
-- owned_by_tenant is the accountability question that matters most: a
-- customer-owned router at their premises is nothing to chase if it breaks,
-- ours is an asset to recover if they leave. mac_address is the other half
-- of accountability — the one identifier that survives a relabeling or a
-- reassignment to a different client.
create table if not exists inventory_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants on delete cascade,
  name            text not null,             -- e.g. "TP-Link CPE210", "MikroTik hAP lite"
  category        text,                      -- router | ont | cpe | switch | cable | other — free text, not enforced
  mac_address     text,
  serial_number   text,
  owned_by_tenant boolean not null default true,
  -- Where it actually is: at a client's premises (subscriber_id), or tied to
  -- a specific site/router (router_id) — a spare in the store has neither.
  subscriber_id   uuid references subscribers on delete set null,
  router_id       uuid references routers on delete set null,
  status          text not null default 'in_stock'
                    check (status in ('in_stock','installed','faulty','retired')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists inventory_items_tenant_idx on inventory_items (tenant_id);
create index if not exists inventory_items_subscriber_idx on inventory_items (subscriber_id) where subscriber_id is not null;
-- A MAC only has to be unique within one tenant's own inventory — two
-- different ISPs on this platform each cataloguing their own gear will
-- legitimately see the same vendor MAC block, and there's no reason to
-- couple one tenant's data entry to another's.
create unique index if not exists inventory_items_tenant_mac
  on inventory_items (tenant_id, mac_address) where mac_address is not null and mac_address <> '';

-- Bulk stock — cable, connectors, spare CPEs still in their box — has no
-- individual identity worth a MAC or a serial, only a count. 'serialized'
-- keeps every existing row's meaning unchanged (quantity defaults to the
-- obvious 1 per gadget); 'bulk' is a consumable/spare line with no MAC, no
-- serial, and no premises or router link — it isn't installed anywhere,
-- it's just on the shelf until it is.
alter table inventory_items add column if not exists tracking text not null default 'serialized'
  check (tracking in ('serialized', 'bulk'));
alter table inventory_items add column if not exists quantity integer not null default 1
  check (quantity >= 0);
alter table inventory_items add column if not exists unit text;   -- e.g. "meters", "pcs", "boxes" — bulk only

-- Where a gadget actually is, distinct from its condition (status): the
-- competing platforms researched for this (Splynx, Sonar, ISPBox) all treat
-- location as its own axis — warehouse, a technician's van, a client's
-- premises, or the repair bench — because "in stock" alone doesn't answer
-- "which shelf, or whose van". premises still keys off subscriber_id, which
-- already existed; van keys off assigned_staff_id, added here.
alter table inventory_items add column if not exists location text not null default 'warehouse'
  check (location in ('warehouse', 'van', 'premises', 'repair_bench'));
alter table inventory_items add column if not exists assigned_staff_id uuid references staff on delete set null;
create index if not exists inventory_items_staff_idx on inventory_items (assigned_staff_id) where assigned_staff_id is not null;

-- Assignment history: every meaningful move a gadget makes, not just its
-- current state. quantity matters for a bulk line issued a few units at a
-- time; a serialized gadget's own movements are always quantity 1.
create table if not exists inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  item_id       uuid not null references inventory_items on delete cascade,
  action        text not null,   -- created | issued | returned | installed | repaired | adjusted | updated
  from_location text,
  to_location   text,
  staff_id      uuid references staff on delete set null,
  subscriber_id uuid references subscribers on delete set null,
  quantity      integer not null default 1,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on inventory_movements (item_id, created_at desc);
create index if not exists inventory_movements_tenant_idx on inventory_movements (tenant_id, created_at desc);

-- A newly invited staff member used to get no notification at all — no
-- password, no username, no link, nothing telling them an account even
-- existed. 'invite' is a third login_tokens purpose alongside reset/magic,
-- redeemed at /accept-invite to set both a password and a username for the
-- first time, sent by SMS (always, since phone is the one field invite
-- actually requires) and email (if one was given).
alter table login_tokens drop constraint if exists login_tokens_purpose_check;
alter table login_tokens add constraint login_tokens_purpose_check check (purpose in ('reset', 'magic', 'invite'));

-- 'piggyback': a hotspot tenant registers only a Buy Goods till number
-- (tenant_payment_config provider 'piggyback_till', no credentials of
-- their own) and the platform's own Daraja app dispatches the STK push
-- with PartyB overridden to that till, per the platform's Safaricom
-- aggregator agreement — money lands directly on the tenant's till, never
-- in the platform's own balance, so unlike 'piggyback_collect' there is no
-- settlement/commission step at all. Distinct from the existing 'till'
-- value, which means "no API, guest pays manually, we match the SMS" —
-- this one still gives the guest the same one-tap STK push experience.
alter table hotspot_settings drop constraint if exists payment_method_valid;
alter table hotspot_settings add constraint payment_method_valid
  check (payment_method in ('kopokopo','paybill','bankstk','till','piggyback'));

/**
 * Wallet credit used to live on subscribers.credit — one balance per line.
 * A customer with several lines under one account_code (a house and a shop,
 * tagged by line_label) had a separate, siloed wallet on each one: paying
 * off one line's overage could sit there as spare credit while a second,
 * expired line under the very same account got suspended anyway, credit or
 * not, because that credit was on the wrong row to help it. Pooled by
 * account instead — one balance any of that account's lines can draw from,
 * and any of them can leave leftover credit into, via settleSubscriber in
 * payments/apply.js and jobs.js's renewFromWallet.
 */
create table if not exists account_wallets (
  tenant_id    uuid not null references tenants on delete cascade,
  account_code text not null,
  balance      numeric(12,2) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, account_code)
);

-- One-time backfill: whatever was scattered across subscribers.credit before
-- pooling existed, pulled into the new shared balance. Safe to re-run — once
-- credit is zeroed below, a second pass sums to nothing and touches no rows.
insert into account_wallets (tenant_id, account_code, balance)
select tenant_id, account_code, sum(credit) from subscribers
group by tenant_id, account_code
having sum(credit) <> 0
on conflict (tenant_id, account_code) do update set balance = account_wallets.balance + excluded.balance;

update subscribers set credit = 0 where credit <> 0;

-- A platform-collected tenant's payout used to have exactly one destination
-- shape: a phone number, paid via B2C. Two more now exist — a till/paybill
-- with no account reference, and a bank reached through its own paybill plus
-- the tenant's account number there — each needing Safaricom's B2B API
-- (payments/daraja.js's b2b()) instead of B2C, since B2C can only ever pay a
-- phone number. settlement_method picks which of the three settlement_* sets
-- of columns jobs.js's payoutRow actually reads; the unused ones for a given
-- method are simply left null.
alter table tenants add column if not exists settlement_method text not null default 'phone'
  check (settlement_method in ('phone', 'till', 'bank'));
alter table tenants add column if not exists settlement_till text;
alter table tenants add column if not exists settlement_bank_name text;
alter table tenants add column if not exists settlement_bank_paybill text;
alter table tenants add column if not exists settlement_account_number text;

-- A plan belongs to every site by default — the owner's call to restrict a
-- PPPoE tariff or hotspot bundle to one or several specific routers, or
-- leave it shared across all of them, same knob either way. visible is
-- hotspot-only in the UI: a bundle the operator isn't ready to sell yet, or
-- one kept for internal use, stays off the guest-facing captive portal
-- without deleting it (PPPoE has no public listing to hide from, so it is
-- simply never surfaced there).
alter table plans add column if not exists visible boolean not null default true;

-- Which sites a plan is restricted to. No rows for a plan means shared
-- everywhere — the same meaning the earlier single-router_id column used to
-- carry — one or more rows means "only these sites," so "deploy to two
-- sites and leave the rest" is just two rows, not a schema change.
create table plan_sites (
  plan_id   uuid not null references plans on delete cascade,
  router_id uuid not null references routers on delete cascade,
  primary key (plan_id, router_id)
);

-- One-time carry-over from the single-router_id column this replaces, for
-- any tenant who set it during that column's brief lifetime before this
-- table existed. A no-op everywhere else.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name='plans' and column_name='router_id') then
    insert into plan_sites (plan_id, router_id)
    select id, router_id from plans where router_id is not null
    on conflict do nothing;
    alter table plans drop column router_id;
  end if;
end $$;

-- The captive portal's banner/advert slot (Hotspot -> Portal Design's
-- "Banner / advert" fields). banner_url already existed on this table but
-- was never wired to anything — repurposed here as the ad's optional link
-- rather than adding a second unused column next to it.
alter table hotspot_settings add column if not exists ad_text text;

-- Which platform gateway handles SMS relayed on behalf of a sibling Vibelink
-- deployment (vibelink-co-ke today, any future one the same way) — those have
-- no row in `tenants` to hang a platform_sms_gateway_id off, so this keys the
-- assignment by the fixed `source` string each sibling's relay call already
-- identifies itself with instead (see sendViaPlatformGateway in sms.js).
-- Absent row = falls back to whichever platform_sms_gateways row is flagged
-- default, same as an unassigned tenant.
create table if not exists platform_sms_relay_sources (
  source     text primary key,
  gateway_id uuid not null references platform_sms_gateways(id) on delete cascade
);

-- ─────────────── expenses, HR, payroll ───────────────
-- Kept off the `staff` login/identity table on purpose, the same reason
-- hotspot_settings/tenant_payment_config are their own tables rather than
-- columns bolted onto `tenants` — employment details are a different
-- concern from "who can log in and do what."
create table if not exists hr_profiles (
  staff_id          uuid primary key references staff on delete cascade,
  tenant_id         uuid not null references tenants on delete cascade,
  employee_no       text,
  base_salary       numeric(12,2) not null default 0,
  salary_frequency  text not null default 'monthly',
  -- A staff member's own signup commission, if they earn one, already runs
  -- through referrers/referral_commissions (referrers.staff_id) — nothing
  -- duplicated here. This is pay/payout config only.
  payout_method     text not null default 'manual',
  payout_phone      text,   -- falls back to staff.phone at payout time if null
  employment_status text not null default 'active',
  hired_at          date,
  created_at        timestamptz not null default now(),
  constraint hr_profiles_salary_frequency_valid check (salary_frequency in ('monthly','weekly')),
  constraint hr_profiles_payout_method_valid check (payout_method in ('manual','mpesa')),
  constraint hr_profiles_employment_status_valid check (employment_status in ('active','suspended','terminated'))
);
create index if not exists hr_profiles_tenant_id_idx on hr_profiles (tenant_id);

create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  category     text not null,
  description  text,
  amount       numeric(12,2) not null,
  paid_to      text,
  staff_id     uuid references staff on delete set null,   -- set when this expense IS a staff reimbursement
  status       text not null default 'pending',
  receipt_url  text,
  created_by   uuid references staff on delete set null,
  approved_by  uuid references staff on delete set null,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint expenses_status_valid check (status in ('pending','approved','paid','rejected'))
);
create index if not exists expenses_tenant_id_idx on expenses (tenant_id);
create index if not exists expenses_status_idx on expenses (tenant_id, status);
-- A photographed receipt, stored the same way a tenant's favicon is: raw
-- bytes + mime in the row, served back through its own authenticated route.
alter table expenses add column if not exists receipt_data bytea;
alter table expenses add column if not exists receipt_mime text;

create table if not exists payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants on delete cascade,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'draft',
  created_by    uuid references staff on delete set null,
  approved_by   uuid references staff on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint payroll_runs_status_valid check (status in ('draft','approved','processing','completed'))
);
create index if not exists payroll_runs_tenant_id_idx on payroll_runs (tenant_id);

-- source_id is a loose reference (expenses.id for expense_reimbursement,
-- referral_commissions.id for commission) rather than an FK — the two
-- source tables are unrelated, and `type` already says which one applies.
create table if not exists payroll_items (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references payroll_runs on delete cascade,
  staff_id   uuid not null references staff on delete cascade,
  type       text not null,
  amount     numeric(12,2) not null,
  source_id  uuid,
  note       text,
  created_at timestamptz not null default now(),
  constraint payroll_items_type_valid check (type in ('salary','commission','expense_reimbursement','bonus','deduction'))
);
create index if not exists payroll_items_run_id_idx on payroll_items (run_id);

-- One row per staff member per run — the actual disbursement, summing that
-- staff's items. conversation_id is matched by the same Daraja b2c-result
-- webhook settlements already uses (payments/daraja.js).
create table if not exists payroll_payouts (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references payroll_runs on delete cascade,
  staff_id        uuid not null references staff on delete cascade,
  tenant_id       uuid not null references tenants on delete cascade,
  amount          numeric(12,2) not null,
  method          text not null default 'manual',
  status          text not null default 'pending',
  phone           text,
  conversation_id text,
  fee             numeric(12,2),
  reference       text,
  failed_reason   text,
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (run_id, staff_id),
  constraint payroll_payouts_method_valid check (method in ('manual','mpesa')),
  constraint payroll_payouts_status_valid check (status in ('pending','processing','paid','failed'))
);
create index if not exists payroll_payouts_tenant_id_idx on payroll_payouts (tenant_id);
create index if not exists payroll_payouts_conversation_id_idx on payroll_payouts (conversation_id) where conversation_id is not null;

-- Who actually entered a lead — separate from assigned_to, which can move
-- to someone else after the fact. Commission attribution on a won lead
-- with no explicit referrer falls back to the assignee, then to whoever
-- created it, so a signup never loses its staff credit just because no one
-- picked a "Referred by" — see PATCH /api/leads/:id.
alter table leads add column if not exists created_by uuid references staff on delete set null;
-- The subscriber a lead became, once "Convert" is used — without this a
-- won lead and the account it turned into are only ever linked implicitly
-- through a shared referrer_id, so neither page can show the other.
alter table leads add column if not exists subscriber_id uuid references subscribers on delete set null;
create index if not exists leads_subscriber_id_idx on leads (subscriber_id) where subscriber_id is not null;

-- Which upstream carries a router's internet — freeform, since the operator
-- chooses from a suggested list of Kenyan carriers but can type any name.
-- Platform-owner only (GET /api/platform/upstream-breakdown): with hundreds
-- of tenants and routers, "who do we actually depend on" is otherwise
-- invisible — an outage or a price change from one upstream should be
-- answerable with a number, not a guess.
alter table routers add column if not exists upstream_provider text;
create index if not exists routers_upstream_provider_idx on routers (upstream_provider) where upstream_provider is not null;

-- 'auto' rows are free for the background sweep (detectUpstreamProviders, in
-- jobs.js) to overwrite as a router's carrier changes; 'manual' rows are an
-- operator's own correction (set whenever they type a non-empty value under
-- Routers → Edit) and are left alone until they clear the field themselves.
alter table routers add column if not exists upstream_source text not null default 'auto';
alter table routers add column if not exists upstream_checked_at timestamptz;
alter table routers add column if not exists upstream_public_ip inet;

-- Where a prospective-customer alert goes (a live chat with nobody online,
-- a new website lead) — separate from alert_phone above, which is for
-- technical/router-down alerts. A sales rep and the on-call technician are
-- rarely the same person, and treating a hot lead as low-priority network
-- noise (or paging a technician for a sales question) is exactly the
-- mismatch this exists to avoid. Falls back to alert_phone, then the
-- owner's own phone, when unset — see notifySales in jobs.js.
alter table app_settings add column if not exists sales_phone text;

-- What "Employee of the month" is worth, in KES. 0 (the default) means the congratulations still goes out but no
-- expense is raised for it — see employeeOfTheMonth in jobs.js.
alter table app_settings add column if not exists eotm_reward_amount numeric(12,2) not null default 0;

-- Which of a tenant's own already-configured paybills (tenant_payment_config
-- — several are supported per provider, see the "several paybills per
-- provider" migration above) a customer at this router actually pays into.
-- On site_profiles rather than a new table: a router already has at most
-- one row there. Left unset, a router's customers fall back to whichever
-- gateway is flagged is_default — a tenant with only one paybill never
-- needs to touch this at all.
alter table site_profiles add column if not exists payment_config_id uuid references tenant_payment_config on delete set null;

-- How many subscribers genuinely share one bandwidth pool on a PPPoE
-- tariff, MikroTik-style ("1:4" etc.) — 1 (the default) is today's
-- unchanged behaviour, a dedicated Mikrotik-Rate-Limit with no queue
-- involved at all. Above 1, activateSubscriber (radius.js) provisions a
-- parent Simple Queue per (router, plan) sized at the plan's own rate,
-- and each subscriber gets a child queue under it — so N people sharing
-- a 10 Mbps tariff can each burst to 10 Mbps alone, but split it when
-- several are active at once, rather than each getting an independent
-- dedicated 10 Mbps.
alter table plans add column if not exists contention_ratio integer not null default 1;
alter table plans drop constraint if exists plans_contention_ratio_check;
alter table plans add constraint plans_contention_ratio_check check (contention_ratio between 1 and 6);

-- A permanent, staff-issued hotspot login — "Lounge WiFi", "Staff WiFi" —
-- distinct from a voucher: no expiry, no purchase behind it, and shared by
-- design rather than one device per code. max_devices is this code's own
-- shared-users cap, independent of hotspot_settings.multi_device (that one
-- only ever governs voucher-issued logins); ensureHotspotProfiles
-- (radius.js) creates one hs-shared-<N> RouterOS user profile per distinct
-- value in use so each code actually gets its own concurrent-device limit
-- rather than sharing one flat setting.
create table if not exists hotspot_access_codes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  label        text not null,
  username     text not null,
  password     text not null,
  max_devices  integer not null default 1,
  plan_id      uuid references plans,
  created_at   timestamptz not null default now(),
  unique (tenant_id, username)
);
alter table hotspot_access_codes drop constraint if exists hotspot_access_codes_max_devices_check;
alter table hotspot_access_codes add constraint hotspot_access_codes_max_devices_check check (max_devices between 1 and 50);

-- A staff ID badge's own QR-verification identity — deliberately separate
-- from username/password: this gets printed on a badge and shown to
-- strangers, so it must never double as (or leak) anything a login could
-- use. gen_random_uuid() is volatile, so this backfills every existing row
-- with its own distinct token in the same statement, not just new ones.
-- photo_data is a small data: URI (resized client-side before upload)
-- rather than object storage — nothing else in this codebase has a file-
-- upload path yet, and a badge photo is small enough not to need one.
alter table staff add column if not exists verification_token uuid not null default gen_random_uuid();
create unique index if not exists staff_verification_token_idx on staff (verification_token);
alter table staff add column if not exists photo_data text;

-- A badge's own validity, distinct from hr_profiles.employment_status — an
-- employee can stay employed with an expired badge (due for reprinting) just
-- as easily as an ex-employee's badge stops mattering the moment they leave.
-- The verify page checks both independently rather than conflating them.
alter table hr_profiles add column if not exists badge_expires_at date;

-- Editable wording for the system emails (password reset, magic-link
-- sign-in, customer credentials, staff invite) — same idea as
-- tenant_sms_config.templates, a per-key JSON override merged over
-- email.js's own DEFAULTS.
alter table tenant_email_config add column if not exists templates jsonb not null default '{}'::jsonb;

-- Dormant clients: blocked (expired, suspended or paused) for three months, then
-- deleted automatically once past five months. blocked_since is when the
-- current unbroken blocked stretch began; dormant_at is when it was marked
-- dormant (the deletion warning starts there). Both clear the day the client is
-- active again. See jobs.js's dormantSweep.
alter table subscribers add column if not exists blocked_since timestamptz;
alter table subscribers add column if not exists dormant_at timestamptz;
create index if not exists subscribers_blocked_since_idx
  on subscribers (tenant_id, blocked_since) where blocked_since is not null;

-- ─────────────── suppliers, monthly bills, payroll as expense ───────────────
-- A supplier is who money is paid to for the business (fuel, rent, bandwidth,
-- equipment). Expenses can name one; archived rather than deleted once it has
-- history.
create table if not exists suppliers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  name         text not null,
  category     text,
  contact_name text,
  phone        text,
  email        text,
  paybill      text,          -- how to pay them: M-Pesa paybill or till
  till_number  text,
  account_ref  text,          -- the account number to quote on that paybill
  kra_pin      text,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists suppliers_tenant_name_idx on suppliers (tenant_id, lower(name));

-- A bill that comes round every month (rent, internet upstream, tower lease).
-- jobs.js's generateMonthlyBills turns each active one into a pending expense
-- a few days before it is due; approving and paying that entry is the same
-- flow as any other expense.
create table if not exists recurring_bills (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  name         text not null,
  category     text not null,
  supplier_id  uuid references suppliers on delete set null,
  amount       numeric(12,2) not null,
  day_of_month int not null default 1,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint recurring_bills_day_valid check (day_of_month between 1 and 31)
);
create index if not exists recurring_bills_tenant_idx on recurring_bills (tenant_id);

alter table expenses add column if not exists supplier_id uuid references suppliers on delete set null;
alter table expenses add column if not exists recurring_bill_id uuid references recurring_bills on delete set null;
alter table expenses add column if not exists bill_month date;
alter table expenses add column if not exists due_date date;
alter table expenses add column if not exists reference text;
-- The payroll payout an expense was recorded from, so a replayed webhook or a
-- second run of the backfill below cannot record it twice.
alter table expenses add column if not exists payout_id uuid references payroll_payouts on delete set null;
create unique index if not exists expenses_bill_month_idx
  on expenses (recurring_bill_id, bill_month) where recurring_bill_id is not null;
create unique index if not exists expenses_payout_idx
  on expenses (payout_id) where payout_id is not null;

-- Payroll already paid before this existed, recorded as expenses. Reimbursement
-- lines are left out: those are expenses of their own already. Safe to re-run.
insert into expenses (tenant_id, category, description, amount, paid_to, staff_id, status, paid_at, payout_id, reference)
select po.tenant_id, 'Salaries',
       'Payroll ' || to_char(pr.period_start, 'DD Mon YYYY') || ' – ' || to_char(pr.period_end, 'DD Mon YYYY'),
       po.amount - coalesce(r.amt, 0), s.name, po.staff_id, 'paid', coalesce(po.paid_at, now()), po.id, po.reference
  from payroll_payouts po
  join payroll_runs pr on pr.id = po.run_id
  join staff s on s.id = po.staff_id
  left join lateral (
    select sum(pi.amount) as amt from payroll_items pi
     where pi.run_id = po.run_id and pi.staff_id = po.staff_id and pi.type = 'expense_reimbursement'
  ) r on true
 where po.status = 'paid' and po.amount - coalesce(r.amt, 0) > 0
on conflict (payout_id) where payout_id is not null do nothing;

-- Several devices per hotspot code is now the default: a guest with a phone and
-- a laptop should not have to think about it. Only the default for tenants
-- that have not chosen — a tenant's saved setting is not touched.
alter table hotspot_settings alter column multi_device set default true;

-- ─────────────── platform fees, settlement schedule, collection on by default ───────────────
-- What a tenant is charged each month, per tenant so the platform owner can set
-- their own rate: a percentage of the tenant's hotspot revenue and a fixed
-- amount per active PPPoE client. Defaults are 3% and KES 16.
alter table tenants add column if not exists hotspot_commission_pct numeric(5,2) not null default 3;
alter table tenants add column if not exists pppoe_client_rate numeric(8,2) not null default 16;

-- How often collected money is paid out to the tenant. Payouts are always the
-- full amount collected — nothing is deducted for commission; the fees above
-- are billed monthly instead. 'manual' pays out only on "Request payout".
alter table tenants add column if not exists settlement_frequency text not null default 'daily';
alter table tenants drop constraint if exists tenants_settlement_frequency_check;
alter table tenants add constraint tenants_settlement_frequency_check
  check (settlement_frequency in ('daily', 'weekly', 'manual'));

-- New tenants collect through the platform paybill unless they bring a gateway
-- of their own (a tenant's own gateway always wins — see usePlatformCollect).
alter table tenants alter column platform_collect_enabled set default true;

-- One statement per tenant per month: the figures and the rates they were
-- worked out at, kept as they were on the day so a later rate change never
-- rewrites a statement already sent. Written by jobs.js's generateMonthlyCharges
-- on the 1st for the month just ended.
create table if not exists tenant_charges (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants on delete cascade,
  month           date not null,              -- first day of the month charged
  hotspot_revenue numeric(12,2) not null default 0,
  hotspot_pct     numeric(5,2)  not null,
  hotspot_fee     numeric(12,2) not null default 0,
  pppoe_active    int           not null default 0,
  pppoe_rate      numeric(8,2)  not null,
  pppoe_fee       numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  status          text not null default 'open',
  note            text,
  created_at      timestamptz not null default now(),
  unique (tenant_id, month),
  constraint tenant_charges_status_valid check (status in ('open', 'invoiced', 'paid', 'waived'))
);

-- One-time steps, remembered here so re-running the schema does not repeat them.
create table if not exists schema_flags (
  name       text primary key,
  applied_at timestamptz not null default now()
);

-- Existing tenants that had no way to collect at all (no payment gateway of
-- their own, collection off) are switched on once. The demo tenant stays off on
-- purpose (a visitor's "Buy" must never send a real prompt), and so does any
-- tenant with a gateway of their own.
do $$
begin
  if not exists (select 1 from schema_flags where name = 'platform_collect_default_on') then
    update tenants t set platform_collect_enabled = true
     where not t.platform_collect_enabled
       and t.subdomain <> 'demo'
       and not exists (select 1 from tenant_payment_config c where c.tenant_id = t.id);
    insert into schema_flags (name) values ('platform_collect_default_on');
  end if;
end $$;

-- ─────────────── tenants paying the platform ───────────────
-- Every receipt from a tenant: paid to the platform paybill quoting their
-- reference (VL-101), or by an M-Pesa prompt they sent themselves. The
-- reference (M-Pesa receipt code) is unique, so a replayed callback cannot
-- credit twice. Applied to their oldest unpaid statements by charges.js.
create table if not exists tenant_payments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  amount     numeric(12,2) not null,
  method     text not null,                 -- paybill | stk | manual
  reference  text,
  phone      text,
  created_at timestamptz not null default now(),
  constraint tenant_payments_method_valid check (method in ('paybill', 'stk', 'manual'))
);
create unique index if not exists tenant_payments_reference_idx
  on tenant_payments (reference) where reference is not null;
create index if not exists tenant_payments_tenant_idx on tenant_payments (tenant_id, created_at desc);

-- Money paid beyond what is currently owed; it settles the next statement.
alter table tenants add column if not exists billing_credit numeric(12,2) not null default 0;
alter table tenant_charges add column if not exists paid_at timestamptz;

-- ─────────────── trials are free; paying starts when a tenant is activated ───────────────
-- converted_at: when a tenant became a paying customer (activated by the platform
-- owner, or paid a statement). A tenant without one is on trial or was never
-- activated, and is never invoiced. jobs.js / charges.js read it.
alter table tenants add column if not exists converted_at timestamptz;

do $$
begin
  -- Tenants already live before this existed are paying customers.
  if not exists (select 1 from schema_flags where name = 'tenants_converted_backfill') then
    update tenants set converted_at = coalesce(created_at, now())
     where status in ('active', 'readonly') and converted_at is null;
    insert into schema_flags (name) values ('tenants_converted_backfill');
  end if;

  -- The trial is 14 days. A trial already running gets 14 days from now rather
  -- than from when it began, so nobody is locked out the night this is applied.
  if not exists (select 1 from schema_flags where name = 'trial_14_days') then
    update tenants set licence_ends = current_date + 14
     where status = 'trial' and (licence_ends is null or licence_ends > current_date + 14);
    insert into schema_flags (name) values ('trial_14_days');
  end if;
end $$;

-- A tenant can be charged a flat monthly amount instead of by usage. Null means
-- by usage (hotspot % + a rate per active PPPoE client). When set, the statement
-- is that amount and the usage figures are recorded but not charged.
alter table tenants add column if not exists flat_monthly_fee numeric(12,2);
alter table tenants drop constraint if exists tenants_flat_fee_check;
alter table tenants add constraint tenants_flat_fee_check check (flat_monthly_fee is null or flat_monthly_fee >= 0);
alter table tenant_charges add column if not exists flat_fee numeric(12,2) not null default 0;

-- ─────────────── tenants that host for themselves ───────────────
-- 'self': the tenant runs their own copy of the software on their own server
-- (like billing.vibelink.co.ke). They are billed a flat monthly fee, and that
-- server asks this one whether the licence is valid, using instance_key. Only
-- a hash of the key is kept: it is shown once, when generated.
alter table tenants add column if not exists hosting text not null default 'platform';
alter table tenants drop constraint if exists tenants_hosting_check;
alter table tenants add constraint tenants_hosting_check check (hosting in ('platform', 'self'));
alter table tenants add column if not exists instance_key_hash text;
alter table tenants add column if not exists instance_last_seen timestamptz;
create unique index if not exists tenants_instance_key_idx on tenants (instance_key_hash) where instance_key_hash is not null;

-- ─────────────── Safaricom's B2C fee comes out of the payout ───────────────
-- Every tenant's payout now has Safaricom's B2C charge deducted automatically
-- (the tariff in b2c_fee_tiers), instead of the platform absorbing it. Existing
-- tenants are switched once; the platform owner can still set a tenant back to
-- 'commission_only' from Edit tenant.
alter table tenants alter column settlement_fee_mode set default 'tiered';
do $$
begin
  if not exists (select 1 from schema_flags where name = 'b2c_fee_deducted_default') then
    update tenants set settlement_fee_mode = 'tiered' where settlement_fee_mode = 'commission_only';
    insert into schema_flags (name) values ('b2c_fee_deducted_default');
  end if;
end $$;

-- ─────────────── the operator's own network, drawn on the map ───────────────
-- Fibre (OLT, splitters, closures, drops) and wireless (access points, backhaul
-- radios, stations) placed by hand, and the cables and links between them. A link
-- end is 'n:<node id>' or 'r:<router id>', so a router can be one end of a cable
-- without being copied into this table.
create table if not exists network_nodes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  kind       text not null,                 -- olt | splitter | closure | onu | ap | ptp | station | tower | pole | cabinet | power
  name       text not null,
  lat        numeric(9,6) not null,
  lng        numeric(9,6) not null,
  details    jsonb not null default '{}',   -- model, frequency, ip, split ratio, ...
  created_at timestamptz not null default now()
);
create index if not exists network_nodes_tenant on network_nodes (tenant_id);
create table if not exists network_links (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  kind       text not null check (kind in ('fibre', 'wireless')),
  from_ref   text not null,
  to_ref     text not null,
  path       jsonb not null default '[]',   -- waypoints between the ends: [[lat, lng], ...]
  label      text,
  details    jsonb not null default '{}',   -- cores, frequency, signal, ...
  created_at timestamptz not null default now()
);
create index if not exists network_links_tenant on network_links (tenant_id);

-- A drawn radio or device with an IP address can be watched: the router named here
-- pings it every minute. Two missed pings in a row mark it down, and the owner is
-- told once if it stays down.
alter table network_nodes add column if not exists watch_router_id uuid references routers on delete set null;
alter table network_nodes add column if not exists status text not null default 'unknown';   -- unknown | up | down
alter table network_nodes add column if not exists last_seen timestamptz;
alter table network_nodes add column if not exists offline_since timestamptz;
alter table network_nodes add column if not exists offline_notified boolean not null default false;
alter table network_nodes add column if not exists ping_fails int not null default 0;

-- ─────────────── SmartOLT (a tenant's cloud OLT manager) ───────────────
-- A tenant who has SmartOLT connects it with their subdomain and an API key. We keep a copy of
-- their OLTs and ONUs (refreshed from the API) so a client's ONU, the map, alerts and automatic
-- enable/disable can use it without asking SmartOLT on every page load.
create table if not exists smartolt_config (
  tenant_id        uuid primary key references tenants on delete cascade,
  subdomain        text not null,
  api_key_enc      text,                              -- encrypted (secrets.js)
  api_key_last4    text,
  enabled          boolean not null default true,
  auto_disable     boolean not null default false,    -- disable an expired client's ONU until they pay
  last_statuses_at timestamptz,
  last_details_at  timestamptz,
  last_error       text,
  last_error_at    timestamptz,
  created_at       timestamptz not null default now()
);
create table if not exists smartolt_olts (
  tenant_id  uuid not null references tenants on delete cascade,
  olt_id     text not null,
  name       text,
  ip         text,
  hardware   text,
  raw        jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, olt_id)
);
create table if not exists smartolt_onus (
  tenant_id      uuid not null references tenants on delete cascade,
  external_id    text not null,                       -- SmartOLT's unique_external_id
  sn             text,
  name           text,
  olt_id         text,
  olt_name       text,
  board          text,
  port           text,
  onu_no         text,
  onu_type       text,
  zone           text,
  odb            text,
  address        text,
  lat            numeric(9,6),
  lng            numeric(9,6),
  status         text not null default 'unknown',    -- online | offline | los | power_fail
  signal_class   text,
  signal_dbm     numeric(8,2),
  distance_m     numeric(10,1),
  admin_status   text,                               -- enabled | disabled
  authorized_at  timestamptz,
  subscriber_id  uuid references subscribers on delete set null,
  link_locked    boolean not null default false,      -- unlinked by hand: do not auto-link again
  disabled_by_us boolean not null default false,      -- switched off by auto-disable, so only we switch it back on
  offline_since  timestamptz,
  seen_at        timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, external_id)
);
create index if not exists smartolt_onus_subscriber on smartolt_onus (tenant_id, subscriber_id);
create index if not exists smartolt_onus_sn on smartolt_onus (tenant_id, lower(sn));
-- Open outage alerts (a PON port or a whole OLT with most ONUs down), so each is sent once.
create table if not exists smartolt_alerts (
  tenant_id uuid not null references tenants on delete cascade,
  key       text not null,
  since     timestamptz not null default now(),
  notified  boolean not null default false,
  primary key (tenant_id, key)
);
-- The serial number of a client's ONU, so it can be tied to the one SmartOLT reports.
alter table subscribers add column if not exists onu_sn text;

-- LOS handling: an ONU with no light for two checks in a row raises one ticket and one message per episode.
alter table smartolt_onus add column if not exists los_polls int not null default 0;
alter table smartolt_onus add column if not exists los_notified boolean not null default false;
-- ONUs SmartOLT has found but nobody has authorised yet, kept so the dashboard can say how many.
create table if not exists smartolt_unconfigured (
  tenant_id uuid not null references tenants on delete cascade,
  sn        text not null,
  olt_id    text,
  olt_name  text,
  board     text,
  port      text,
  pon_type  text,
  onu_type  text,
  seen_at   timestamptz not null default now(),
  primary key (tenant_id, sn)
);
alter table smartolt_config add column if not exists unconfigured_at timestamptz;

-- What time of day (Nairobi) a tenant's payout goes out, and the day it last did.
-- Midnight unless the tenant chooses otherwise; settlement_last_run stops a tenant being paid
-- twice in one day, and lets a run that was missed (server down at the hour) catch up.
alter table tenants add column if not exists settlement_time time not null default '00:00';
alter table tenants add column if not exists settlement_last_run date;

-- A payout sent to Safaricom waits for their result. If it never comes it can be cancelled (put back
-- to be paid again) or marked paid by hand; 'cancelled' rows keep the record. sent_at is when it was
-- sent, stuck_notified stops the same stuck payout being reported over and over.
alter table settlements add column if not exists note text;
alter table settlements add column if not exists sent_at timestamptz;
alter table settlements add column if not exists stuck_notified boolean not null default false;

-- A payout that failed is retried after this time (an hour), not every minute.
alter table tenants add column if not exists settlement_retry_at timestamptz;

-- The PPPoE login SmartOLT holds on an ONU, used to tie it to the client with the same PPPoE user.
alter table smartolt_onus add column if not exists pppoe_user text;

-- One ONU exactly as SmartOLT sent it (secrets hidden), so a field with an unexpected name can be seen and mapped.
alter table smartolt_config add column if not exists sample_onu jsonb;

-- Removing a tenant hides and suspends it (its site says "not available", jobs and payouts stop, staff are
-- signed out) but keeps every record. Only a second, deliberate step erases it.
alter table tenants add column if not exists deleted_at timestamptz;
alter table tenants add column if not exists deleted_by text;

-- Audit log: who did what, when, and whether it worked. Written by one middleware for every change made through
-- the API (never for reads), plus sign-ins and failed sign-ins. tenant_id has no foreign key on purpose: a
-- platform-owner entry such as "Tenant deleted permanently" must outlive the tenant it is about.
create table if not exists audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  tenant_id   uuid,
  tenant_name text,
  actor_id    uuid,
  actor       text not null,
  role        text,
  platform    boolean not null default false,   -- a platform-owner action (tenants, platform payouts)
  method      text,
  path        text,
  action      text not null,
  status      int,
  ip          text,
  detail      jsonb
);
create index if not exists audit_log_tenant_at on audit_log (tenant_id, at desc);
create index if not exists audit_log_at on audit_log (at desc);

-- M-Pesa validation: when on, a paybill payment typed with an account number that belongs to no client is refused
-- by Safaricom before the customer's money moves (needs External Validation enabled on the paybill).
alter table tenants add column if not exists mpesa_validation boolean not null default false;

-- An older, unused audit_log (id, tenant_id not null, actor, action, target, detail, at) already existed, so the
-- create above was skipped: bring it up to the shape the audit log writes.
alter table audit_log alter column tenant_id drop not null;
alter table audit_log add column if not exists tenant_name text;
alter table audit_log add column if not exists actor_id    uuid;
alter table audit_log add column if not exists role        text;
alter table audit_log add column if not exists platform    boolean not null default false;
alter table audit_log add column if not exists method      text;
alter table audit_log add column if not exists path        text;
alter table audit_log add column if not exists status      int;
alter table audit_log add column if not exists ip          text;

-- Traffic of devices let in by an ip-binding bypass (imported guests, TVs, consoles). They never touch RADIUS, so
-- there is no accounting for them; the router's own per-device queue counts their bytes instead, and jobs.js
-- (countDeviceTraffic) adds the difference to these totals. counter_* is the last reading, to take differences from.
alter table voucher_devices add column if not exists bytes_up     bigint not null default 0;
alter table voucher_devices add column if not exists bytes_down   bigint not null default 0;
alter table voucher_devices add column if not exists counter_up   bigint;
alter table voucher_devices add column if not exists counter_down bigint;
alter table voucher_devices add column if not exists counted_at   timestamptz;

-- When detection last tried this router, so one that cannot be detected is retried gently rather than every sweep.
alter table routers add column if not exists upstream_tried_at timestamptz;

-- An access code can carry a speed of its own (typed in, in kbps) instead of borrowing a bundle's. When set it wins
-- over plan_id; when both are empty the code gets the router's default.
alter table hotspot_access_codes add column if not exists rate_down_kbps int;
alter table hotspot_access_codes add column if not exists rate_up_kbps   int;

-- One speed for every access code of the tenant (Hotspot -> Access codes). A code with a speed of its own, or a
-- bundle, keeps that; every other code follows this; with none set the router default applies.
alter table hotspot_settings add column if not exists access_down_kbps int;
alter table hotspot_settings add column if not exists access_up_kbps   int;

-- Fingerprint / face / screen-lock sign-in (WebAuthn passkeys), one row per device a staff member turned it on for.
-- Only the public half of the key is kept. rp_id is the host it was made on: it works only there.
create table if not exists staff_passkeys (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references staff on delete cascade,
  tenant_id     uuid not null references tenants on delete cascade,
  credential_id text  not null unique,
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[],
  label         text,
  rp_id         text  not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists staff_passkeys_staff on staff_passkeys (staff_id);

-- Vouchers pointing at a hotspot profile the router does not have. An early migration above named every existing
-- voucher's profile 'hs-default'; profiles are now per bundle length (hs-cookie-<minutes>), so the router refused
-- those codes with "unknown user profile <hs-default>" after the password checked out. Point them at the profile
-- their bundle's length uses (capped at a day, as the router push names it); a code whose bundle is gone gets the
-- one-day profile. Safe to re-run: nothing is left naming hs-default once it has run.
update radreply rr
   set value = 'hs-cookie-' || least(greatest(p.duration_min, 1), 1440)
  from vouchers v
  join plans p on p.id = v.plan_id
 where rr.tenant_id = v.tenant_id and rr.username = v.code
   and rr.attribute = 'Mikrotik-Group' and rr.value = 'hs-default';
update radreply set value = 'hs-cookie-1440' where attribute = 'Mikrotik-Group' and value = 'hs-default';

-- Loyalty points for hotspot visitors, known by phone number (normalised to 254XXXXXXXXX). Off until a tenant turns it on.
create table if not exists loyalty_settings (
  tenant_id     uuid primary key references tenants on delete cascade,
  enabled       boolean not null default false,
  kes_per_point int not null default 10 check (kes_per_point >= 1)
);
create table if not exists loyalty_rewards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  plan_id     uuid not null references plans on delete cascade,
  points_cost int not null check (points_cost > 0),
  created_at  timestamptz not null default now()
);
create table if not exists loyalty_accounts (
  tenant_id       uuid not null references tenants on delete cascade,
  phone           text not null,
  points          int  not null default 0 check (points >= 0),
  lifetime_points int  not null default 0,
  last_earned_at  timestamptz,
  primary key (tenant_id, phone)
);
-- Every change to a balance, so a balance can always be explained. payment_id is unique so a payment earns points once.
create table if not exists loyalty_ledger (
  id         bigserial primary key,
  tenant_id  uuid not null references tenants on delete cascade,
  phone      text not null,
  delta      int  not null,
  reason     text not null,          -- purchase | redeem | adjust
  payment_id uuid unique references payments on delete set null,
  voucher_id uuid,
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_ledger_phone on loyalty_ledger (tenant_id, phone, created_at desc);

-- Whether visitors may check and redeem their own loyalty points on the hotspot login page (proved with an SMS code).
alter table loyalty_settings add column if not exists self_serve boolean not null default false;

-- When a lead first turned 'won' — what the leaderboard ("Employee of the month": who is winning the most leads
-- they were assigned, not who is earning the most commission) actually ranks on. Cleared if a lead is reopened, so
-- a lead won again later counts again, in the month it is actually won — see PATCH /api/leads/:id.
alter table leads add column if not exists won_at timestamptz;
update leads set won_at = created_at where status = 'won' and won_at is null;

-- Every staff member is a referrer by default (ensureStaffReferrer, server.js) from the moment they're created —
-- this backfills anyone added before that existed. Commission is only ever earned by whoever is explicitly named
-- as a lead's referrer, never just by being assigned to work it.
insert into referrers (tenant_id, staff_id, name, phone, commission_type, commission_rate, notes)
select st.tenant_id, st.id, st.name, st.phone, 'percent', 5, 'Every staff member is a referrer by default — set their own rate here'
  from staff st
 where not exists (select 1 from referrers r where r.tenant_id = st.tenant_id and r.staff_id = st.id);

-- When a ticket first turned 'resolved' — what "Employee of the month" (Team jobs) ranks on: the total jobs a
-- staff member has actually finished, not merely been assigned. See PATCH /api/tickets/:id.
alter table tickets add column if not exists resolved_at timestamptz;
update tickets set resolved_at = updated_at where status = 'resolved' and resolved_at is null;

-- Per-tenant licence cap on concurrent clients (PPPoE + hotspot combined, counted
-- the same way the app already shows "online" elsewhere: an open radacct row
-- updated in the last 15 minutes, or a live_sessions row seen in the last 5).
-- null = unlimited. Enforced at RADIUS auth time itself (sites-available/billing),
-- not just in the app, so a tenant over their cap cannot get a new device online
-- by any path — PATCH /api/tenants/:id (Super Admin only) is the only way to set it.
alter table tenants add column if not exists max_concurrent_clients int
  check (max_concurrent_clients is null or max_concurrent_clients >= 0);

-- A pause switch for a permanent access code, short of deleting it outright.
-- Deleting has always meant "gone for good" (its RADIUS row is removed and
-- the username can be reissued); this is for "not right now" — a lounge
-- closed for the night, a staff code someone wants to freeze without losing
-- the label/username/password/speed already set up for it. See PATCH
-- /api/hotspot/access-codes/:id.
alter table hotspot_access_codes add column if not exists enabled boolean not null default true;
