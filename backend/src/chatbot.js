/**
 * The support assistant in the live chat.
 *
 * A guest who has paid and not got their code, or has a code and cannot connect, is the most common reason for a chat to open. This answers
 * that from what the system already knows, while nobody has taken the chat: the visitor pastes the M-Pesa message (or just its code), the
 * payment is looked up, and they are told their code, or what is wrong. It is rules, not a language model: it can only say what the database
 * says, it cannot promise anything, and it costs nothing per message.
 *
 * Rules it keeps:
 *   - A code is shown in the chat only to someone who gave the M-Pesa code of that payment (the same proof /hotspot/voucher-by-mpesa takes).
 *     Someone who gave only a phone number gets the code by SMS to the number that paid, never on screen: anyone can type any number.
 *   - When a pasted message names an amount, it has to match the payment's, so a guessed code is not enough.
 *   - It stops the moment a person accepts the chat, and hands over (alerting sales, like an unanswered chat) when asked to, when it cannot
 *     find a payment twice, when a payment is not linked to anything, or when it is going round in circles.
 *   - Off unless the tenant switches it on.
 */
import { pool } from './db.js';
import { fmtNairobi } from './nairobi-time.js';

export async function botEnabled(tenantId) {
  const { rows: [t] } = await pool.query('select chat_bot_enabled from tenants where id=$1', [tenantId]).catch(() => ({ rows: [] }));
  return !!t?.chat_bot_enabled;
}

export async function setBotEnabled(tenantId, on) {
  await pool.query('update tenants set chat_bot_enabled=$2 where id=$1', [tenantId, !!on]);
  return { enabled: !!on };
}

/**
 * What a pasted M-Pesa confirmation carries: its transaction code (ten letters and digits, with both), the first amount in it (the payment
 * itself; the balance and the charge come after), and a phone number if there is one. Several codes are returned when the visitor pasted
 * more than one message or the text has other ten-character words in it; each is tried.
 */
export function readMpesa(text) {
  const up = String(text ?? '').toUpperCase();
  const codes = [];
  for (const m of up.matchAll(/\b[A-Z0-9]{10}\b/g)) {
    if (/[A-Z]/.test(m[0]) && /[0-9]/.test(m[0]) && !codes.includes(m[0])) codes.push(m[0]);
  }
  const amt = /(?:KSH|KES)\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/.exec(up);
  const amount = amt ? Number(amt[1].replace(/,/g, '')) : null;
  const compact = up.replace(/[\s-]/g, '');
  const ph = /(?:\+?254|0)[17][0-9]{8}/.exec(compact);
  return { codes, amount: Number.isFinite(amount) ? amount : null, phone: ph ? ph[0] : null };
}

const last9 = (p) => String(p ?? '').replace(/[^0-9]/g, '').slice(-9);
const masked = (p) => { const d = last9(p); return d.length === 9 ? `0${d.slice(0, 2)}***${d.slice(-3)}` : 'your phone'; };
const money = (n) => `KES ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const when = (d) => fmtNairobi(d, { dateStyle: 'medium', timeStyle: 'short' });
const chatPhone = (chat) => (last9(chat.visitor_ref).length === 9 ? chat.visitor_ref : null);
const isGone = (status, expires) => status === 'expired' || (expires && new Date(expires).getTime() < Date.now());

async function say(chat, ...lines) {
  for (const body of lines.filter(Boolean)) {
    await pool.query("insert into chat_messages (tenant_id, chat_id, sender, body) values ($1,$2,'bot',$3)", [chat.tenant_id, chat.id, body]);
  }
}

/** Stop answering and get a person: the visitor is told, and sales is alerted the way it is for a chat nobody is online for. */
async function handOff(chat, state, why) {
  state.handed = true;
  const sms = await import('./sms.js');
  const org = await sms.orgVars(chat.tenant_id).catch(() => ({}));
  await say(chat,
    "I'm passing this to our team. They will reply here as soon as someone is free."
      + (org?.supportPhone ? ` You can also call ${org.supportPhone}.` : ''));
  const { notifySales } = await import('./jobs.js');
  await notifySales(chat.tenant_id, `${chat.display_name || 'A visitor'} needs a person on live chat: ${why}`,
    { url: `/live-support?chat=${chat.id}`, title: 'Chat needs a person' }).catch(() => {});
}

/** Said when a chat opens. */
export async function botStart(chat) {
  if (!(await botEnabled(chat.tenant_id))) return;
  // A known problem at this guest's site is the first thing to say: it is very likely why they are here.
  const known = await siteProblem(chat.tenant_id, await chatRouterId(chat)).catch(() => null);
  if (known) await say(chat, outageLine(known));
  const first = String(chat.display_name ?? '').trim().split(/\s+/)[0];
  await say(chat,
    `Hi${first && !/^guest$/i.test(first) ? ` ${first}` : ''}, I'm the automated assistant.`,
    ...MENU,
    "Type 'person' at any time to talk to our team.");
}

