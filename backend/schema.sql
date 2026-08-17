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
create index on subscribers (tenant_id, expires_at);
create index on subscribers using gin (phone gin_trgm_ops);

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
create index on vouchers (tenant_id, status, expires_at);

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
create index on payments (tenant_id, status, received_at desc);

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
create index on sessions (tenant_id, stopped_at) where stopped_at is null;

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
  idle_timeout_min int not null default 10,
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
  provider    text not null,     -- hostpinnacle | africastalking | textsms | ujumbe | mobitech | twilio | custom
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
create index on sms_log (tenant_id, at desc);

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
create index on outages (tenant_id, status, started_at desc);

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
create index on kb_articles using gin (title gin_trgm_ops);

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
create index on admin_sessions (expires_at);

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
