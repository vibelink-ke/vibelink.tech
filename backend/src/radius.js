import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Write/refresh the RADIUS check+reply attributes for a subscriber and kick CoA. */
export async function activateSubscriber(c, tenantId, subId) {
  const { rows: [s] } = await c.query(
    `select s.*, p.radius_profile, p.rate_down, p.rate_up, r.host, r.secret
     from subscribers s join plans p on p.id = s.plan_id
     left join routers r on r.id = s.router_id where s.id=$1`, [subId]);

  // radcheck.username is NOT NULL. A subscriber can legitimately have no PPPoE
  // credentials yet (imported from CSV, hotspot-only, not provisioned), and there
  // is nothing to write to RADIUS for them — pushing on would abort the payment
  // that triggered this.
  if (!s?.pppoe_user) return;

  await c.query(
    `insert into radcheck (username, attribute, op, value)
     values ($1,'Cleartext-Password',':=',$2)
     on conflict (username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, s.pppoe_pass]);

  await c.query(
    `insert into radreply (username, attribute, op, value)
     values ($1,'Mikrotik-Rate-Limit',':=',$2)
     on conflict (username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, `${s.rate_up}k/${s.rate_down}k`]);

  if (s.host) await coa(s.host, s.secret, s.pppoe_user, `${s.rate_up}k/${s.rate_down}k`);
}

/**
 * Drop a subscriber to their fair-use speed without cutting the session.
 * Same mechanism as the walled garden: rewrite the reply attribute, then CoA so
 * it takes effect on the live session instead of at next auth.
 */
export async function applyFupThrottle(c, tenantId, subId, downKbps, upKbps) {
  const { rows: [s] } = await c.query(
    'select s.pppoe_user, r.host, r.secret from subscribers s left join routers r on r.id=s.router_id where s.id=$1',
    [subId]);
  if (!s?.pppoe_user) return false;
  const rate = `${upKbps}k/${downKbps}k`;
  await c.query(
    `insert into radreply (username, attribute, op, value) values ($1,'Mikrotik-Rate-Limit',':=',$2)
     on conflict (username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, rate]);
  if (s.host) await coa(s.host, s.secret, s.pppoe_user, rate);
  return true;
}

/** Put a throttled subscriber back on their plan's full rate (new window, or a top-up). */
export async function clearFupThrottle(c, tenantId, subId) {
  const { rows: [s] } = await c.query(
    `select s.pppoe_user, p.rate_down, p.rate_up, r.host, r.secret
     from subscribers s join plans p on p.id = s.plan_id
     left join routers r on r.id = s.router_id where s.id=$1`, [subId]);
  if (!s?.pppoe_user) return false;
  const rate = `${s.rate_up}k/${s.rate_down}k`;
  await c.query(
    `insert into radreply (username, attribute, op, value) values ($1,'Mikrotik-Rate-Limit',':=',$2)
     on conflict (username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, rate]);
  if (s.host) await coa(s.host, s.secret, s.pppoe_user, rate);
  return true;
}

/** Move an expired account to the walled-garden profile without dropping the session. */
export async function walledGarden(c, tenantId, subId) {
  const { rows: [s] } = await c.query(
    'select s.pppoe_user, r.host, r.secret from subscribers s left join routers r on r.id=s.router_id where s.id=$1',
    [subId]);
  if (!s?.pppoe_user) return;   // nothing provisioned in RADIUS to walled-garden
  await c.query("update radreply set value='2048k/2048k' where username=$1 and attribute='Mikrotik-Rate-Limit'",
    [s.pppoe_user]);
  if (s.host) await coa(s.host, s.secret, s.pppoe_user, '2048k/2048k', 'walled');
}

export async function issueVoucherAccess(c, tenantId, planId, phone, mac) {
  const { rows: [plan] } = await c.query('select * from plans where id=$1', [planId]);
  const { rows: [cfg] } = await c.query('select * from hotspot_settings where tenant_id=$1', [tenantId]);
  const prefs = cfg ?? { code_type: 'numeric', code_length: 6, voucher_expiry: 'login' };
  const code = await uniqueCode(c, tenantId, prefs);

  // "creation" starts the clock now; "login" leaves expires_at null until first RADIUS auth.
  const fromCreation = prefs.voucher_expiry === 'creation';
  const expires = fromCreation ? new Date(Date.now() + plan.duration_min * 60000) : null;
  const { rows: [v] } = await c.query(
    `insert into vouchers (tenant_id, code, plan_id, phone, mac, status, starts_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [tenantId, code, planId, phone, mac,
     fromCreation ? 'in_use' : 'unused', fromCreation ? new Date() : null, expires]);
  await c.query(
    `insert into radcheck (username, attribute, op, value) values
       ($1,'Cleartext-Password',':=',$1)`, [code]);
  if (expires) await c.query(
    `insert into radcheck (username, attribute, op, value) values ($1,'Expiration',':=',$2)`,
    [code, expires.toUTCString()]);
  await c.query(
    `insert into radreply (username, attribute, op, value) values
       ($1,'Mikrotik-Rate-Limit',':=',$2),
       ($1,'Session-Timeout',':=',$3)`,
    [code, `${plan.rate_up}k/${plan.rate_down}k`, plan.duration_min * 60]);
  return v;
}

const WORDS = ['maji','jua','moto','ndege','bahari','tembo','simba','nyota','anga','mvua',
               'chui','twiga','pwani','mlima','kaskazi','safari','asali','ziwa'];

/** Honours Hotspot -> Settings -> Preferences: numeric | mixed | words, 4-12 characters. */
export function generateCode({ code_type = 'numeric', code_length = 6 }) {
  const len = Math.max(4, Math.min(12, Number(code_length) || 6));
  if (code_type === 'words') {
    const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
    return `${pick()}-${pick()}`;
  }
  const pool = code_type === 'mixed'
    ? 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'    // no O/0/I/1 — people read these aloud on the phone
    : '0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += pool[Math.floor(Math.random() * pool.length)];
  return out;
}

async function uniqueCode(c, tenantId, prefs) {
  for (;;) {
    const code = generateCode(prefs);
    const { rowCount } = await c.query('select 1 from vouchers where tenant_id=$1 and code=$2', [tenantId, code]);
    if (!rowCount) return code;
  }
}

/** Called on the first successful RADIUS auth when voucher_expiry = 'login'. */
export async function startVoucherClock(c, tenantId, code) {
  await c.query(
    `update vouchers v set status='in_use', starts_at=now(),
            expires_at = now() + (p.duration_min || ' minutes')::interval
     from plans p
     where p.id = v.plan_id and v.tenant_id=$1 and v.code=$2 and v.starts_at is null`,
    [tenantId, code]);
}

async function coa(host, secret, user, rate, mode) {
  const attrs = [`User-Name=${user}`, `Mikrotik-Rate-Limit=${rate}`];
  if (mode === 'walled') attrs.push('Mikrotik-Address-List=walled');
  await run('radclient', ['-x', `${host}:${process.env.RADIUS_COA_PORT}`, 'coa', secret], {
    input: attrs.join('\n') + '\n'
  }).catch(() => {});   // CoA best-effort; next auth picks up the new profile anyway
}
