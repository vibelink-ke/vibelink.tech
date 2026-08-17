import * as coaClient from './coa.js';

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

  if (s.host) await coa(c, s.host, s.secret, s.pppoe_user, `${s.rate_up}k/${s.rate_down}k`);
}

/**
 * Push a subscriber's PPPoE credentials into RADIUS.
 *
 * activateSubscriber() does this too, but only runs on payment or on an explicit
 * "set active" — so a client created in the UI had a username and password in the
 * subscribers table and nothing at all in radcheck. FreeRADIUS cannot authenticate
 * a user it has never heard of, so every fresh client failed to dial in with
 * "authentication failed" while the credentials looked perfectly correct on screen.
 *
 * Deliberately no CoA: there is no live session to modify when credentials are
 * first written, and the CoA would block waiting for a reply that cannot come.
 */
export async function syncSubscriberCredentials(c, tenantId, subId) {
  const { rows: [s] } = await c.query(
    `select s.pppoe_user, s.pppoe_pass, s.static_ip,
            p.rate_down, p.rate_up, p.radius_profile
       from subscribers s left join plans p on p.id = s.plan_id
      where s.id = $1 and s.tenant_id = $2`, [subId, tenantId]);
  if (!s?.pppoe_user || !s.pppoe_pass) return false;

  await c.query(
    `insert into radcheck (username, attribute, op, value)
     values ($1,'Cleartext-Password',':=',$2)
     on conflict (username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, s.pppoe_pass]);

  /**
   * Reply attributes decide what the router does with the session. Anything not
   * sent here has to be configured on the router by hand, per customer, which
   * defeats central billing entirely — so the address and the profile travel
   * with the login rather than living in /ppp/secret on each box.
   *
   * upsert() rather than one statement because an attribute that no longer
   * applies has to be deleted, not left behind: a customer moved off a static
   * IP would otherwise keep being handed the old one forever.
   */
  const upsert = async (attribute, value) => {
    if (value == null || value === '') {
      await c.query('delete from radreply where username=$1 and attribute=$2',
        [s.pppoe_user, attribute]);
      return;
    }
    await c.query(
      `insert into radreply (username, attribute, op, value) values ($1,$2,':=',$3)
       on conflict (username, attribute) do update set value = excluded.value`,
      [s.pppoe_user, attribute, String(value)]);
  };

  // No plan yet means no rate to enforce. A "nullk/nullk" rate limit is rejected
  // by the router and takes the whole login down with it.
  await upsert('Mikrotik-Rate-Limit',
    s.rate_up != null && s.rate_down != null ? `${s.rate_up}k/${s.rate_down}k` : null);

  // The address the system assigned, not one the router invents from its pool.
  // host() strips any prefix length: Framed-IP-Address is a bare address, and
  // sending "10.0.0.5/32" makes the router ignore the attribute silently.
  const { rows: [ip] } = s.static_ip
    ? await c.query('select host($1::inet) as a', [s.static_ip])
    : { rows: [{ a: null }] };
  await upsert('Framed-IP-Address', ip?.a ?? null);

  // Mikrotik-Group selects the PPP profile on the router by name, so the plan's
  // profile is chosen centrally instead of being wired per secret on the box.
  await upsert('Mikrotik-Group', s.radius_profile ?? null);

  return true;
}

/** Remove a username from RADIUS entirely — used when credentials are renamed. */
export async function forgetSubscriberCredentials(c, username) {
  if (!username) return;
  await c.query('delete from radcheck where username=$1', [username]);
  await c.query('delete from radreply where username=$1', [username]);
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
  if (s.host) await coa(c, s.host, s.secret, s.pppoe_user, rate);
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
  if (s.host) await coa(c, s.host, s.secret, s.pppoe_user, rate);
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
  if (s.host) await coa(c, s.host, s.secret, s.pppoe_user, '2048k/2048k', 'walled');
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

/**
 * Push a live speed change to the router.
 *
 * Best-effort by design: the caller is applying a payment or running the fair-use
 * sweep, and radreply is already correct, so the worst case is that the new speed
 * waits for the subscriber to reconnect. But the result is recorded rather than
 * thrown away — a CoA that never works is invisible otherwise, which is exactly
 * how it stayed broken before.
 */
async function coa(c, host, secret, user, rate, mode) {
  // Target the live session if there is one. Without a session id the NAS has to
  // guess which login to change when a subscriber is connected more than once.
  let sessionId;
  try {
    const { rows: [row] } = await c.query(
      `select acctsessionid from radacct
        where username = $1 and acctstoptime is null
        order by acctstarttime desc limit 1`, [user]);
    sessionId = row?.acctsessionid;
  } catch { /* radacct may be empty; CoA on username alone still works */ }

  const result = await coaClient.send({
    host, secret, username: user, rate,
    addressList: mode === 'walled' ? 'walled' : undefined,
    sessionId,
  });

  if (!result.ok) {
    console.warn(`coa: ${user} -> ${rate} failed on ${String(host).split('/')[0]}: ${result.error}`);
  }

  // Kept for the Routers screen, so a silently dead CoA path is visible. The
  // column records whether the router *answered*, which is the thing that breaks
  // wholesale — a NAK means it is listening and the secret matches, and is worth
  // distinguishing from silence even though the change did not apply.
  const answered = result.ok || result.code === 45 /* CoA-NAK */;
  try {
    await c.query(
      `update routers set coa_last_at = now(), coa_last_ok = $2, coa_last_error = $3
        where host = $1`,
      [host, answered, result.ok ? null : String(result.error ?? '').slice(0, 300)]);
  } catch { /* never let bookkeeping break the payment that triggered this */ }

  return result;
}
