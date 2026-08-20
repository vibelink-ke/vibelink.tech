import * as coaClient from './coa.js';

/**
 * The hotspot user profile the router push creates.
 *
 * Sent as Mikrotik-Group so a voucher session actually uses it. The profile was
 * being created on every hotspot push and selected by nothing, so the
 * shared-users limit and idle timeout it carries never applied — the router
 * fell back to its own "default" profile and the anti-sharing setting was
 * decoration.
 *
 * Safe to name here, unlike the PPPoE case that had to be removed: this profile
 * is created by ensureHotspotUserProfile on the same push, so it exists on any
 * router the voucher can be used on. Naming a profile the router does not have
 * is what disconnects a session immediately after it authenticates.
 */
const HOTSPOT_PROFILE = 'hs-default';

/** Write/refresh the RADIUS check+reply attributes for a subscriber and kick CoA. */
export async function activateSubscriber(c, tenantId, subId) {
  const { rows: [s] } = await c.query(
    `select s.*, p.radius_profile, p.rate_down, p.rate_up, r.host, r.secret, r.pppoe_pool
     from subscribers s join plans p on p.id = s.plan_id
     left join routers r on r.id = s.router_id where s.id=$1`, [subId]);

  // radcheck.username is NOT NULL. A subscriber can legitimately have no PPPoE
  // credentials yet (imported from CSV, hotspot-only, not provisioned), and there
  // is nothing to write to RADIUS for them — pushing on would abort the payment
  // that triggered this.
  if (!s?.pppoe_user) return;

  await c.query(
    `insert into radcheck (tenant_id, username, attribute, op, value)
     values ($3,$1,'Cleartext-Password',':=',$2)
     on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, s.pppoe_pass, tenantId]);

  const rate = `${s.rate_up}k/${s.rate_down}k`;
  await c.query(
    `insert into radreply (tenant_id, username, attribute, op, value)
     values ($3,$1,'Mikrotik-Rate-Limit',':=',$2)
     on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, rate, tenantId]);

  // Reassigns off the expired pool back onto the normal one if that is where
  // they were parked while suspended/expired/paused — status is already
  // 'active' by the time this runs, so framedAddress reads that back correctly.
  const address = await framedAddress(c, tenantId, subId, s);
  if (address == null) {
    await c.query('delete from radreply where tenant_id=$3 and username=$1 and attribute=$2',
      [s.pppoe_user, 'Framed-IP-Address', tenantId]);
  } else {
    await c.query(
      `insert into radreply (tenant_id, username, attribute, op, value)
       values ($3,$1,'Framed-IP-Address',':=',$2)
       on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
      [s.pppoe_user, address, tenantId]);
  }

  if (s.host) {
    await coa(c, s.host, s.secret, s.pppoe_user, rate);
    // A live session cannot be handed a new Framed-IP-Address by CoA — that
    // attribute only applies at the start of a session — so if they were
    // parked on the expired pool, force a reconnect now rather than leaving
    // them on the old (expired-range) address until they redial on their own.
    if (address && s.static_ip && String(s.static_ip).split('/')[0] !== address) {
      await coa(c, s.host, s.secret, s.pppoe_user, rate, undefined, true);
    }
  }
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
            p.rate_down, p.rate_up, p.radius_profile,
            r.pppoe_pool
       from subscribers s
       left join plans p on p.id = s.plan_id
       left join routers r on r.id = s.router_id
      where s.id = $1 and s.tenant_id = $2`, [subId, tenantId]);
  if (!s?.pppoe_user || !s.pppoe_pass) return false;

  await c.query(
    `insert into radcheck (tenant_id, username, attribute, op, value)
     values ($3,$1,'Cleartext-Password',':=',$2)
     on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, s.pppoe_pass, tenantId]);

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
      await c.query('delete from radreply where tenant_id=$3 and username=$1 and attribute=$2',
        [s.pppoe_user, attribute, tenantId]);
      return;
    }
    await c.query(
      `insert into radreply (tenant_id, username, attribute, op, value) values ($4,$1,$2,':=',$3)
       on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
      [s.pppoe_user, attribute, String(value), tenantId]);
  };

  // No plan yet means no rate to enforce. A "nullk/nullk" rate limit is rejected
  // by the router and takes the whole login down with it.
  await upsert('Mikrotik-Rate-Limit',
    s.rate_up != null && s.rate_down != null ? `${s.rate_up}k/${s.rate_down}k` : null);

  /**
   * The address the system assigned — but only if the router can give it out.
   *
   * Framed-IP-Address for an address outside the router's pool is not ignored.
   * The router assigns it, finds it collides with one of its own interfaces,
   * and terminates the session a second after authenticating: "logged in,
   * 192.168.0.110" followed immediately by "terminating...". That reads as a
   * credentials problem and is not one.
   *
   * So an address the router cannot serve is dropped rather than sent, and the
   * subscriber gets one from the pool. Losing a preferred address is a far
   * smaller harm than a line that authenticates and will not stay up.
   *
   * host() strips any prefix length: the attribute is a bare address, and
   * "10.0.0.5/32" is discarded by the router without complaint.
   */
  const address = await framedAddress(c, tenantId, subId, s);
  await upsert('Framed-IP-Address', address);

  /**
   * Mikrotik-Group is deliberately NOT sent.
   *
   * It names a PPP profile that must already exist on the router. plans.
   * radius_profile holds generated labels like "pppoe-Home 10 Mbps" which exist
   * only in this database, so the router accepted the login, failed to find the
   * profile, and dropped the session immediately — the log showed a clean
   * "Login OK" every thirty seconds while the customer never got online. An
   * authentication that succeeds and a session that dies look nothing alike in
   * the log and identical to the person dialling.
   *
   * Nothing is lost by omitting it: the PPPoE server we push sets
   * default-profile, which carries the address pool and gateway, and the speed
   * arrives per-user in Mikrotik-Rate-Limit above. Removing any value written by
   * an earlier version, so upgrading clears the bad attribute.
   */
  await upsert('Mikrotik-Group', null);

  return true;
}

