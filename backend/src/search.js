import { hasPermission } from './permissions.js';

/**
 * The search behind Ctrl K. The screen already searches what it has loaded (clients, unmatched payments, tickets, routers);
 * this adds what is not loaded: any payment by M-Pesa code, phone or name, invoices by number, leads, every voucher, and
 * clients by any of their numbers. Each kind is searched only when the staff member's role may open that kind.
 */
export function registerSearch(app, { pool, wrap }) {
  app.get('/api/search', wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 60);
    if (q.length < 2) return res.json([]);
    const t = req.tenant.id;
    const may = async (key) => req.session?.is_super_admin || hasPermission(t, req.session?.role, key);
    const digits = q.replace(/[^0-9]/g, '');
    const nine = digits.length >= 9 ? digits.slice(-9) : null;
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const out = [];

    const [clients, payments, leads, vouchers] = await Promise.all([
      may('clients.view'), may('payments.view'), may('leads.view'), may('hotspot.view')]);

    const jobs = [];
    if (clients) {
      jobs.push(pool.query(
        `select id, name, account_code, phone, status from subscribers
          where tenant_id=$1 and (name ilike $2 or account_code ilike $2 or pppoe_user ilike $2 or coalesce(static_ip::text,'') ilike $2
                or ($3::text is not null and right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 9) = $3))
          order by (account_code = $4) desc, name limit 8`, [t, like, nine, q]).then(({ rows }) => rows.forEach((c) => out.push({
        kind: 'Client', title: c.name, detail: [c.account_code, c.phone, c.status].filter(Boolean).join(' · '), to: `/clients/${c.id}`,
      }))));
      jobs.push(pool.query(
        `select i.number, i.amount, i.status, i.subscriber_id, s.name from invoices i join subscribers s on s.id = i.subscriber_id
          where i.tenant_id=$1 and i.number ilike $2 order by i.due_date desc limit 5`, [t, like]).then(({ rows }) => rows.forEach((i) => out.push({
        kind: 'Invoice', title: i.number, detail: `${i.name} · ${Number(i.amount)} · ${i.status}`, to: `/clients/${i.subscriber_id}?tab=invoices`,
      }))));
    }
    if (payments) {
      jobs.push(pool.query(
        `select p.id, p.provider_ref, p.amount, p.status, p.payer_name, p.payer_phone, p.received_at, p.subscriber_id, s.name, v.code as voucher
           from payments p left join subscribers s on s.id = p.subscriber_id left join vouchers v on v.id = p.voucher_id
          where p.tenant_id=$1 and (p.provider_ref ilike $2 or p.payer_name ilike $2 or p.raw_account = $4
                or ($3::text is not null and right(regexp_replace(coalesce(p.payer_phone,''), '[^0-9]', '', 'g'), 9) = $3))
          order by (upper(p.provider_ref) = upper($4)) desc, p.received_at desc limit 8`, [t, like, nine, q]).then(({ rows }) => rows.forEach((p) => out.push({
        kind: 'Payment',
        title: `${p.provider_ref} · ${Number(p.amount)}`,
        detail: [p.status === 'applied' ? (p.name ?? (p.voucher ? `voucher ${p.voucher}` : 'applied')) : p.status, p.payer_name, new Date(p.received_at).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short' })].filter(Boolean).join(' · '),
        to: p.status === 'unmatched' ? `/payments?open=${p.id}` : p.subscriber_id ? `/clients/${p.subscriber_id}?tab=billing`
          : p.voucher ? `/hotspot/vouchers?open=${encodeURIComponent(p.voucher)}` : `/payments`,
      }))));
    }
    if (leads) {
      jobs.push(pool.query(
        `select id, name, phone, status from leads where tenant_id=$1 and (name ilike $2
           or ($3::text is not null and right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 9) = $3)) order by created_at desc limit 5`,
        [t, like, nine]).then(({ rows }) => rows.forEach((l) => out.push({ kind: 'Lead', title: l.name, detail: `${l.phone ?? ''} · ${l.status}`, to: '/work' }))));
    }
    if (vouchers) {
      jobs.push(pool.query(
        `select code, status, phone from vouchers where tenant_id=$1 and (code ilike $2
           or ($3::text is not null and right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 9) = $3)) order by created_at desc limit 5`,
        [t, `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, nine]).then(({ rows }) => rows.forEach((v) => out.push({
        kind: 'Voucher', title: v.code, detail: [v.status, v.phone].filter(Boolean).join(' · '), to: `/hotspot/vouchers?open=${encodeURIComponent(v.code)}`,
      }))));
    }
    // One kind failing (a column a deployment does not have yet) leaves the others' results standing.
    await Promise.all(jobs.map((j) => j.catch((e) => console.warn('search:', e.message))));
    res.json(out);
  }));
}
