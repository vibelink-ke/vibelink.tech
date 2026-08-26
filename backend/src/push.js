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
export async function sendPush(tenantId, { title, body, url = '/' }) {
  if (!configured) return;
  const { rows } = await pool.query(
    'select endpoint, keys from push_subscriptions where tenant_id=$1', [tenantId]);
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
