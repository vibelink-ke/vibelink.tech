import axios from 'axios';
import { pool } from './db.js';

/**
 * TR-069 (CWMP): a router or ONU calls our own ACS (GenieACS, run alongside this app — see docker-compose's
 * `genieacs`/`mongo` services) and we read and write its settings without anyone touching the device.
 *
 * One ACS serves every tenant on this box; a device is not GenieACS's to know whose customer it is, so that
 * linking is ours, the same way smartolt.js links a SmartOLT ONU to a subscriber — by serial number first,
 * matched against subscribers.tr069_serial (set by hand, or by a customer's own device once it has been seen).
 *
 * A device's data model is TR-098 (`InternetGatewayDevice.*`, older CPE) or TR-181 (`Device.*`, newer). Both are
 * tried; whichever the device actually has wins and is remembered so later calls do not have to guess again.
 *
 * GenieACS's own NBI (the REST API this talks to) needs no authentication by default — it is never reached from
 * outside this compose network, only the API container ever calls it.
 */

const NBI = process.env.GENIEACS_NBI_URL ?? 'http://genieacs:7557';
const CONNECTION_TIMEOUT_MS = 8000;   // how long a task waits for the device to actually answer, before it is left queued

async function nbi(method, path, { params, data } = {}) {
  const res = await axios({
    method, url: `${NBI}${path}`, params, data,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    timeout: 20000,
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new Error(typeof res.data === 'string' ? res.data.slice(0, 300) : (res.data?.message ?? `GenieACS answered ${res.status}`));
  }
  return res.data;
}

const first = (obj, ...paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v?._value !== undefined) return v._value;
  }
  return null;
};

/** GenieACS's own device id is "OUI-ProductClass-SerialNumber" with each part percent-escaped. */
const idOf = (d) => d._id;