/** A visitor message arrived. Does nothing once a person has the chat, or when the assistant is off. */
export async function botReply(chatId, text) {
  const { rows: [chat] } = await pool.query(
    'select * from live_chats where id=$1', [chatId]);
  if (!chat || chat.status !== 'waiting') return;
  if (!(await botEnabled(chat.tenant_id))) return;
  const state = { lookups: 0, notFound: 0, unclear: 0, stuck: 0, resentAt: null, voucher: null, handed: false, ...(chat.bot_state ?? {}) };
  if (state.handed) return;
  try {
    await converse(chat, state, String(text ?? ''));
  } finally {
    await pool.query('update live_chats set bot_state=$2 where id=$1', [chat.id, JSON.stringify(state)]);
  }
}

const WANTS_PERSON = /\b(person|human|agent|operator|someone|staff|representative|call me|mtu|msaada)\b/i;
const ABOUT_PAYING = /\b(paid|pay|payment|mpesa|m-pesa|code|voucher|nimelipa|sent)\b/i;
const ABOUT_CONNECTING = /\b(connect|connected|internet|wifi|wi-fi|login|log in|working|cant|can't|cannot|not|still|slow|offline)\b/i;

// Every way back online for someone who has already paid, as the login page offers them. The visitor replies with a number (see reconnectOption).
const MENU = [
  "If you've already paid, here are the ways to get back online. Reply with a number:\n"
    + '1. Connect me automatically (this phone is recognised)\n'
    + '2. Use my voucher code\n'
    + '3. Find my code from my M-Pesa message\n'
    + '4. Sign in with the phone number I paid with\n'
    + '5. Use a username and password\n'
    + '6. Connect a TV or console\n'
    + '7. I have home internet, not the hotspot\n'
    + '8. Talk to a person',
  "Or paste your M-Pesa message here and I'll look up your payment.",
];

const OPTIONS = {
  1: ['On the login page, tap "I already have an active bundle: connect me". It recognises this phone.',
    'If it says no bundle was found: forget this Wi-Fi network, turn off "Private Wi-Fi address" (or "Random MAC") for it, reconnect and try again. A phone is recognised by its Wi-Fi address, so a changed address looks like a new phone.'],
  2: ['Type the code from your SMS or voucher into the "Voucher code" box on the login page and tap Connect.'],
  3: ['Under the login form tap "Paid but got no SMS? Use your M-Pesa code" and type the 10-character code from your M-Pesa message (it looks like SGH7K2L9QX).',
    "Or paste your M-Pesa message here and I'll find your code."],
  4: ['Tap "Paid with M-Pesa? Sign in with your phone number" on the login page, type the number you paid with, then the 6-digit code we text you.',
    'It signs you in on the bundle you paid for, as long as that bundle is still running.'],
  5: ['If you were given a username and password instead of a code, tap "Have a username and password instead?" under the voucher box and enter them.'],
  6: ['For a TV or console, tap "Add TV / console" on the login page. You can pay for a TV package there, or activate a TV voucher.',
    'A TV or console can also share a bundle you have already paid for: once your phone is online, add it from "Add TV / console".'],
  7: ['Home internet: switch your router off for 30 seconds, then on, and wait about five minutes for it to connect.',
    "If it still has no internet, paste your M-Pesa message and I'll check your payment, or type 'person'."],
};

const WANTS_MENU = /\b(options?|menu|reconnect|reconnecting|already paid|paid already)\b/i;

/**
 * Sign this guest's phone in on the router it is on, the way the login page's "connect me" does: the router is asked to log the device in with the
 * voucher. Only called once a payment is proved (the M-Pesa code) or for a bundle already tied to this phone. Returns 'connected', 'already' (online
 * already), 'unknown' (the page did not say which device this is), 'not-found' (that device is not waiting on any router's login page) or 'failed'.
 */
async function signIn(chat, code) {
  const mac = String(chat.device_mac ?? '').toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) return 'unknown';
  const { rows: routers } = await pool.query(
    `select id, host, api_port, service_user, service_password_enc from routers
      where tenant_id=$1 and role in ('hotspot','both') and service_user is not null and service_password_enc is not null
      order by (id::text = $2) desc, name limit 8`, [chat.tenant_id, String(chat.device_router ?? '')]);
  const ros = await import('./routeros.js');
  const secrets = await import('./secrets.js');
  let failed = false;
  for (const r of routers) {
    let conn;
    try {
      conn = await ros.connect({ host: String(r.host).split('/')[0], port: r.api_port ?? 8728, user: r.service_user, password: secrets.decrypt(r.service_password_enc), timeoutSec: 4 });
      const hosts = await conn.write('/ip/hotspot/host/print', [`?mac-address=${mac}`]).catch(() => []);
      if (!hosts.length) continue;
      if (hosts.some((h) => String(h.authorized) === 'true')) return 'already';
      const host = hosts.find((h) => h.address);
      if (!host) continue;
      // A voucher's password is its code (see issueVoucherAccess).
      await conn.write('/ip/hotspot/active/login', [`=user=${code}`, `=password=${code}`, `=ip=${host.address}`, `=mac-address=${mac}`]);
      return 'connected';
    } catch (e) {
      failed = true;
      console.warn('chat bot: router login failed:', e.message);
    } finally {
      if (conn) { try { ros.close(conn); } catch { /* already gone */ } }
    }
  }
  return failed ? 'failed' : 'not-found';
}

