import { pool } from './db.js';

/**
 * The content a new ISP should not have to write before they can work.
 *
 * Seeding at migration time only covered tenants that already existed, so
 * everyone who signed up afterwards got an empty knowledge base — the people
 * most likely to need one. This runs at signup instead.
 *
 * Only ever adds where there is nothing: re-running must not overwrite an
 * operator's own wording, and this is called from more than one path.
 */
const ARTICLES = [
  ['My internet is slow', 'Connection',
   'Restart the router first: unplug it, wait ten seconds, plug it back in. It fixes most slowdowns.\n\n'
   + 'If it is still slow, check how many devices are connected — a package shared across a full house '
   + 'behaves like a slower one.\n\n'
   + 'If you have passed your fair-use allowance for the month your speed is reduced until it resets. '
   + 'Your remaining allowance is on your customer portal.\n\n'
   + 'Still slow? Send us your account number and roughly when it started, and we will check the tower.'],

  ['I have paid but I am still disconnected', 'Payments',
   'Payments usually reconnect the line within a minute or two.\n\n'
   + 'If it has been longer, check the M-Pesa message: the account number you typed has to match your '
   + 'account number exactly. A payment sent with the wrong account cannot find you on its own.\n\n'
   + 'Send us the M-Pesa confirmation code and we will apply it by hand. Nothing is lost — a payment '
   + 'that did not match is held, not returned.'],

  ['How do I pay', 'Payments',
   'Pay by M-Pesa to the paybill on your invoice, using your account number as the account.\n\n'
   + 'The account number is the important part: it is how the payment finds you. It is on your invoice, '
   + 'in your welcome SMS, and on your customer portal.\n\n'
   + 'You can also pay from the portal, which sends the M-Pesa prompt to your phone so there is nothing '
   + 'to type.'],

  ['WiFi is connected but there is no internet', 'Connection',
   'This usually means the line reaches your router but not past it.\n\n'
   + 'Check whether other devices have the same problem. If only one does, forget the network on that '
   + 'device and join it again.\n\n'
   + 'If every device is affected, restart the router. If that does not fix it your account may have '
   + 'expired — check the portal.'],

  ['Using a hotspot voucher', 'Hotspot',
   'Connect to the WiFi and a login page opens by itself. If it does not, open a browser and go to any '
   + 'page that is not https.\n\n'
   + 'Type the code from your voucher and press Connect. There is no username — the code is all you need.\n\n'
   + 'Your device is remembered for the life of the bundle, so switching WiFi off and on reconnects you '
   + 'without typing it again.'],

  ['Moving house', 'Account',
   'Tell us before you move and we will check whether your new address is covered.\n\n'
   + 'If it is, the same account moves with you and only the installation needs booking. If it is not, '
   + 'we will say so plainly rather than sell you a line we cannot deliver.'],
];

export async function seedTenant(tenantId) {
  const { rows: [existing] } = await pool.query(
    'select 1 from kb_articles where tenant_id=$1 limit 1', [tenantId]);
  if (existing) return { seeded: 0 };

  for (const [title, category, body] of ARTICLES) {
    await pool.query(
      `insert into kb_articles (tenant_id, title, category, body, published)
       values ($1,$2,$3,$4,true)`, [tenantId, title, category, body]);
  }
  return { seeded: ARTICLES.length };
}
