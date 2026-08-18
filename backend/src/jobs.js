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
const safely = (name, fn) => async () => {
  const started = Date.now();
  let ok = true;
  let error = null;
  try {
    await fn();
  } catch (e) {
    ok = false;
    error = e?.message ?? String(e);
    console.error(`job ${name} failed:`, error);
  }
  // Recorded so the dashboard can say what ran rather than showing a hardcoded
  // zero. Failures to write the record are swallowed: bookkeeping about a job
  // must never be the thing that breaks the job.
  try {
    await pool.query(
      'insert into job_runs (job, ok, error, ms) values ($1,$2,$3,$4)',
      [name, ok, error?.slice(0, 300) ?? null, Date.now() - started]);
    // Kept for a week. Long enough to see a pattern, short enough that a job
    // running every minute does not grow the table without limit.
    if (Math.random() < 0.02) {
      await pool.query("delete from job_runs where ran_at < now() - interval '7 days'");
    }
  } catch { /* bookkeeping only */ }
};

export function startJobs() {
  cron.schedule('*/5 * * * *', safely('expireAndSuspend', expireAndSuspend));
  cron.schedule('*/15 * * * *', safely('enforceFup', enforceFup));
  cron.schedule('0 6 * * *',  safely('generateInvoices', generateInvoices));
  cron.schedule('0 8,12,18 * * *', safely('autoCharge', autoCharge));
  cron.schedule('0 9 * * *',  safely('remind', remind));
  cron.schedule('*/1 * * * *', safely('watchdog', watchdog));
  cron.schedule('*/10 * * * *', safely('healRouters', healRouters));
  cron.schedule('*/5 * * * *', safely('closeStaleSessions', closeStaleSessions));
  cron.schedule('0 20 * * *', safely('ownerBrief', ownerBrief));
  // Tenant billing is WHMCS's job now. Vibelink used to raise its own SaaS
  // invoices and chase them; two systems invoicing the same customer is how
  // someone gets billed twice and suspended over an invoice they already paid
  // elsewhere. Only licence_ends remains — WHMCS moves it, this acts on it.
  cron.schedule('0 7 * * *',  safely('expireTenantLicences', expireTenantLicences));
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
const OFFLINE_MINUTES = 3;

async function watchdog() {
  const { rows } = await pool.query(
    `select id, tenant_id, name, host, offline_since, offline_notified
       from routers where tenant_id in (${enabledTenants})`, ['watchdog']);

  for (const r of rows) {
    const up = await ping(r.host);

    if (up) {
      await pool.query(
        `update routers set status='up', last_seen=now(),
                offline_since=null, offline_notified=false where id=$1`, [r.id]);
      // Only worth saying if the outage was announced. Reporting the recovery of
      // something nobody was told about is noise.
      if (r.offline_notified) {
        const mins = r.offline_since
          ? Math.round((Date.now() - new Date(r.offline_since)) / 60000) : null;
        await notifyOwner(r.tenant_id,
          `${r.name} is back online${mins ? ` after ${mins} minute${mins === 1 ? '' : 's'}` : ''}.`);
      }
      continue;
    }

    await pool.query(
      `update routers set status='down', offline_since=coalesce(offline_since, now())
        where id=$1`, [r.id]);

    const since = r.offline_since ? new Date(r.offline_since) : new Date();
    if (!r.offline_notified && (Date.now() - since) / 60000 >= OFFLINE_MINUTES) {
      await pool.query('update routers set offline_notified=true where id=$1', [r.id]);
      await notifyOwner(r.tenant_id,
        `${r.name} (${String(r.host).split('/')[0]}) has been unreachable for ${OFFLINE_MINUTES} minutes. `
        + 'Customers on it are offline.');
    }
  }
}

/**
 * Text whoever owns the tenant.
 *
 * Failures are swallowed deliberately: an SMS gateway out of credit must not
 * stop the watchdog checking the rest of the fleet, and the outage is recorded
 * on the router row either way.
 */
async function notifyOwner(tenantId, body) {
  try {
    // The rota number if one is set, otherwise the owner. A tenant with an
    // on-call phone should not have alerts going to whoever signed up.
    const { rows: [pick] } = await pool.query(
      `select coalesce(
                (select nullif(alert_phone,'') from app_settings where tenant_id=$1),
                (select phone from staff where tenant_id=$1 and role='owner'
                  and phone is not null limit 1)) as phone`, [tenantId]);
    if (!pick?.phone) return;
    await send(tenantId, pick.phone, 'custom', { body });
  } catch (e) {
    console.error('watchdog notify failed', tenantId, e.message);
  }
}


/**
 * Put a router's RADIUS back when it drifts.
 *
 * A push that succeeded is not permanent. Somebody edits /radius by hand while
 * chasing a fault, a reset restores an old backup, a secret gets changed on the
 * box — and from then on every customer on that router fails to authenticate
 * while the system reports the last configure as successful. Nothing noticed,
 * and the fix was for an operator to realise and press Configure again.
 *
 * This checks what is actually on the router and re-applies ours when it does
 * not match. Only RADIUS: it is the part whose absence stops every customer
 * getting online, and re-pushing bridges or a hotspot unattended could take a
 * working site off the air.
 *
 * Only routers we already own credentials for. Without a service account there
 * is nothing to log in with, and this must never prompt.
 */
export async function healRouters() {
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  const { SERVER_IP } = await import('./tunnel.js');

  const { rows } = await pool.query(
    `select id, tenant_id, name, host, api_port, role, secret,
            service_user, service_password_enc
       from routers
      where status = 'up'
        and autoconfig_last_ok = true
        and service_user is not null
        and service_password_enc is not null
        and tenant_id in (${enabledTenants})`, ['healRouters']);

  for (const r of rows) {
    const host = String(r.host).split('/')[0];
    let conn;
    try {
      const password = secrets.decrypt(r.service_password_enc);
      if (!password) continue;

      conn = await ros.connect({ host, port: r.api_port ?? 8728, user: r.service_user, password });

      const coaPort = Number(process.env.RADIUS_COA_PORT ?? 3799);
      const { ok } = await ros.radiusCheck(conn, { serverIp: SERVER_IP, secret: r.secret, coaPort });
      if (ok) continue;

      await ros.applyRadius(conn, {
        serverIp: SERVER_IP,
        secret: r.secret,
        coaPort,
        services: r.role === 'both' ? 'ppp,hotspot' : r.role,
      });
      // Accounting travels with it: RADIUS without interim updates reports usage
      // only when a session ends, so fair use sees nothing all day.
      if (r.role === 'both' || r.role === 'pppoe') await ros.applyPpp(conn);
      if (r.role === 'both' || r.role === 'hotspot') {
        await ros.applyHotspot(conn);
        /**
         * The profile every voucher names.
         *
         * A router configured before this profile was created rejects each
         * voucher with "unknown user profile <hs-default>" — the code is right,
         * the password is right, and the guest is refused. Rebuilding it here
         * means a router repairs itself rather than waiting for somebody to
         * notice and press Configure.
         */
        const { rows: [hs] } = await pool.query(
          'select multi_device, idle_timeout_min, bind_mac from hotspot_settings where tenant_id=$1',
          [r.tenant_id]);
        await ros.ensureHotspotUserProfile(conn, {
          sharedUsers: hs?.multi_device ? 3 : 1,
          idleMinutes: hs?.idle_timeout_min ?? 10,
          bindMac: hs?.bind_mac ?? true,
        });
      }

      await pool.query(
        `update routers set autoconfig_last_at = now(), autoconfig_last_ok = true,
                autoconfig_last_error = null where id = $1`, [r.id]);
      console.log('healRouters: restored RADIUS on', r.name, host);
      await notifyOwner(r.tenant_id,
        `${r.name} had lost its RADIUS settings and they have been restored automatically.`);
    } catch (e) {
      // One unreachable router must not stop the rest being checked. Not
      // recorded as a failed configure either: the last real push did succeed,
      // and overwriting that with a transient error would hide it.
      console.error('healRouters:', r.name, host, e.message);
    } finally {
      if (conn) ros.close(conn);
    }
  }
}


/**
 * Close sessions the router stopped talking about.
 *
 * RADIUS accounting only closes a session when the NAS sends Accounting-Stop.
 * A router that loses power, reboots, or has its tunnel cut never sends one, so
 * the row stays open for ever: the customer shows as online, "who is connected"
 * counts them, and an operator looking at an outage sees a screen full of
 * healthy customers.
 *
 * Interim updates arrive every five minutes. Twenty without one is four missed
 * in a row — not a dropped packet, a session that is gone. Stopped at the time
 * of the last update rather than now, so the recorded duration is the truth
 * rather than however long nobody noticed.
 */
async function closeStaleSessions() {
  const { rowCount } = await pool.query(`
    update radacct
       set acctstoptime = coalesce(acctupdatetime, acctstarttime),
           acctterminatecause = 'Lost-Carrier'
     where acctstoptime is null
       and coalesce(acctupdatetime, acctstarttime) < now() - interval '20 minutes'`);
  if (rowCount) console.log(`closed ${rowCount} stale RADIUS session(s)`);
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

/**
 * Act on the licence date, and nothing else.
 *
 *   past its end   read-only — every screen still loads, nothing can be changed
 *   still valid    full access, restored without anyone intervening
 *
 * Read-only rather than shut out: an operator who cannot see who owes them money
 * cannot collect it, and collecting it is how they renew.
 */
export async function expireTenantLicences() {
  await pool.query(`
    update tenants set status='readonly'
     where status='active'
       and licence_ends is not null
       and licence_ends < current_date`);

  await pool.query(`
    update tenants set status='active'
     where status='readonly'
       and (licence_ends is null or licence_ends >= current_date)`);
}