/**
 * The address this line should be given, allocated here rather than by the router.
 *
 * The router no longer keeps a PPPoE pool: addresses come from the pool the
 * operator defined under Networks, handed out one per subscriber in
 * Framed-IP-Address. That way the system knows who holds which address — it can
 * be shown on the Clients page and looked up when somebody rings — and two
 * routers cannot hand the same address to different people.
 *
 * An address already assigned to this subscriber is kept. Renumbering a working
 * line every time its credentials are rewritten would drop the session and
 * break anything pointed at it.
 */
/**
 * Suspended/expired/paused subscribers are allocated from a separate pool —
 * see "expired pools" below — so the whole range can be dropped by one static
 * firewall rule instead of the router needing to know who, individually, is
 * cut off.
 */
async function framedAddress(c, tenantId, subId, s) {
  const purpose = ['expired', 'suspended', 'paused'].includes(s.status) ? 'expired' : 'normal';

  const poolFor = async (p) => {
    const { rows: [row] } = await c.query(
      `select cidr from ip_pools
        where tenant_id=$1 and service='pppoe' and purpose=$2
        order by (router_id is not null) desc limit 1`, [tenantId, p]);
    return row;
  };

  // A tenant who has not set aside a dedicated expired-customers range yet
  // still needs an address to hand out — falling back to the normal pool costs
  // them the IP-range block, not connectivity outright. Mikrotik-Rate-Limit
  // still applies regardless of which pool answered.
  const pool = (await poolFor(purpose)) ?? (purpose === 'expired' ? await poolFor('normal') : null);
  if (!pool) return null;

  // Whatever they already hold, provided it is still inside both the router's
  // servable range and the pool that matches their current purpose — a
  // customer moving from active to expired (or back) must not simply keep an
  // address from the other range.
  if (s.static_ip) {
    const { rows: [held] } = await c.query('select host($1::inet) as a', [s.static_ip]);
    if (held?.a && inPool(held.a, s.pppoe_pool) && inPool(held.a, pool.cidr)) return held.a;
  }

  /**
   * The lowest address in the pool nobody else holds.
   *
   * generate_series over the range, minus what is taken. Skips the first two —
   * the network address and the gateway — and never returns the broadcast.
   * Postgres does the set arithmetic because doing it here would mean pulling
   * every subscriber into memory to place one customer.
   */
  const { rows: [free] } = await c.query(
    `with bounds as (
       select set_masklen($1::cidr, masklen($1::cidr)) as net,
              broadcast($1::cidr) as bcast
     ),
     candidates as (
       select (network(b.net) + n)::inet as addr
         from bounds b,
              generate_series(2, least(broadcast(b.net) - network(b.net) - 1, 65534)) as n
     )
     -- Compared as text, not as inet.
     --
     -- network(net) + n carries the pool's prefix, so the candidate is
     -- 192.168.0.2/16 while the stored address is 192.168.0.2/32 — and inet
     -- equality includes the prefix length, so the two never matched. Every
     -- subscriber was handed 192.168.0.2, which is the one failure mode this
     -- allocation exists to prevent.
     select host(addr) as a from candidates
      where host(addr) not in (
        select host(static_ip) from subscribers
         where tenant_id=$2 and static_ip is not null and id <> $3)
      limit 1`, [pool.cidr, tenantId, subId]);
  if (!free?.a) return null;

  // Recorded on the subscriber, so the same line keeps the same address and the
  // next allocation can see it is taken.
  await c.query('update subscribers set static_ip=$2 where id=$1', [subId, free.a]);
  return free.a;
}

