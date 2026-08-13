import cron from 'node-cron';
import { pool, enabledTenants } from './db.js';
import { send } from './sms.js';
import { walledGarden } from './radius.js';
import { enforceFup } from './fup.js';
import * as daraja from './payments/daraja.js';
import * as bank from './payments/bankstk.js';

/**
 * A job that throws must not take the process down with it — node-cron does not
 * catch rejections, and an unhandled one is fatal on Node 22+. Log and let the
 * next tick retry.
 */
const safely = (name, fn) => () =>
  Promise.resolve(fn()).catch((e) => console.error(`job ${name} failed:`, e?.message ?? e));

export function startJobs() {
  cron.schedule('*/5 * * * *', safely('expireAndSuspend', expireAndSuspend));
  cron.schedule('*/15 * * * *', safely('enforceFup', enforceFup));
  cron.schedule('0 6 * * *',  safely('generateInvoices', generateInvoices));
  cron.schedule('0 8,12,18 * * *', safely('autoCharge', autoCharge));
  cron.schedule('0 9 * * *',  safely('remind', remind));
  cron.schedule('*/1 * * * *', safely('watchdog', watchdog));
  cron.schedule('0 20 * * *', safely('ownerBrief', ownerBrief));
  cron.schedule('0 5 1 * *',  safely('billTenants', billTenants));
  cron.schedule('0 7 * * *',  safely('chaseTenants', chaseTenants));
}

/**
 * Chase tenants with an unpaid platform invoice, one step at a time.
 *
 * Counted in days from the invoice date, where the invoice itself is day 1:
 *   day 2  the dashboard shows a banner (read from the API, nothing to do here)
 *   day 4  SMS to the owner
 *   day 5  read-only — they keep every screen, but cannot change anything
 *
 * Read-only rather than suspended on purpose. Cutting an operator off entirely
 * means they cannot look up who owes them money, which is exactly what they need
 * to be doing in order to pay us.
 */
export async function chaseTenants() {
  const { rows } = await pool.query(`
    select i.id, i.tenant_id, i.number, i.amount, i.dunning_stage,
           (current_date - i.created_at::date) + 1 as day,
           t.name as tenant, t.status
      from invoices i join tenants t on t.id = i.tenant_id
     where i.subscriber_id is null
       and i.status <> 'paid'
       and t.status in ('active', 'trial', 'readonly')`);

  for (const inv of rows) {
    if (inv.day >= 4 && inv.dunning_stage < 4) {
      const { rows: [owner] } = await pool.query(
        "select phone from staff where tenant_id=$1 and role='owner' limit 1", [inv.tenant_id]);
      if (owner?.phone) {
        await send(inv.tenant_id, owner.phone,
          `${inv.tenant}: invoice ${inv.number} for ${inv.amount} is unpaid. `
          + 'Your account becomes read-only tomorrow until it is settled.').catch(() => {});
      }
      await pool.query('update invoices set dunning_stage=4, notified_at=now() where id=$1', [inv.id]);
    }

    if (inv.day >= 5 && inv.status !== 'readonly') {
      await pool.query("update tenants set status='readonly' where id=$1 and status<>'suspended'", [inv.tenant_id]);
      await pool.query('update invoices set dunning_stage=5 where id=$1', [inv.id]);
    }
  }

  // Anyone who has settled every platform invoice gets full access back. This has
  // to be its own pass: payment arrives through a webhook that knows nothing about
  // dunning, and nobody should have to wait for a human to flip them back.
  await pool.query(`
    update tenants t set status='active'
     where t.status='readonly'
       and not exists (select 1 from invoices i
                        where i.tenant_id=t.id and i.subscriber_id is null and i.status<>'paid')`);
}

/** Grace -> walled garden -> suspended, with no human in the loop. */
async function expireAndSuspend() {
  const { rows } = await pool.query(
    `select id, tenant_id, expires_at from subscribers
     where status in ('active','grace') and expires_at < now()
       and tenant_id in (${enabledTenants})`, ['expireAndSuspend']);
  for (const s of rows) {
    const hours = (Date.now() - new Date(s.expires_at)) / 36e5;
    const next = hours < 24 ? 'grace' : 'expired';
    await pool.query('update subscribers set status=$2 where id=$1', [s.id, next]);
    if (next === 'expired') await pool.query('begin').then(() => walledGarden(pool, s.tenant_id, s.id)).catch(() => {});
  }
  await pool.query(
    `update vouchers set status='expired'
     where status='in_use' and expires_at < now() and tenant_id in (${enabledTenants})`,
    ['expireAndSuspend']);
}

async function generateInvoices() {
  await pool.query(`
    insert into invoices (tenant_id, subscriber_id, plan_id, number, amount, due_date)
    select s.tenant_id, s.id, s.plan_id,
           'INV-' || to_char(now(),'YYMM') || '-' || substr(s.id::text,1,6),
           p.price, (s.expires_at)::date
    from subscribers s join plans p on p.id = s.plan_id
    where s.status in ('active','grace')
      and s.expires_at between now() and now() + interval '3 days'
      and s.tenant_id in (${enabledTenants})
      and not exists (select 1 from invoices i
                      where i.subscriber_id = s.id and i.status in ('open','partial'))`,
    ['generateInvoices']);
}

