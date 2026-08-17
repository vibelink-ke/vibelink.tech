/**
 * Which hostname is this, and what does it mean.
 *
 * The root domain belongs to no tenant: it is the marketing site and the only
 * place an ISP registers. A tenant subdomain is somebody's working portal, and
 * offering "create an account" there invites an operator to sign up twice and
 * split their customers across two portals.
 *
 * VITE_ROOT_DOMAIN keeps this in step with ROOT_DOMAIN on the server. It is
 * baked in at build time, which is fine: changing the platform's domain means
 * rebuilding everything anyway.
 */
const ROOT = (import.meta.env.VITE_ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();

export function isPlatformHost(hostname = window.location.hostname) {
  const h = String(hostname).toLowerCase();
  // localhost is treated as a tenant host so the dev server keeps showing the
  // app rather than the marketing page, which is what a developer wants.
  if (h === 'localhost' || h === '127.0.0.1') return false;
  return h === ROOT || h === `www.${ROOT}`;
}