/**
 * Is this address one the router's PPPoE pool can hand out?
 *
 * RouterOS pool ranges look like "10.100.0.2-10.100.255.254". Comparing as
 * 32-bit integers handles ranges that straddle octet boundaries, which a
 * string or per-octet comparison gets wrong.
 *
 * An unknown pool means the router has not been configured through us yet. The
 * address is refused in that case: assigning one the router may not own is what
 * causes the session to be dropped, and a subscriber on a pool address works
 * while a subscriber on a rejected one does not connect at all.
 */
function inPool(address, poolRange) {
  if (!address || !poolRange) return false;
  const toInt = (ip) => {
    const parts = String(ip).trim().split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };

  const value = toInt(address);
  if (value === null) return false;

  // Two shapes reach this: a RouterOS range ("10.100.0.2-10.100.255.254") and
  // a CIDR from the Networks page ("192.168.0.0/16"), since addresses are now
  // allocated from the latter. Several may be listed, comma separated.
  return String(poolRange).split(',').some((part) => {
    const piece = part.trim();

    if (piece.includes('/')) {
      const [base, bits] = piece.split('/');
      const start = toInt(base);
      const width = Number(bits);
      if (start === null || !Number.isInteger(width) || width < 0 || width > 32) return false;
      const mask = width === 0 ? 0 : (0xffffffff << (32 - width)) >>> 0;
      const net = (start & mask) >>> 0;
      const bcast = (net | (~mask >>> 0)) >>> 0;
      return value >= net && value <= bcast;
    }

    const [from, to] = piece.split('-').map((x) => toInt(x));
    if (from === null) return false;
    return value >= from && value <= (to ?? from);
  });
}

/** Remove a username from RADIUS entirely — used when credentials are renamed. */
export async function forgetSubscriberCredentials(c, username, tenantId) {
  if (!username) return;
  // Scoped: another tenant may legitimately have the same username, and
  // renaming one customer must not sign out somebody else's.
  await c.query('delete from radcheck where username=$1 and tenant_id=$2', [username, tenantId]);
  await c.query('delete from radreply where username=$1 and tenant_id=$2', [username, tenantId]);
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
    `insert into radreply (tenant_id, username, attribute, op, value)
     values ($3,$1,'Mikrotik-Rate-Limit',':=',$2)
     on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, rate, tenantId]);
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
    `insert into radreply (tenant_id, username, attribute, op, value)
     values ($3,$1,'Mikrotik-Rate-Limit',':=',$2)
     on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, rate, tenantId]);
  if (s.host) await coa(c, s.host, s.secret, s.pppoe_user, rate);
  return true;
}

// RouterOS treats a literal 0 as "no limit" — the opposite of a cut-off
// account — so this is the practical floor: a page will not load, which is
// the point. Real blocking is the firewall filter rule against the
// expired-customers address list (see applyExpiredPool in routeros.js); this
// is only the fallback for a tenant who has not provisioned that rule yet.
const EXPIRED_RATE = '1k/1k';

