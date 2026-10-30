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
  const first = String(chat.display_name ?? '').trim().split(/\s+/)[0];
  await say(chat,
    `Hi${first && !/^guest$/i.test(first) ? ` ${first}` : ''}, I'm the automated assistant.`,
    "If you've paid and haven't got your code, or you have a code and can't connect, paste your M-Pesa confirmation message here (the whole message is fine) and I'll check it.",
    "Type 'person' at any time to talk to our team.");
}

/** A visitor message arrived. Does nothing once a person has the chat, or when the assistant is off. */
export async function botReply(chatId, text) {
  const { rows: [chat] } = await pool.query(
    'select id, tenant_id, status, visitor_ref, display_name, bot_state from live_chats where id=$1', [chatId]);
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

async function converse(chat, state, text) {
  const m = readMpesa(text);
  if (WANTS_PERSON.test(text) && !m.codes.length) return handOff(chat, state, 'asked for a person');
  if (m.codes.length) return checkPayment(chat, state, m);

  const phone = m.phone ?? (ABOUT_PAYING.test(text) ? chatPhone(chat) : null);
  if (phone) return checkPhone(chat, state, phone);

  if (state.voucher && ABOUT_CONNECTING.test(text)) return checkVoucher(chat, state);

  state.unclear += 1;
  if (state.unclear >= 3) return handOff(chat, state, 'the assistant could not tell what was needed');
  return say(chat,
    'I can check a payment for you. Please paste the M-Pesa confirmation message, or just the 10-character code at the start of it (for example SGH7K2L9QX).',
    "Or type 'person' to talk to our team.");
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
    await say(chat, p.voucher_status === 'in_use' ? inUseAdvice() : 'To connect: open the login page, type the code in the voucher box and tap Connect.');
    return say(chat, "If it still won't connect, tell me and I'll check again, or type 'person'.");
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
  return say(chat, "I can't find a recent payment from that number.", 'Please paste the M-Pesa confirmation message you got, or just its 10-character code.');
}