function readDevice(d) {
  const igd = 'InternetGatewayDevice';
  const dev = 'Device';
  const dataModel = d[dev] ? 'tr181' : d[igd] ? 'tr098' : null;
  const wlan1 = dataModel === 'tr181'
    ? first(d, 'Device.WiFi.SSID.1.SSID')
    : first(d, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID');
  const wanIp = dataModel === 'tr181'
    ? first(d, 'Device.IP.Interface.1.IPv4Address.1.IPAddress')
    : first(d, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
               'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress');
  const connected = dataModel === 'tr181'
    ? Number(first(d, 'Device.Hosts.HostNumberOfEntries')) || null
    : Number(first(d, 'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries')) || null;
  /**
   * GenieACS's own _deviceId struct — populated from every single Inform's DeviceId (Manufacturer, OUI,
   * ProductClass, SerialNumber), so it is there from the device's very first contact, before anything has
   * asked it for its DeviceInfo.* parameter tree. Its own leaf keys are underscore-prefixed
   * (_Manufacturer/_OUI/_ProductClass/_SerialNumber) — not the same shape as a TR-069 parameter object
   * (which is why `first()`, built for {_value: ...} leaves, cannot read it) and there is no
   * "DeviceID.SerialNumber" parameter in either data model to fall back through; that used to be tried
   * first and could never match anything. Confirmed live: every device this ACS had actually heard from
   * showed a blank Device/Serial in "Waiting to be linked" until this read the right keys — last_inform
   * (a different, correctly-named top-level field) was the only thing that was ever populating.
   */
  return {
    genieacsId: idOf(d),
    serial: d._deviceId?._SerialNumber ?? first(d, 'Device.DeviceInfo.SerialNumber', 'InternetGatewayDevice.DeviceInfo.SerialNumber') ?? null,
    oui: d._deviceId?._OUI ?? null,
    manufacturer: d._deviceId?._Manufacturer ?? first(d, 'Device.DeviceInfo.Manufacturer', 'InternetGatewayDevice.DeviceInfo.Manufacturer'),
    productClass: d._deviceId?._ProductClass ?? null,
    modelName: first(d, 'Device.DeviceInfo.ModelName', 'InternetGatewayDevice.DeviceInfo.ModelName'),
    softwareVersion: first(d, 'Device.DeviceInfo.SoftwareVersion', 'InternetGatewayDevice.DeviceInfo.SoftwareVersion'),
    lastInform: d._lastInform ?? null,
    ssid: wlan1,
    wanIp,
    connectedClients: connected,
    dataModel,
  };
}

/** Every device GenieACS currently knows about. */
async function listDevices() {
  const rows = await nbi('GET', '/devices');
  return (rows ?? [])
    // GenieACS's own internal STUN/connection-request discovery helper shows up in /devices
    // alongside real CPEs, with an id like "DISCOVERYSERVICE-DISCOVERYSERVICE-<random>" — it is not
    // a router anyone owns and will never have a manufacturer, model or serial, so keeping it meant
    // it sat in "Waiting to be linked" forever, permanently unmatchable, cluttering a list meant for
    // actual customer devices.
    .filter((d) => !String(d._id ?? '').startsWith('DISCOVERYSERVICE-'))
    .map(readDevice);
}

/** Pull GenieACS's device list into our own table, tenant-unaware (see matchDevices for that half). */
export async function syncDevices() {
  // Rows written before listDevices() started filtering the discovery-service placeholder out — a plain
  // sync (insert/update only) never removes anything, so these would otherwise sit in "Waiting to be
  // linked" forever. Harmless to run every pass: there is nothing to delete once the first one has.
  await pool.query("delete from tr069_devices where genieacs_id like 'DISCOVERYSERVICE-%'");
  const devices = await listDevices();
  for (const d of devices) {
    if (!d.genieacsId) continue;
    await pool.query(
      `insert into tr069_devices (genieacs_id, serial_number, oui, product_class, manufacturer, model_name,
                                   software_version, last_inform, ssid, wan_ip, connected_clients, data_model, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       on conflict (genieacs_id) do update set
         serial_number=excluded.serial_number, oui=excluded.oui, product_class=excluded.product_class,
         manufacturer=excluded.manufacturer, model_name=excluded.model_name, software_version=excluded.software_version,
         last_inform=excluded.last_inform, ssid=excluded.ssid, wan_ip=excluded.wan_ip,
         connected_clients=excluded.connected_clients,
         data_model=coalesce(tr069_devices.data_model, excluded.data_model), updated_at=now()`,
      [d.genieacsId, d.serial, d.oui, d.productClass, d.manufacturer, d.modelName, d.softwareVersion,
        d.lastInform ? new Date(d.lastInform) : null, d.ssid, d.wanIp, d.connectedClients, d.dataModel]);
  }
  return { seen: devices.length };
}

/**
 * Link unmatched devices to this tenant's subscribers by serial number — set by hand on the subscriber
 * (Edit → TR-069 serial) or, once a device has been seen, offered as a suggestion to confirm. Only an exact,
 * unique serial match links automatically; anything else is left for a person under "Waiting to be linked".
 */
export async function matchDevices(tenantId) {
  const { rows: subs } = await pool.query(
    `select id, name, account_code, tr069_serial from subscribers
      where tenant_id=$1 and tr069_serial is not null and tr069_serial <> ''`, [tenantId]);
  if (!subs.length) return { linked: 0 };
  const bySerial = new Map(subs.map((s) => [String(s.tr069_serial).toLowerCase(), s]));

  const { rows: devices } = await pool.query(
    `select genieacs_id, serial_number from tr069_devices where tenant_id is null and serial_number is not null`);
  let linked = 0;
  for (const d of devices) {
    const s = bySerial.get(String(d.serial_number).toLowerCase());
    if (!s) continue;
    await pool.query(
      `update tr069_devices set tenant_id=$2, subscriber_id=$3 where genieacs_id=$1 and tenant_id is null`,
      [d.genieacs_id, tenantId, s.id]);
    linked += 1;
  }
  return { linked };
}

/** This tenant's devices, with the subscriber they belong to (if linked). */
export async function tenantDevices(tenantId) {
  const { rows } = await pool.query(
    `select d.*, s.name as subscriber_name, s.account_code, s.phone
       from tr069_devices d left join subscribers s on s.id = d.subscriber_id
      where d.tenant_id=$1 order by coalesce(d.last_inform, d.updated_at) desc`, [tenantId]);
  return rows;
}

/** Devices GenieACS has heard from that belong to no tenant yet — the other side of matchDevices. */
export async function unmatchedDevices() {
  const { rows } = await pool.query(
    `select genieacs_id, serial_number, manufacturer, model_name, last_inform
       from tr069_devices where tenant_id is null order by last_inform desc nulls last limit 200`);
  return rows;
}

async function deviceRow(tenantId, id) {
  const { rows: [d] } = await pool.query(
    'select * from tr069_devices where id=$1 and tenant_id=$2', [id, tenantId]);
  if (!d) throw new Error('No such device.');
  return d;
}

/** Manually tie a device (by its own row id here) to a subscriber, overriding automatic matching. */
export async function linkDevice(tenantId, id, subscriberId) {
  const { rows: [s] } = await pool.query('select id from subscribers where id=$1 and tenant_id=$2', [subscriberId, tenantId]);
  if (!s) throw new Error('No such client.');
  await pool.query('update tr069_devices set tenant_id=$2, subscriber_id=$3 where id=$1', [id, tenantId, subscriberId]);
}

export async function claimUnmatched(tenantId, genieacsId, subscriberId) {
  const { rows: [s] } = await pool.query('select id from subscribers where id=$1 and tenant_id=$2', [subscriberId, tenantId]);
  if (!s) throw new Error('No such client.');
  const { rowCount } = await pool.query(
    'update tr069_devices set tenant_id=$2, subscriber_id=$3 where genieacs_id=$1 and tenant_id is null',
    [genieacsId, tenantId, subscriberId]);
  if (!rowCount) throw new Error('That device has already been claimed.');
}

/** One task, with a connection request so it is tried at once rather than waiting for the device's own next check-in. */
async function runTask(genieacsId, task) {
  return nbi('POST', `/devices/${encodeURIComponent(genieacsId)}/tasks`, {
    params: { connection_request: '', timeout: CONNECTION_TIMEOUT_MS },
    data: task,
  });
}

const paramPaths = (dataModel) => (dataModel === 'tr181' ? {
  ssid: 'Device.WiFi.SSID.1.SSID',
  ssid5: 'Device.WiFi.SSID.2.SSID',
  wifiPass: 'Device.WiFi.AccessPoint.1.Security.KeyPassphrase',
  wifiPass5: 'Device.WiFi.AccessPoint.2.Security.KeyPassphrase',
  pppUser: 'Device.PPP.Interface.1.Username',
  pppPass: 'Device.PPP.Interface.1.Password',
} : {
  ssid: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
  ssid5: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
  wifiPass: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
  wifiPass5: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase',
  pppUser: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
  pppPass: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password',
});

/**
 * Every parameter path here is the common case for a router advertising TR-098 or TR-181 (see docs/tr069-research.md).
 * A vendor whose instance numbers differ (WLANConfiguration.2 rather than .1, a second WAN device, …) will need its
 * own preset rather than this generic one — this is the starting point, not guaranteed to fit every model on the
 * network untested.
 */
export async function setWifi(tenantId, id, { ssid, password, band5 = false }) {
  const d = await deviceRow(tenantId, id);
  if (!d.data_model) throw new Error('This device has not told us its settings shape yet — try Refresh status first.');
  const p = paramPaths(d.data_model);
  const values = [[p.ssid, ssid, 'xsd:string'], [p.wifiPass, password, 'xsd:string']];
  if (band5) values.push([p.ssid5, `${ssid}_5G`, 'xsd:string'], [p.wifiPass5, password, 'xsd:string']);
  await runTask(d.genieacs_id, { name: 'setParameterValues', parameterValues: values });
  await pool.query('update tr069_devices set ssid=$2, updated_at=now() where id=$1', [id, ssid]);
}

export async function setPppoe(tenantId, id, { username, password }) {
  const d = await deviceRow(tenantId, id);
  if (!d.data_model) throw new Error('This device has not told us its settings shape yet — try Refresh status first.');
  const p = paramPaths(d.data_model);
  await runTask(d.genieacs_id, {
    name: 'setParameterValues',
    parameterValues: [[p.pppUser, username, 'xsd:string'], [p.pppPass, password, 'xsd:string']],
  });
}

export async function reboot(tenantId, id) {
  const d = await deviceRow(tenantId, id);
  await runTask(d.genieacs_id, { name: 'reboot' });
}

export async function factoryReset(tenantId, id) {
  const d = await deviceRow(tenantId, id);
  await runTask(d.genieacs_id, { name: 'factoryReset' });
}

/** Re-reads the device now (connection request + refreshObject), then re-syncs our copy of it. */
export async function refresh(tenantId, id) {
  const d = await deviceRow(tenantId, id);
  await runTask(d.genieacs_id, { name: 'getParameterValues', parameterNames: ['Device.', 'InternetGatewayDevice.'] })
    .catch(() => runTask(d.genieacs_id, { name: 'refreshObject', objectName: '' }));
  const [fresh] = (await nbi('GET', '/devices', { params: { query: JSON.stringify({ _id: d.genieacs_id }) } })) ?? [];
  if (!fresh) return;
  const r = readDevice(fresh);
  await pool.query(
    `update tr069_devices set ssid=$2, wan_ip=$3, connected_clients=$4, data_model=coalesce(data_model,$5),
            software_version=$6, last_inform=$7, updated_at=now() where id=$1`,
    [id, r.ssid, r.wanIp, r.connectedClients, r.dataModel, r.softwareVersion, r.lastInform ? new Date(r.lastInform) : null]);
}

/**
 * A device that has just called in for the first time, matched to a subscriber (by tr069_serial), and never
 * provisioned before: send it the subscriber's PPPoE login (if it has one) and a WiFi name/password (made up if
 * the subscriber has none saved), then text the customer the WiFi details — the same idea as the SmartOLT
 * authorise flow's automatic setup, for a device that reaches us over TR-069 instead of over an OLT.
 */
export async function autoProvisionNew(tenantId) {
  const { rows } = await pool.query(
    `select d.id, d.genieacs_id, d.data_model, s.id as subscriber_id, s.name, s.phone, s.pppoe_user, s.pppoe_pass
       from tr069_devices d join subscribers s on s.id = d.subscriber_id
      where d.tenant_id=$1 and d.provisioned_at is null and d.data_model is not null`, [tenantId]);
  let done = 0;
  for (const d of rows) {
    try {
      const ssid = String(d.name ?? '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 24) || 'Vibelink';
      const password = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase();
      await setWifi(tenantId, d.id, { ssid, password });
      if (d.pppoe_user) await setPppoe(tenantId, d.id, { username: d.pppoe_user, password: d.pppoe_pass });
      await pool.query('update tr069_devices set provisioned_at=now() where id=$1', [d.id]);
      if (d.phone) {
        const { send } = await import('./sms.js');
        const first0 = String(d.name ?? '').trim().split(/\s+/)[0];
        await send(tenantId, d.phone, 'custom', {
          body: `Hello${first0 ? ` ${first0}` : ''}, your router is set up. WiFi name: ${ssid}  Password: ${password}. Please keep these safe.`,
        }).catch(() => {});
      }
      done += 1;
    } catch (e) {
      console.warn('tr069 autoProvisionNew:', d.genieacs_id, '—', e.message);
    }
  }
  return { provisioned: done };
}