/** Move a suspended/expired/paused subscriber onto the expired pool at effectively zero speed. */
export async function walledGarden(c, tenantId, subId) {
  const { rows: [s] } = await c.query(
    `select s.*, r.host, r.secret, r.pppoe_pool
       from subscribers s left join routers r on r.id = s.router_id where s.id=$1`, [subId]);
  if (!s?.pppoe_user) return;   // nothing provisioned in RADIUS to walled-garden

  await c.query(
    `insert into radreply (tenant_id, username, attribute, op, value)
     values ($3,$1,'Mikrotik-Rate-Limit',':=',$2)
     on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
    [s.pppoe_user, EXPIRED_RATE, tenantId]);

  // Framed-IP-Address here moves them into the expired pool (or clears it, if
  // no dedicated pool is configured and none is free) — see framedAddress.
  const address = await framedAddress(c, tenantId, subId, s);
  if (address == null) {
    await c.query('delete from radreply where tenant_id=$3 and username=$1 and attribute=$2',
      [s.pppoe_user, 'Framed-IP-Address', tenantId]);
  } else {
    await c.query(
      `insert into radreply (tenant_id, username, attribute, op, value)
       values ($3,$1,'Framed-IP-Address',':=',$2)
       on conflict (tenant_id, username, attribute) do update set value = excluded.value`,
      [s.pppoe_user, address, tenantId]);
  }

  if (s.host) {
    // The address-list attribute takes effect on the live session immediately;
    // the disconnect (if the pool actually changed) is what makes the new
    // Framed-IP-Address apply without waiting for them to redial on their own.
    await coa(c, s.host, s.secret, s.pppoe_user, EXPIRED_RATE, 'expired');
    if (address && s.static_ip && String(s.static_ip).split('/')[0] !== address) {
      await coa(c, s.host, s.secret, s.pppoe_user, EXPIRED_RATE, undefined, true);
    }
  }
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
    `insert into radcheck (tenant_id, username, attribute, op, value) values
       ($2,$1,'Cleartext-Password',':=',$1)`, [code, tenantId]);
  if (expires) await c.query(
    `insert into radcheck (tenant_id, username, attribute, op, value)
     values ($3,$1,'Expiration',':=',$2)`,
    [code, expires.toUTCString(), tenantId]);
  await c.query(
    `insert into radreply (tenant_id, username, attribute, op, value) values
       ($4,$1,'Mikrotik-Rate-Limit',':=',$2),
       ($4,$1,'Session-Timeout',':=',$3),
       ($4,$1,'Mikrotik-Group',':=',$5)`,
    [code, `${plan.rate_up}k/${plan.rate_down}k`, plan.duration_min * 60, tenantId,
     HOTSPOT_PROFILE]);
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

/**
 * Called on the first successful RADIUS auth when voucher_expiry = 'login',
 * and on every /api/presence/refresh for a voucher already seen active — the
 * second path exists to backfill vouchers whose clock started before this
 * function wrote Expiration at all.
 *
 * Session-Timeout is already set on every voucher at creation (issueVoucherAccess,
 * above) and cuts a session off after plan.duration_min — but only *that one
 * session*. It does not stop a re-authentication: nothing here checked an
 * absolute expiry before now, so a guest whose Wi-Fi dropped and reconnected —
 * a sleeping phone waking up, walking out of range and back, a manual toggle —
 * got a brand new full-duration Session-Timeout window, indefinitely, on the
 * same voucher. "This voucher shows expired but is still online" was that:
 * our own status was accurate, RouterOS's per-session cutoff was doing its
 * job, and the gap was that nothing stopped the *next* login from succeeding.
 *
 * Writing Expiration here — the same absolute-timestamp attribute
 * issueVoucherAccess already writes for voucher_expiry='creation' vouchers —
 * closes it: FreeRADIUS's `expiration` module runs in authorize{} on every
 * attempt and rejects one made after this timestamp, voucher code correct or
 * not. 'login' mode could not set this at creation because the clock had not
 * started yet; now that it has, the same guarantee applies from here on.
 *
 * A voucher whose clock already started before this fix existed would never
 * hit the branch below that writes it — starts_at was already set, so the
 * "first auth" UPDATE never matched again, and the guest that voucher
 * belongs to would keep the reconnect loophole open forever, deploy or not.
 * So this also runs for any 'in_use' voucher missing Expiration regardless
 * of whether its clock is new, using its *existing* expires_at rather than
 * recomputing one — recomputing here would silently give them a fresh full
 * duration on every presence check, which is the exact bug this exists to
 * close, not reopen.
 */
export async function startVoucherClock(c, tenantId, code) {
  const { rows: [v] } = await c.query(
    `update vouchers v set status='in_use', starts_at=now(),
            expires_at = now() + (p.duration_min || ' minutes')::interval
     from plans p
     where p.id = v.plan_id and v.tenant_id=$1 and v.code=$2 and v.starts_at is null
     returning v.expires_at`,
    [tenantId, code]);

  // Either the clock just started (v is the row above), or it was already
  // running — in which case use its existing expiry rather than inventing
  // one, and skip entirely if it has none (voucher_expiry='creation' already
  // wrote Expiration at issue, or the code does not exist / is not active).
  const expiresAt = v?.expires_at ?? (
    await c.query(
      "select expires_at from vouchers where tenant_id=$1 and code=$2 and status='in_use' and expires_at is not null",
      [tenantId, code])
  ).rows[0]?.expires_at;
  if (!expiresAt) return;

  const { rowCount } = await c.query(
    "select 1 from radcheck where tenant_id=$1 and username=$2 and attribute='Expiration'",
    [tenantId, code]);
  if (!rowCount) {
    await c.query(
      `insert into radcheck (tenant_id, username, attribute, op, value) values
         ($1,$2,'Expiration',':=',$3)`,
      [tenantId, code, new Date(expiresAt).toUTCString()]);
  }
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
async function coa(c, host, secret, user, rate, mode, disconnect = false) {
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
    // Matches the static address-list name applyExpiredPool provisions on the
    // router, so a session moved here right now (before it reconnects onto the
    // expired pool's own range) still hits the same firewall filter rule.
    addressList: mode === 'expired' ? 'expired-customers' : undefined,
    sessionId,
    disconnect,
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