const connectedLine = "I've connected this phone for you. If the page doesn't open by itself, open any website.";

/** Option 1: a bundle already running for this phone's own Wi-Fi address, signed in without typing anything. Returns what happened. */
async function reconnectThisPhone(chat) {
  const mac = String(chat.device_mac ?? '').toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) return 'unknown';
  const { rows: [v] } = await pool.query(
    `select v.code from vouchers v
      where v.tenant_id=$1 and upper(v.mac::text)=$2 and v.status='in_use' and (v.expires_at is null or v.expires_at > now())
     union all
     select v.code from voucher_devices d join vouchers v on v.id = d.voucher_id
      where v.tenant_id=$1 and upper(d.mac::text)=$2 and v.status='in_use' and (v.expires_at is null or v.expires_at > now())
     limit 1`, [chat.tenant_id, mac]);
  if (!v) return 'no-bundle';
  return signIn(chat, v.code);
}

async function reconnectOption(chat, state, n) {
  if (n === 8) return handOff(chat, state, 'asked for a person');
  if (n === 1) {
    const how = await reconnectThisPhone(chat);
    if (how === 'connected') return say(chat, connectedLine);
    if (how === 'already') return say(chat, 'This phone is already online on your bundle.');
    if (how === 'no-bundle') await say(chat, "I couldn't find a running bundle for this phone. If you paid from another phone, paste your M-Pesa message and I'll connect this one.");
    else if (how === 'not-found' || how === 'failed') await say(chat, "I couldn't sign this phone in from here. Here is what to try:");
  }
  await say(chat, ...OPTIONS[n]);
  return say(chat, "Reply with another number, paste your M-Pesa message, or type 'person' for our team.");
}

/** What is wrong at the router a chat is on, if we know of anything: an outage recorded for it, or a router that is not answering. */
async function siteProblem(tenantId, routerId) {
  if (!routerId) return null;
  const { rows: [o] } = await pool.query(
    "select site, cause, eta from outages where tenant_id=$1 and router_id=$2 and status='active' order by started_at desc limit 1", [tenantId, routerId]);
  if (o) return o;
  const { rows: [r] } = await pool.query("select name from routers where id=$1 and tenant_id=$2 and status='down'", [routerId, tenantId]);
  return r ? { site: r.name, cause: null, eta: null } : null;
}

