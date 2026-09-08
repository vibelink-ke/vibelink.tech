#!/usr/bin/env node
/**
 * Seed (or reset) a sales-demo tenant on vibelink.tech — a fully populated
 * ISP an operator can hand a prospect straight into, without it being able
 * to touch anything real.
 *
 *   node scripts/seed-demo-tenant.mjs
 *
 * Safety, not just data:
 *   - platform_collect_enabled is explicitly false, so a "Buy" flow someone
 *     tries in here can never fall back to a real M-Pesa charge through the
 *     platform's own paybill.
 *   - Every automation_jobs row is disabled — nothing here ever auto-charges,
 *     reminds, watches a (fake) router, or runs any other background job.
 *   - A tenant_sms_config row for a 'custom' provider pointing at a
 *     deliberately unreachable URL is inserted so any SMS attempt — cron or
 *     a staff member clicking "Send" while exploring — fails harmlessly
 *     instead of silently falling back to the platform's real gateway.
 *   - Router hosts are addresses nothing dials out to; a "Configure" or
 *     "Refresh" press just times out cleanly, the same as any router that
 *     is actually offline.
 *
 * Idempotent: re-running finds the existing "demo" tenant by subdomain and
 * wipes only ITS OWN rows in the tables this seeds before reinserting, so it
 * doubles as a "reset the demo" script once a prospect (or three) has been
 * clicking around in it.
 */
import 'dotenv/config';
import { pool, withTenant } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { seedTenant } from '../src/seed-tenant.js';

const SUBDOMAIN = 'demo';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoFiber2026!';

const JOBS = [
  'autoCharge', 'autoProvisionNewRouters', 'checkSlaBreaches', 'closeStaleSessions',
  'dbBackup', 'enforceFup', 'enforceHotspotDataCaps', 'expireAndSuspend',
  'expireStuckStkRequests', 'expireTenantLicences', 'generateInvoices', 'healRouters',
  'lockNewPppoeMacs', 'ownerBrief', 'pollWireguardStatus', 'purgeExpiredVouchers',
  'remind', 'settleTenants', 'watchdog',
];

const KE_NAMES = [
  'Wanjiku Mwangi', 'Otieno Odhiambo', 'Amina Hassan', 'Kiprop Kigen', 'Achieng Odongo',
  'Njeri Kamau', 'Barasa Wafula', 'Wambui Kariuki', 'Mutiso Musyoka', 'Chebet Rono',
  'Owino Ochieng', 'Nafula Wanyama', 'Kilonzo Mutua', 'Auma Onyango', 'Cherop Kiplagat',
];

const fakePhone = (n) => `07${String(10000000 + n * 137).slice(0, 8)}`;

