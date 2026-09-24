/**
 * Sign in to the hotspot with the phone number that paid.
 *
 * A guest who bought a bundle by M-Pesa has already told us their number, and often has
 * no voucher code to hand (the SMS did not arrive, or the phone was swapped). They type
 * the number, we text a six-digit code to it, they type that, and we sign them in on the
 * bundle they paid for.
 *
 * The SMS code is what makes this safe. A phone number is not a secret, and without it
 * anybody who knew or guessed a paying customer's number could use their bundle. So:
 *   - a code is only sent to a number that has a bundle still running, so the tenant's SMS
 *     credit cannot be drained by typing random numbers, and the answer is the same either
 *     way, so the form cannot be used to find out who has paid;
 *   - at most three codes per number per 15 minutes, five tries per code, ten minutes to use it;
 *   - the code opens the voucher the payment bought, exactly as if its code had been typed.
 */
import crypto from 'node:crypto';

const OTP_TTL_MS = 10 * 60 * 1000;
const otps = new Map();   // "tenant:phone" -> { code, exp, tries, sent: [timestamps] }

const prune = () => {
  const now = Date.now();
  for (const [k, v] of otps) {
    if (v.exp < now && (!v.sent.length || v.sent.at(-1) < now - 15 * 60 * 1000)) otps.delete(k);
  }
};

/** 0712 345 678 / +254712345678 / 254712345678 all become the last nine digits. */
const lastNine = (p) => {
  const d = String(p ?? '').replace(/[^0-9]/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
};

/** The bundle this number paid for that is still running, newest payment first. */
async function liveVoucherFor(pool, tenantId, nine) {
  const { rows: [v] } = await pool.query(
    `select v.code
       from payments p
       join vouchers v on v.id = p.voucher_id
      where p.tenant_id = $1 and p.status = 'applied'
        and right(regexp_replace(coalesce(p.payer_phone, ''), '[^0-9]', '', 'g'), 9) = $2
        and v.status in ('unused', 'in_use')
        and (v.expires_at is null or v.expires_at > now())
      order by p.received_at desc
      limit 1`,
    [tenantId, nine]);
  return v?.code ?? null;
}

export function registerPhoneLogin(app, { pool, tenantByHost, wrap, limiter, smsLib = null }) {
  const tenantOf = async (req) => {
    return await tenantByHost(req.hostname)
      ?? (process.env.DEV_TENANT ? await tenantByHost(process.env.DEV_TENANT) : null);
  };

  app.post('/hotspot/phone-login/otp', limiter, wrap(async (req, res) => {
    prune();
    const t = await tenantOf(req);
    if (!t) return res.status(404).json({ error: 'Unknown network' });
    const nine = lastNine(req.body?.phone);
    if (!nine) return res.status(400).json({ error: 'Enter the phone number you paid with.' });
    const generic = { ok: true, message: 'If that number has a bundle running, a code has been sent to it by SMS.' };

    const key = `${t.id}:${nine}`;
    const now = Date.now();
    const rec = otps.get(key) ?? { code: null, exp: 0, tries: 0, sent: [] };
    rec.sent = rec.sent.filter((x) => x > now - 15 * 60 * 1000);
    if (rec.sent.length >= 3) {
      return res.status(429).json({ error: 'Too many codes requested for this number. Try again in a few minutes.' });
    }

    if (!(await liveVoucherFor(pool, t.id, nine))) return res.json(generic);

    rec.code = String(crypto.randomInt(100000, 1000000));
    rec.exp = now + OTP_TTL_MS;
    rec.tries = 0;
    rec.sent.push(now);
    otps.set(key, rec);

    const sms = smsLib ?? await import('./sms.js');
    const org = await sms.orgVars(t.id);
    const r = await sms.send(t.id, `254${nine}`, 'custom', {
      ...org, body: `${org.company || t.name || 'WiFi'}: your sign-in code is ${rec.code}. It works for 10 minutes.`,
    }).catch(() => ({ ok: false }));
    if (r?.ok === false) {
      rec.sent.pop();
      return res.status(502).json({
        error: 'We could not send the code. Use your voucher code or your M-Pesa code instead, or ask the operator to set up SMS.',
      });
    }
    res.json(generic);
  }));

  app.post('/hotspot/phone-login/verify', limiter, wrap(async (req, res) => {
    prune();
    const t = await tenantOf(req);
    if (!t) return res.status(404).json({ error: 'Unknown network' });
    const nine = lastNine(req.body?.phone);
    const code = String(req.body?.otp ?? '').trim();
    const rec = nine ? otps.get(`${t.id}:${nine}`) : null;
    if (!rec || !rec.code || rec.exp < Date.now()) {
      return res.status(400).json({ error: 'That code has expired. Ask for a new one.' });
    }
    if (rec.tries >= 5) {
      rec.code = null;
      return res.status(429).json({ error: 'Too many wrong tries. Ask for a new code.' });
    }
    rec.tries += 1;
    if (code !== rec.code) return res.status(400).json({ error: 'That code is not right.' });
    rec.code = null;   // one use

    const voucher = await liveVoucherFor(pool, t.id, nine);
    if (!voucher) return res.status(404).json({ error: 'That bundle is no longer running. Buy a new one below.' });
    res.json({ code: voucher });
  }));
}