const outageLine = (o) => `There is a known problem at ${o.site}${o.cause ? ` (${o.cause})` : ''}. Our engineers are working on it${o.eta ? `, expected back ${o.eta}` : ''}. You don't need to restart anything.`;

/** The router a chat is on: the one the login page named, or the signed-in customer's own. */
async function chatRouterId(chat) {
  if (chat.device_router) return chat.device_router;
  if (!chat.subscriber_id) return null;
  const { rows: [s] } = await pool.query('select router_id from subscribers where id=$1 and tenant_id=$2', [chat.subscriber_id, chat.tenant_id]);
  return s?.router_id ?? null;
}

const ABOUT_ACCOUNT = /\b(expire|expires|expiry|expiring|balance|status|account|due|owe|active|valid|until|renew)\b/i;

/** Everything the system knows about a customer's line, in one place (used by the assistant and by ticket triage). */
async function accountSnapshot(tenantId, subscriberId) {
  const { rows: [s] } = await pool.query(
    `select s.account_code, s.status, s.expires_at, s.router_id, s.pppoe_user, p.title as plan_title
       from subscribers s left join plans p on p.id = s.plan_id where s.id=$1 and s.tenant_id=$2`, [subscriberId, tenantId]);
  if (!s) return null;
  const { rows: [pay] } = await pool.query(
    'select amount, status, received_at from payments where tenant_id=$1 and subscriber_id=$2 order by received_at desc limit 1', [tenantId, subscriberId]);
  let online = false;
  if (s.pppoe_user) {
    const { rows: [o] } = await pool.query(
      "select 1 from radacct where username=$1 and acctstoptime is null and coalesce(acctupdatetime, acctstarttime) > now() - interval '10 minutes' limit 1", [s.pppoe_user]);
    online = !!o;
  }
  return { ...s, pay: pay ?? null, online, problem: await siteProblem(tenantId, s.router_id) };
}

/** A signed-in home-internet customer asking about their account or why they are offline. Returns true when it answered. */
async function accountHelp(chat, state) {
  const a = await accountSnapshot(chat.tenant_id, chat.subscriber_id);
  if (!a) return false;
  const lines = [`Account ${a.account_code}${a.plan_title ? `, ${a.plan_title}` : ''}: ${a.status}${a.expires_at ? `, until ${when(a.expires_at)}` : ''}.`];
  if (a.pay) lines.push(`Your last payment was ${money(a.pay.amount)} on ${when(a.pay.received_at)} (${a.pay.status}).`);
  if (['expired', 'suspended', 'paused'].includes(a.status)) {
    lines.push(`Your service is ${a.status}. Pay from your portal or the paybill on your invoice and it reconnects within a minute or two.`);
  } else if (a.problem) {
    lines.push(outageLine(a.problem));
  } else if (a.online) {
    lines.push('Our system shows your line is connected. If your devices have no internet, restart your Wi-Fi router and check its cable.');
  } else {
    lines.push('Your line is not connected on our side. Switch your router off for 30 seconds and back on, then wait about five minutes for it to connect.');
    state.offline = (state.offline ?? 0) + 1;
    if (state.offline >= 2) {
      await say(chat, ...lines);
      await handOff(chat, state, `account ${a.account_code} (${a.status}) is still offline after a restart`);
      return true;
    }
  }
  lines.push("Reply 'person' to talk to our team.");
  await say(chat, ...lines);
  return true;
}

