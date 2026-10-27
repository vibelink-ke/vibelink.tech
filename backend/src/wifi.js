/**
 * Changing a customer's WiFi name and password, from the customer's own page and from the technician app.
 *
 * Two kinds of customer equipment can be reached: a router that calls our own TR-069 ACS (tr069.js), and an ONU managed through SmartOLT (smartolt.js).
 * Whichever the customer's account is linked to is used; SmartOLT's is tried when both are. A customer with neither has nothing we can change from here.
 */
import { pool } from './db.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/** What may be typed: a name of 1 to 32 characters and a password of 8 to 63, printable ASCII (what WPA2 allows). */
export function checkWifi({ ssid, password }) {
  const name = String(ssid ?? '').trim();
  const pass = String(password ?? '');
  if (!name || name.length > 32 || /[^\x20-\x7E]/.test(name)) throw bad('The WiFi name must be 1 to 32 letters, digits or common symbols.');
  if (pass.length < 8 || pass.length > 63 || /[^\x20-\x7E]/.test(pass)) throw bad('The WiFi password must be 8 to 63 letters, digits or common symbols.');
  return { ssid: name, password: pass };
}

/** The equipment this account's WiFi can be changed on: { kind, ... } or null. */
export async function wifiTarget(tenantId, subscriberId) {
  // A business customer is FTTB (served from the building's shared equipment, an individual one is FTTH with an ONU of their own): there is no WiFi of their own to change here.
  const { rows: [kind] } = await pool.query('select category from subscribers where tenant_id=$1 and id=$2', [tenantId, subscriberId]).catch(() => ({ rows: [] }));
  if (/^business/i.test(kind?.category ?? '')) return null;
  const { rows: [dev] } = await pool.query(
    'select id, ssid, data_model from tr069_devices where tenant_id=$1 and subscriber_id=$2 and data_model is not null order by updated_at desc nulls last limit 1',
    [tenantId, subscriberId]).catch(() => ({ rows: [] }));
  const { rows: [onu] } = await pool.query(
    'select external_id, olt_id, name from smartolt_onus where tenant_id=$1 and subscriber_id=$2 order by updated_at desc nulls last limit 1',
    [tenantId, subscriberId]).catch(() => ({ rows: [] }));
  if (onu) return { kind: 'smartolt', externalId: onu.external_id, oltId: onu.olt_id, ssid: dev?.ssid ?? null };
  if (dev) return { kind: 'tr069', deviceId: dev.id, ssid: dev.ssid ?? null };
  return null;
}

// A change can be asked for a handful of times an hour per account: it reconfigures the customer's router, and a stuck page must not hammer it.
const recent = new Map();
function throttle(key) {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 3600000);
  if (list.length >= 5) throw bad('The WiFi has been changed several times in the last hour. Try again later.', 429);
  list.push(now);
  recent.set(key, list);
}

/** Change the WiFi. `by` names who asked (shown in the account's activity). Returns { ok, kind }. */
export async function changeWifi(tenantId, subscriberId, input, by = 'staff') {
  const { ssid, password } = checkWifi(input);
  const band5 = !!input.band5;
  const target = await wifiTarget(tenantId, subscriberId);
  if (!target) throw bad('We cannot change the WiFi on this connection from here. Contact support.', 409);
  throttle(`${tenantId}:${subscriberId}`);
  if (target.kind === 'smartolt') {
    const { setWifiOnOnu } = await import('./smartolt.js');
    await setWifiOnOnu(tenantId, target, { ssid, password, band5 });
  } else {
    const { setWifi } = await import('./tr069.js');
    await setWifi(tenantId, target.deviceId, { ssid, password, band5 });
  }
  const { rows: [s] } = await pool.query('select account_code from subscribers where tenant_id=$1 and id=$2', [tenantId, subscriberId]);
  await pool.query(
    `insert into activity_log (tenant_id, subscriber_id, account_code, actor, action, detail) values ($1,$2,$3,$4,'WiFi changed',$5)`,
    [tenantId, subscriberId, s?.account_code ?? null, by, `WiFi name set to "${ssid}"${band5 ? ' (and 5 GHz)' : ''} by ${by}`]).catch(() => {});
  return { ok: true, kind: target.kind };
}