const c0 = await pool.connect();
try {
  await c0.query('begin');

  let { rows: [tenant] } = await c0.query('select * from tenants where subdomain=$1', [SUBDOMAIN]);
  if (!tenant) {
    ({ rows: [tenant] } = await c0.query(
      `insert into tenants (name, subdomain, status, support_phone, platform_collect_enabled)
       values ('Demo Fiber Co', $1, 'active', '0700000000', false) returning *`,
      [SUBDOMAIN]));
    console.log('created tenant', tenant.name);
  } else {
    await c0.query('update tenants set platform_collect_enabled=false where id=$1', [tenant.id]);
    console.log('reusing tenant', tenant.name);
  }
  const tid = tenant.id;

  // Wipe this tenant's own rows in everything this script seeds, so re-runs
  // give a clean slate rather than piling up duplicates from every demo.
  for (const c of ['lead_notes', 'leads', 'referral_commissions', 'referrers', 'expenses',
    'hr_profiles', 'payroll_payouts', 'payroll_runs', 'tickets',
    'invoices', 'payments', 'subscribers', 'ip_pools', 'plans', 'routers', 'staff']) {
    await c0.query(`delete from ${c} where tenant_id=$1`, [tid]);
  }
  // No tenant_id column of its own — scoped via run_id, and payroll_runs
  // above already cascades into it (payroll_items.run_id references
  // payroll_runs on delete cascade), so nothing further to do here.

  await c0.query('insert into hotspot_settings (tenant_id) values ($1) on conflict do nothing', [tid]);

  // ── staff ──
  const pw = await hashPassword(DEMO_PASSWORD);
  const { rows: [owner] } = await c0.query(
    `insert into staff (tenant_id, name, phone, email, username, role, password_hash)
     values ($1,'Demo Owner','0700000001','demo@vibelink.tech','demo','owner',$2) returning id`,
    [tid, pw]);
  const { rows: [sales] } = await c0.query(
    `insert into staff (tenant_id, name, phone, role, password_hash)
     values ($1,'Brian Otieno','0700000002','sales',$2) returning id`, [tid, pw]);
  const { rows: [tech] } = await c0.query(
    `insert into staff (tenant_id, name, phone, role, password_hash)
     values ($1,'Faith Wambui','0700000003','technician',$2) returning id`, [tid, pw]);
  console.log('staff: owner (demo@vibelink.tech / username "demo"), sales, technician');

  // ── automation off, SMS gateway a safe no-op ──
  for (const job of JOBS) {
    await c0.query(
      `insert into automation_jobs (tenant_id, job, enabled) values ($1,$2,false)
       on conflict (tenant_id, job) do update set enabled=false`, [tid, job]);
  }
  await c0.query(
    `insert into tenant_sms_config (tenant_id, provider, credentials, priority, enabled)
     values ($1,'custom','{"url":"http://127.0.0.1:9/demo-sms-disabled"}'::jsonb,1,true)
     on conflict (tenant_id, provider) do nothing`, [tid]);
  console.log('automation disabled, SMS gateway sandboxed');

  // ── routers (fake, unreachable hosts — Configure/Refresh just time out cleanly) ──
  const { rows: [r1] } = await c0.query(
    `insert into routers (tenant_id, name, site, host, nas_identifier, role, secret, status, last_seen)
     values ($1,'Kileleshwa Tower','Kileleshwa','198.51.100.11','demo-r1','both','demo-secret-1','up',now())
     returning id`, [tid]);
  const { rows: [r2] } = await c0.query(
    `insert into routers (tenant_id, name, site, host, nas_identifier, role, secret, status, last_seen)
     values ($1,'Kilimani Estate','Kilimani','198.51.100.12','demo-r2','pppoe','demo-secret-2','up',now())
     returning id`, [tid]);
  await c0.query(
    `insert into routers (tenant_id, name, site, host, nas_identifier, role, secret, status, last_seen)
     values ($1,'Lang''ata Hotspot','Lang''ata','198.51.100.13','demo-r3','hotspot','demo-secret-3','down',now() - interval '3 hours')`,
    [tid]);
  console.log('routers: 3 (2 up, 1 down)');

  await c0.query(
    `insert into ip_pools (tenant_id, name, cidr, router_id, service, purpose)
     values ($1,'Kileleshwa PPPoE','10.90.0.0/22',$2,'pppoe','normal')`, [tid, r1.id]);

  // ── plans ──
  const { rows: [planHome10] } = await c0.query(
    `insert into plans (tenant_id, service, title, price, duration_min, rate_down, rate_up, radius_profile)
     values ($1,'pppoe','Home 10 Mbps',1500,43200,10000,10000,'pppoe-Home 10 Mbps') returning id`, [tid]);
  const { rows: [planHome20] } = await c0.query(
    `insert into plans (tenant_id, service, title, price, duration_min, rate_down, rate_up, radius_profile)
     values ($1,'pppoe','Home 20 Mbps',2500,43200,20000,20000,'pppoe-Home 20 Mbps') returning id`, [tid]);
  const { rows: [planHotspot] } = await c0.query(
    `insert into plans (tenant_id, service, title, price, duration_min, devices, rate_down, rate_up, radius_profile)
     values ($1,'hotspot','1 Hour',10,60,1,5000,5000,'hs-1-Hour') returning id`, [tid]);
  console.log('plans: 3');

  await c0.query('commit');
  // Only now, not earlier: this uses the pool's own separate connection, so
  // it cannot see the tenant (or anything else above) until c0's own
  // transaction has actually committed.
  await seedTenant(tid);

  // ── subscribers, invoices, payments — RLS-protected, needs withTenant ──
  const NAIROBI = [[-1.2833, 36.7833], [-1.2921, 36.7856], [-1.3031, 36.7073], [-1.3197, 36.8172]];
  const subs = [];
  await withTenant(tid, async (c) => {
    for (let i = 0; i < 10; i++) {
      const name = KE_NAMES[i % KE_NAMES.length];
      const isPppoe = i < 7;
      const plan = isPppoe ? (i % 2 === 0 ? planHome10.id : planHome20.id) : planHotspot.id;
      const router = isPppoe ? (i % 2 === 0 ? r1.id : r2.id) : r1.id;
      const status = i === 8 ? 'expired' : i === 9 ? 'grace' : 'active';
      const [lat, lng] = NAIROBI[i % NAIROBI.length];
      const { rows: [s] } = await c.query(
        `insert into subscribers (tenant_id, account_code, name, phone, service, plan_id, router_id,
           pppoe_user, pppoe_pass, status, expires_at, location, lat, lng)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id, account_code`,
        [tid, `DEMO${1000 + i}`, name, fakePhone(i), isPppoe ? 'pppoe' : 'hotspot', plan, router,
         isPppoe ? `demo${1000 + i}` : null, isPppoe ? 'demo-pass' : null, status,
         new Date(Date.now() + (status === 'expired' ? -3 : 20) * 86400000),
         `Demo estate, house ${i + 1}`, lat, lng]);
      subs.push(s);
    }
  });
  console.log('subscribers: 10 (mixed pppoe/hotspot, active/expired/grace)');

  await withTenant(tid, async (c) => {
    for (let i = 0; i < 6; i++) {
      const s = subs[i];
      const amount = i % 3 === 0 ? 2500 : 1500;
      const { rows: [inv] } = await c.query(
        `insert into invoices (tenant_id, subscriber_id, amount, paid, due_date, status, number)
         values ($1,$2,$3,$4,current_date - $5::int, $6, $7) returning id`,
        [tid, s.id, amount, i === 5 ? amount / 2 : amount, i, i === 5 ? 'partial' : 'paid',
         `DEMO-INV-${1000 + i}`]);
      await c.query(
        `insert into payments (tenant_id, provider, provider_ref, amount, payer_phone, payer_name,
           raw_account, subscriber_id, invoice_id, status, received_at, applied_at)
         values ($1,'daraja',$2,$3,$4,$5,$6,$7,$8,'applied', now() - ($9::text || ' days')::interval, now() - ($9::text || ' days')::interval)`,
        [tid, `DEMO${9000 + i}QR`, i === 5 ? amount / 2 : amount, fakePhone(i), KE_NAMES[i],
         s.account_code, s.id, inv.id, i]);
    }
  });
  console.log('invoices + payments: 6');

  // ── tickets ──
  await c0.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority, status, assigned_to)
     values ($1,'DEMO-1','Slow speeds in the evening',$2,'medium','open',$3)`,
    [tid, subs[0].id, tech.id]);
  await c0.query(
    `insert into tickets (tenant_id, number, subject, subscriber_id, priority, status, assigned_to)
     values ($1,'DEMO-2','Router keeps disconnecting',$2,'high','in_progress',$3)`,
    [tid, subs[1].id, tech.id]);
  console.log('tickets: 2');

  // ── leads + referrers ──
  const { rows: [staffReferrer] } = await c0.query(
    `insert into referrers (tenant_id, staff_id, name, phone, commission_type, commission_rate, notes)
     values ($1,$2,'Brian Otieno','0700000002','percent',5,'Demo sales rep') returning id`,
    [tid, sales.id]);
  await c0.query(
    `insert into referrers (tenant_id, name, phone, commission_type, commission_rate, notes)
     values ($1,'Wanjiku Mwangi',$2,'fixed',200,'Demo customer referral')`, [tid, fakePhone(0)]);

  const stages = ['new', 'new', 'contacted', 'contacted', 'won', 'won', 'lost', 'new'];
  for (let i = 0; i < stages.length; i++) {
    await c0.query(
      `insert into leads (tenant_id, name, phone, source, status, assigned_to, referrer_id, created_by, next_follow_up)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, KE_NAMES[(i + 3) % KE_NAMES.length], fakePhone(20 + i),
       ['walk-in', 'referral', 'facebook', 'call'][i % 4], stages[i], sales.id,
       stages[i] === 'won' && i % 2 === 0 ? staffReferrer.id : null, owner.id,
       stages[i] === 'new' || stages[i] === 'contacted' ? new Date(Date.now() + 2 * 86400000) : null]);
  }
  console.log('leads: 8, referrers: 2');

  // ── expenses ──
  await c0.query(
    `insert into expenses (tenant_id, category, description, amount, paid_to, status, created_by)
     values ($1,'Fuel','Generator fuel for Kileleshwa tower',3500,'Total Kileleshwa','paid',$2)`,
    [tid, owner.id]);
  await c0.query(
    `insert into expenses (tenant_id, category, description, amount, paid_to, status, created_by)
     values ($1,'Equipment','Replacement PoE injector',2200,'Datacom Kenya','approved',$2)`,
    [tid, owner.id]);
  await c0.query(
    `insert into expenses (tenant_id, category, description, amount, paid_to, staff_id, status, created_by)
     values ($1,'Repairs','Fibre patch repair callout',1000,null,$2,'pending',$3)`,
    [tid, tech.id, owner.id]);
  console.log('expenses: 3');

  // ── HR + payroll (draft, never disbursed) ──
  await c0.query(
    `insert into hr_profiles (staff_id, tenant_id, base_salary, salary_frequency, payout_method, employment_status)
     values ($1,$2,35000,'monthly','manual','active')`, [tech.id, tid]);
  await c0.query(
    `insert into hr_profiles (staff_id, tenant_id, base_salary, salary_frequency, payout_method, employment_status)
     values ($1,$2,25000,'monthly','manual','active')`, [sales.id, tid]);
  const { rows: [run] } = await c0.query(
    `insert into payroll_runs (tenant_id, period_start, period_end, status, created_by)
     values ($1, date_trunc('month', current_date), (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date, 'draft', $2)
     returning id`, [tid, owner.id]);
  await c0.query(
    `insert into payroll_items (run_id, staff_id, type, amount, note)
     values ($1,$2,'salary',35000,'Monthly salary')`, [run.id, tech.id]);
  await c0.query(
    `insert into payroll_items (run_id, staff_id, type, amount, note)
     values ($1,$2,'salary',25000,'Monthly salary')`, [run.id, sales.id]);
  console.log('HR profiles: 2, payroll run: 1 draft');

  console.log('\n— demo ready —');
  console.log('portal    https://demo.vibelink.tech');
  console.log('login     demo@vibelink.tech (or username "demo")');
  console.log('password  ' + DEMO_PASSWORD);
  console.log('\nRe-run this script any time to wipe and reseed a fresh copy.');
} catch (e) {
  await c0.query('rollback').catch(() => {});
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  c0.release();
  await pool.end();
}