async function converse(chat, state, text) {
  const m = readMpesa(text);
  const pick = /^\s*([1-8])[.)]?\s*$/.exec(text);
  if (pick) return reconnectOption(chat, state, Number(pick[1]));
  if (WANTS_MENU.test(text) && !m.codes.length) return say(chat, ...MENU);
  if (!m.codes.length && chat.subscriber_id && (ABOUT_ACCOUNT.test(text) || ABOUT_CONNECTING.test(text)) && await accountHelp(chat, state)) return;
  if (!m.codes.length && ABOUT_CONNECTING.test(text)) {
    const known = await siteProblem(chat.tenant_id, await chatRouterId(chat));
    if (known) return say(chat, outageLine(known), "If it is still down after we say it is fixed, tell me and I'll bring in our team.");
  }
  if (WANTS_PERSON.test(text) && !m.codes.length) return handOff(chat, state, 'asked for a person');
  if (m.codes.length) return checkPayment(chat, state, m);

  const phone = m.phone ?? (ABOUT_PAYING.test(text) ? chatPhone(chat) : null);
  if (phone) return checkPhone(chat, state, phone);

  if (state.voucher && ABOUT_CONNECTING.test(text)) return checkVoucher(chat, state);

  state.unclear += 1;
  if (state.unclear >= 3) return handOff(chat, state, 'the assistant could not tell what was needed');
  return say(chat,
    'I can check a payment for you. Please paste the M-Pesa confirmation message, or just the 10-character code at the start of it (for example SGH7K2L9QX).',
    "Or reply 'options' to see every way to reconnect, or type 'person' to talk to our team.");
}

async function checkPayment(chat, state, m) {
  state.lookups += 1;
  if (state.lookups > 8) return handOff(chat, state, 'a lot of payment lookups');

  const { rows: [p] } = await pool.query(
    `select p.amount, p.status, p.subscriber_id, p.voucher_id, p.provider_ref,
            v.code as voucher_code, v.status as voucher_status, v.expires_at as voucher_expires, pl.title as plan_title,
            s.account_code, s.status as sub_status, s.expires_at as sub_expires
       from payments p
       left join vouchers v on v.id = p.voucher_id
       left join plans pl on pl.id = v.plan_id
       left join subscribers s on s.id = p.subscriber_id
      where p.tenant_id = $1 and upper(p.provider_ref) = any($2::text[])
      order by p.received_at desc limit 1`, [chat.tenant_id, m.codes]);

  // A pasted message that names an amount has to agree with the payment: a guessed code alone is not proof.
  const mismatch = p && m.amount != null && Math.abs(Number(p.amount) - m.amount) > 0.5;
  if (!p || mismatch) {
    state.notFound += 1;
    if (state.notFound >= 2) return handOff(chat, state, `could not find a payment for ${m.codes[0]}${m.amount != null ? ` (KES ${m.amount})` : ''}`);
    return say(chat,
      mismatch ? `I found a payment with that code, but the amount does not match what you pasted (KES ${m.amount}).`
        : `I can't find a payment with the code ${m.codes[0]} yet.`,
      'Payments can take a minute to show up. Please check the code and send the whole M-Pesa message again, or tell me the phone number you paid from.');
  }

  if (p.voucher_id) {
    if (isGone(p.voucher_status, p.voucher_expires)) {
      return say(chat,
        `Your payment of ${money(p.amount)} was received, and your code ${p.voucher_code} ran out${p.voucher_expires ? ` on ${when(p.voucher_expires)}` : ''}.`,
        'To get online again, buy a new package from the login page.');
    }
    state.voucher = p.voucher_id;
    await say(chat,
      `Found it: ${money(p.amount)} received${p.plan_title ? ` for ${p.plan_title}` : ''}. Your code is ${p.voucher_code}, `
        + `${p.voucher_expires ? `valid until ${when(p.voucher_expires)}` : 'and its time starts at your first login'}.`);
    // The M-Pesa code proves the payment, so this phone is signed in on it straight away.
    const how = await signIn(chat, p.voucher_code);
    if (how === 'connected') await say(chat, connectedLine);
    else if (how === 'already') await say(chat, 'This phone is already online on your bundle.');
    else await say(chat, p.voucher_status === 'in_use' ? inUseAdvice() : 'To connect: open the login page, type the code in the voucher box and tap Connect.');
    return say(chat, "If it still won't connect, tell me and I'll check again. Reply 'options' to see every way to reconnect, or type 'person'.");
  }

  if (p.subscriber_id) {
    if (p.sub_status && !['active', 'grace'].includes(p.sub_status)) {
      return handOff(chat, state, `payment ${p.provider_ref} was applied to account ${p.account_code} but the account shows ${p.sub_status}`);
    }
    return say(chat,
      `Found it: ${money(p.amount)} received and applied to account ${p.account_code}${p.sub_expires ? `, active until ${when(p.sub_expires)}` : ''}.`,
      'If you still have no internet, switch your router off for 30 seconds and back on, then wait a few minutes for it to connect.',
      "If it doesn't come back, tell me and type 'person'.");
  }

  await say(chat, `I can see your payment of ${money(p.amount)} (${p.provider_ref}), but it has not been linked to a package yet.`);
  return handOff(chat, state, `payment ${p.provider_ref} of ${money(p.amount)} was received but is not linked to a voucher or an account`);
}

