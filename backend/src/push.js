import crypto from 'node:crypto';
import webpush from 'web-push';
import { pool } from './db.js';

/**
 * Web Push — a router-down alert, an SLA breach, a stuck payment, reaching a
 * staff member's phone (or laptop) even with the tab closed, the same way a
 * native app's notifications do. No app store, no APK: this is what makes an
 * installed PWA worth installing rather than just a bookmark.
 *
 * VAPID identifies this server to the browser's push service (Chrome's,
 * Firefox's) without per-message auth — one keypair for the whole platform,
 * not per tenant. Unset in an environment that has not generated one yet:
 * every call below then simply does nothing, the same "not configured, so
 * skip rather than fail" shape as an SMS gateway with no credentials.
 */
const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(
    `mailto:${process.env.ACME_EMAIL || 'support@vibelink.tech'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export const publicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

/**
 * The phone app (mobile/). A web view gets no web push, so the app registers with Firebase Cloud Messaging instead and hands us its
 * token; the same alerts then go to it through FCM. FCM_SERVICE_ACCOUNT is the Firebase service account key (its JSON, or that JSON
 * in base64 so it fits on one line of .env). Unset, the app is simply not notified, like web push without VAPID keys.
 */
const fcmAccount = (() => {
  const raw = String(process.env.FCM_SERVICE_ACCOUNT ?? '').trim();
  if (!raw) return null;
  try {
    const a = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    if (a.client_email && a.private_key && a.project_id) return a;
  } catch { /* reported below */ }
  console.error('push: FCM_SERVICE_ACCOUNT is set but is not a service account key (its JSON, or base64 of it)');
  return null;
})();

const b64url = (v) => Buffer.from(v).toString('base64url');
let fcmToken = null;   // { value, until }
/** Google's OAuth token for the service account, kept until shortly before it runs out. */
async function fcmAccessToken() {
  if (fcmToken && fcmToken.until > Date.now()) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: fcmAccount.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(fcmAccount.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google refused the service account (${res.status}): ${data.error_description ?? data.error ?? 'no token'}`);
  fcmToken = { value: data.access_token, until: Date.now() + Math.max(60, (Number(data.expires_in) || 3600) - 300) * 1000 };
  return fcmToken.value;
}

/** The app's token for this phone. Upserted on the token: signing in as someone else on the same phone moves it to them. */
export async function saveDevice(tenantId, staffId, token, platform) {
  await pool.query(
    `insert into push_devices (token, tenant_id, staff_id, platform) values ($1,$2,$3,$4)
     on conflict (token) do update set tenant_id=excluded.tenant_id, staff_id=excluded.staff_id, platform=excluded.platform, seen_at=now()`,
    [token, tenantId, staffId, platform === 'ios' ? 'ios' : 'android']);
}
export async function removeDevice(token) {
  await pool.query('delete from push_devices where token=$1', [token]);
}

async function sendToDevices(tenantId, { title, body, url, staffId }) {
  if (!fcmAccount) return;
  const { rows } = await pool.query(
    staffId
      ? 'select token from push_devices where tenant_id=$1 and staff_id=$2'
      : 'select token from push_devices where tenant_id=$1',
    staffId ? [tenantId, staffId] : [tenantId]).catch(() => ({ rows: [] }));   // the table may not be there yet on this server
  if (!rows.length) return;
  let access;
  try { access = await fcmAccessToken(); } catch (e) { console.error('push (app):', e.message); return; }
  await Promise.all(rows.map(async ({ token }) => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmAccount.project_id}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token,
          notification: { title: String(title ?? 'Vibelink'), body: String(body ?? '') },
          data: { url: String(url ?? '/') },
          android: { priority: 'high', notification: { channel_id: 'alerts' } },
        } }),
      });
      if (res.ok) return;
      const err = await res.json().catch(() => ({}));
      const code = err?.error?.details?.find?.((d) => d.errorCode)?.errorCode ?? err?.error?.status ?? '';
      // The app was uninstalled, or the token replaced: forget it rather than retry it for ever.
      if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT')) await removeDevice(token).catch(() => {});
      else console.error('push (app) failed', res.status, code, err?.error?.message ?? '');
    } catch (e) {
      console.error('push (app) failed', e.message);
    }
  }));
}

/** Save a browser's subscription. Upserted on endpoint, which is unique per browser install. */
export async function saveSubscription(tenantId, staffId, subscription) {
  await pool.query(
    `insert into push_subscriptions (tenant_id, staff_id, endpoint, keys)
     values ($1,$2,$3,$4)
     on conflict (endpoint) do update set staff_id=excluded.staff_id, keys=excluded.keys`,
    [tenantId, staffId, subscription.endpoint, subscription.keys]);
}

export async function removeSubscription(endpoint) {
  await pool.query('delete from push_subscriptions where endpoint=$1', [endpoint]);
}

/**
 * To every device a tenant's staff have opted in on. Best-effort per
 * subscription: one staff member's browser having revoked permission (410
 * Gone — the push service itself says so) must not stop the rest getting
 * paged, and a dead subscription is removed right then rather than retried
 * forever.
 */
export async function sendPush(tenantId, { title, body, url = '/', staffId = null }) {
  await sendToDevices(tenantId, { title, body, url, staffId }).catch((e) => console.error('push (app):', e.message));
  if (!configured) return;
  // staffId narrows this to one person's own devices (a job assigned to them) — omitted, it goes to
  // every device any of the tenant's staff have opted in on, as it always did.
  const { rows } = await pool.query(
    staffId
      ? 'select endpoint, keys from push_subscriptions where tenant_id=$1 and staff_id=$2'
      : 'select endpoint, keys from push_subscriptions where tenant_id=$1',
    staffId ? [tenantId, staffId] : [tenantId]);
  if (!rows.length) return;

  await Promise.all(rows.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        JSON.stringify({ title, body, url }));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await removeSubscription(s.endpoint).catch(() => {});
      } else {
        console.error('push failed', s.endpoint, e.statusCode, e.message);
      }
    }
  }));
}