/** Fire STK for everyone with a saved mandate. Retries are just the later cron slots. */
async function autoCharge() {
  const { rows } = await pool.query(`
    select s.id, s.tenant_id, s.phone, s.account_code, s.autopay, i.amount
    from subscribers s join invoices i on i.subscriber_id = s.id
    where s.autopay is not null and i.status in ('open','partial') and i.due_date <= current_date
      and s.tenant_id in (${enabledTenants})`, ['autoCharge']);
  for (const s of rows) {
    try {
      if (s.autopay === 'daraja') await daraja.stkPush(s.tenant_id,
        { phone: s.phone, amount: s.amount, accountRef: s.account_code, description: 'Internet renewal' });
      if (s.autopay === 'bankstk') await bank.stkPush(s.tenant_id,
        { bank: 'equity', phone: s.phone, amount: s.amount, accountRef: s.account_code, subscriberId: s.id });
    } catch (e) { console.error('autocharge', s.id, e.message); }
  }
}

async function remind() {
  const { rows } = await pool.query(`
    select s.tenant_id, s.name, s.phone, s.account_code, s.expires_at
    from subscribers s
    where s.status='active' and s.expires_at between now() and now() + interval '3 days'
      and s.tenant_id in (${enabledTenants})`, ['remind']);
  for (const s of rows) {
    await send(s.tenant_id, s.phone, 'reminder',
      { name: s.name.split(' ')[0], expires: new Date(s.expires_at).toLocaleString('en-KE'), account: s.account_code });
  }
}

/** Ping every NAS; three misses and the owner gets a WhatsApp/SMS. */
async function watchdog() {
  const { rows } = await pool.query(
    `select id, tenant_id, name, host from routers where tenant_id in (${enabledTenants})`, ['watchdog']);
  for (const r of rows) {
    const up = await ping(r.host);
    await pool.query('update routers set status=$2, last_seen=case when $3 then now() else last_seen end where id=$1',
      [r.id, up ? 'up' : 'down', up]);
  }
}

async function ping(host) {
  const { execFile } = await import('node:child_process');
  return new Promise(res => execFile('ping', ['-c', '1', '-W', '2', String(host)], e => res(!e)));
}

async function ownerBrief() {
  const { rows } = await pool.query(`
    select t.id, t.name, s.owner_phone, x.collected, x.new_subs, x.down
    from tenants t
    cross join lateral (
      select coalesce(sum(p.amount),0) collected,
             (select count(*) from subscribers where tenant_id=t.id and created_at::date = current_date) new_subs,
             (select count(*) from routers where tenant_id=t.id and status='down') down
      from payments p where p.tenant_id=t.id and p.received_at::date = current_date) x
    join lateral (select phone owner_phone from staff where tenant_id=t.id and role='owner' limit 1) s on true
    where t.id in (${enabledTenants})`, ['ownerBrief']);
  for (const t of rows) {
    await send(t.id, t.owner_phone, 'brief',
      { collected: t.collected, subs: t.new_subs, down: t.down });
  }
}

/** Your SaaS revenue: flat, per active device, or a % of what the tenant collected. */
export async function billTenants() {
  const { rows } = await pool.query(`
    select t.*, (select count(*) from subscribers s
                 where s.tenant_id=t.id and s.status='active') devices,
                (select coalesce(sum(amount),0) from payments p
                 where p.tenant_id=t.id and p.status='applied'
                   and p.received_at >= date_trunc('month', now() - interval '1 month')
                   and p.received_at <  date_trunc('month', now())) collected
    from tenants t where t.status in ('active','readonly')
      and t.id in (${enabledTenants})`, ['billTenants']);
  for (const t of rows) {
    const fee =
      t.plan_type === 'flat'       ? Number(t.plan_amount) :
      t.plan_type === 'per_device' ? Number(t.plan_amount) * Number(t.devices) :
      Math.min(Number(t.collected) * Number(t.revshare_pct) / 100, 120000);
    if (fee <= 0) continue;
    await pool.query(
      `insert into invoices (tenant_id, number, amount, due_date, status)
       values ($1, 'SAAS-' || to_char(now(),'YYMM') || '-' || substr($1::text,1,6), $2, current_date + 5, 'open')
       on conflict do nothing`, [t.id, fee]);
    const { rows: [owner] } = await pool.query(
      "select phone from staff where tenant_id=$1 and role='owner' limit 1", [t.id]);
    if (owner) await daraja.stkPush(process.env.PLATFORM_TENANT_ID,
      { phone: owner.phone, amount: fee, accountRef: t.subdomain, description: 'Platform fee' }).catch(() => {});
  }
}