const inUseAdvice = () =>
  'This code is already in use. If you are on the same phone, turn Wi-Fi off and on, then reopen the login page. '
  + 'If it still asks for a code, turn off "Private Wi-Fi address" (or "Random MAC") for this network in your Wi-Fi settings and try again.';

/** They said it still does not work after being given a code. */
async function checkVoucher(chat, state) {
  const { rows: [v] } = await pool.query('select code, status, expires_at from vouchers where id=$1 and tenant_id=$2', [state.voucher, chat.tenant_id]);
  if (!v) return handOff(chat, state, 'the code that was given can no longer be found');
  if (isGone(v.status, v.expires_at)) {
    return say(chat, `Your code ${v.code} has run out${v.expires_at ? ` (${when(v.expires_at)})` : ''}.`, 'To get online again, buy a new package from the login page.');
  }
  state.stuck += 1;
  if (state.stuck >= 2) return handOff(chat, state, `has code ${v.code} (${v.status}) but still cannot connect`);
  return say(chat,
    v.status === 'in_use' ? inUseAdvice()
      : `Your code ${v.code} has not been used yet. Open the login page, type it in the voucher box and tap Connect.`,
    "If that doesn't work, tell me and I'll bring in our team.");
}

/** Only a phone number: the code goes to that phone by SMS, never onto the screen. */
async function checkPhone(chat, state, phone) {
  const l9 = last9(phone);
  if (l9.length !== 9) {
    state.unclear += 1;
    return say(chat, 'I need the M-Pesa code, or the phone number you paid from. Please paste the confirmation message.');
  }
  const { rows: [r] } = await pool.query(
    `select p.amount, p.payer_phone, v.id as voucher_id, v.code, v.status, v.expires_at, pl.title as plan_title
       from payments p
       join vouchers v on v.id = p.voucher_id
       left join plans pl on pl.id = v.plan_id
      where p.tenant_id = $1 and p.status = 'applied'
        and right(regexp_replace(coalesce(p.payer_phone, ''), '[^0-9]', '', 'g'), 9) = $2
        and p.received_at > now() - interval '3 days'
      order by p.received_at desc limit 1`, [chat.tenant_id, l9]);

  if (r) {
    if (isGone(r.status, r.expires_at)) {
      return say(chat, `That phone's last payment (${money(r.amount)}) has run out.`, 'To get online again, buy a new package from the login page.');
    }
    state.voucher = r.voucher_id;
    if (state.resentAt && Date.now() - new Date(state.resentAt).getTime() < 10 * 60000) {
      return say(chat, `I sent your code by SMS to ${masked(r.payer_phone)} a few minutes ago. SMS can be slow: please wait a little, and check your messages.`,
        "If it still doesn't arrive, type 'person'.");
    }
    const { rows: [t] } = await pool.query('select subdomain from tenants where id=$1', [chat.tenant_id]);
    const root = (process.env.ROOT_DOMAIN ?? 'vibelink.tech').toLowerCase();
    const link = t?.subdomain ? `https://${t.subdomain}.${root}/hotspot/login.html?code=${encodeURIComponent(r.code)}` : '';
    const sms = await import('./sms.js');
    try {
      await sms.send(chat.tenant_id, r.payer_phone, 'voucher', {
        code: r.code, expires: r.expires_at ? when(r.expires_at) : 'your first login', link, points_line: '',
      });
    } catch (e) {
      return handOff(chat, state, `could not resend the code by SMS to ${masked(r.payer_phone)}: ${e.message}`);
    }
    state.resentAt = new Date().toISOString();
    return say(chat,
      `I found your payment of ${money(r.amount)}${r.plan_title ? ` for ${r.plan_title}` : ''} and sent your code by SMS to ${masked(r.payer_phone)}.`,
      'For your safety I do not show it here when I only have a phone number. If you paste your M-Pesa message I can show it.');
  }

  // Nothing paid: was a payment prompt sent that never completed?
  const { rows: [k] } = await pool.query(
    `select status, result_desc, amount from stk_requests
      where (tenant_id = $1 or purpose->>'tenant_id' = $1::text)
        and right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = $2
        and created_at > now() - interval '45 minutes'
      order by created_at desc limit 1`, [chat.tenant_id, l9]);
  if (k?.status === 'pending') {
    return say(chat, 'A payment request was sent to that number a moment ago and is still waiting.', 'Check your phone for the M-Pesa prompt and enter your PIN.');
  }
  if (k && ['failed', 'timeout'].includes(k.status)) {
    return say(chat,
      `The payment request to that number did not go through${k.result_desc ? ` (${k.result_desc})` : ''}. No money was taken for it.`,
      'You can try again from the login page.');
  }
  if (k?.status === 'success') return handOff(chat, state, `the payment prompt to ${masked(phone)} succeeded but no voucher was issued`);

  state.notFound += 1;
  if (state.notFound >= 2) return handOff(chat, state, `could not find a recent payment from ${masked(phone)}`);
  return say(chat, "I can't find a recent payment from that number.", "Please paste the M-Pesa confirmation message you got, or just its 10-character code. Or reply 'options' to see every way to reconnect.");
}

