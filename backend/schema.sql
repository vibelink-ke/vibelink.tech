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
begin
  select id, tenant_id into v_router, v_tenant from routers where host = new.nasipaddress limit 1;
  if v_tenant is null then return new; end if;

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
alter table hotspot_settings alter column idle_timeout_sec set default 30;
alter table hotspot_settings alter column idle_timeout_sec set not null;

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