const lastPromptSms = new Map();   // tenant:phone -> when, so one guest is not texted over and over

/**
 * A hotspot guest whose payment prompt never reached them, or whose M-Pesa balance was too low, gets one SMS saying so and that nothing was taken.
 * Not for a prompt they cancelled themselves. At most one per phone per half hour. Only while the assistant is switched on for the tenant.
 */
export async function failedPaymentSms(req, reason) {
  const p = req.purpose ?? {};
  if (!p.plan_id || (p.type && p.type !== 'platform_collect')) return;   // a hotspot purchase only
  const tenantId = p.tenant_id ?? req.tenant_id;
  if (!(await botEnabled(tenantId))) return;
  const r = String(reason ?? '');
  let why;
  if (/no response|cannot be reached|timeout/i.test(r)) why = " because the M-Pesa prompt did not reach you or was not answered";
  else if (/insufficient/i.test(r)) why = ' because the M-Pesa balance was too low';
  else return;
  const key = `${tenantId}:${last9(req.phone)}`;
  if (Date.now() - (lastPromptSms.get(key) ?? 0) < 30 * 60000) return;
  lastPromptSms.set(key, Date.now());
  const sms = await import('./sms.js');
  const org = await sms.orgVars(tenantId).catch(() => ({}));
  await sms.send(tenantId, req.phone, 'payment_failed', { company: org.company ?? '', amount: Number(req.amount), reason_line: why });
}

/**
 * A customer opened a ticket: urgent wording raises its priority, and an internal note carries what the system already knows (account, last payment,
 * whether the line is connected, any known problem at the site), so the technician does not start by asking for it.
 */
export async function triageTicket(tenantId, ticketId, subscriberId, text) {
  if (!(await botEnabled(tenantId))) return;
  if (/\b(no internet|offline|down|not working|cannot connect|can't connect|dead|disconnected)\b/i.test(String(text ?? ''))) {
    await pool.query("update tickets set priority='high' where id=$1 and tenant_id=$2 and priority='medium'", [ticketId, tenantId]);
  }
  const a = subscriberId ? await accountSnapshot(tenantId, subscriberId) : null;
  if (!a) return;
  const note = [
    `Auto-check: account ${a.account_code} is ${a.status}${a.expires_at ? ` until ${when(a.expires_at)}` : ''}.`,
    a.pay ? `Last payment ${money(a.pay.amount)} on ${when(a.pay.received_at)} (${a.pay.status}).` : 'No payment on record.',
    a.online ? 'The line is connected on our side.' : 'The line is not connected on our side.',
    a.problem ? `Known problem at ${a.problem.site}${a.problem.cause ? `: ${a.problem.cause}` : ''}.` : 'No known problem at the site.',
  ].join(' ');
  await pool.query("insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,'Assistant',$3,true)", [tenantId, ticketId, note]);
}
