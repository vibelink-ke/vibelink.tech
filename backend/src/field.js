/**
 * The field technician app's API: /api/field/*.
 *
 * A separate, narrow surface on purpose. A technician on a roof needs a customer's name, phone,
 * address, service state and how to fix the job; they never need to see what anyone paid, owes or is
 * charged. Everything here is written to return service facts only, and (server.js) a technician's
 * other API responses also have money fields stripped and money routes refused, so the guarantee does
 * not depend on this file alone.
 *
 *   jobs        tickets assigned to me (and unassigned ones to claim), each with its customer
 *   photos      taken in the app; a job cannot be closed without an "after" photo
 *   customers   look-up by name, phone or account: service state, address, whether they are online
 *   shift       start/end; location is only recorded while a shift is open
 *   team        the owner's view of where the team is (field.locations)
 */
import crypto from 'node:crypto';

const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;   // the app shrinks photos well below this before sending
const KINDS = new Set(['before', 'after', 'other']);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const validLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const validLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

/** "data:image/jpeg;base64,...." into { mime, buf }, or null when it is not a photo we accept. */
export function parsePhoto(dataUrl) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m || !PHOTO_MIME.has(m[1])) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > PHOTO_MAX_BYTES) return null;
  return { mime: m[1], buf };
}

export function registerField(app, { pool, requirePermission, hasPermission, wrap, radius }) {
  const use = requirePermission('field.use');
  const me = (req) => req.session?.staff_id ?? null;

  /**
   * The job the caller may act on: one assigned to them. The owner (or anyone else the matrix lets
   * close a ticket without a photo) may act on any job, so they can help from the office.
   */
  async function jobFor(req, res, id) {
    const { rows: [t] } = await pool.query(
      'select * from tickets where tenant_id=$1 and id=$2', [req.tenant.id, id]);
    if (!t) { res.status(404).json({ error: 'No such job' }); return null; }
    const mine = t.assigned_to && t.assigned_to === me(req);
    const wide = req.session?.is_super_admin || req.session?.role === 'owner';
    if (!mine && !wide) { res.status(403).json({ error: 'This job is not assigned to you.' }); return null; }
    return t;
  }

  // ── who I am, and my shift ─────────────────────────────────────────────
  app.get('/api/field/me', use, wrap(async (req, res) => {
    const { rows: [shift] } = await pool.query(
      'select started_at from field_shifts where tenant_id=$1 and staff_id=$2 and ended_at is null',
      [req.tenant.id, me(req)]);
    res.json({
      id: me(req), name: req.session.name, role: req.session.role,
      company: req.session.company ?? req.tenant.name,
      shift: shift ? { active: true, since: shift.started_at } : { active: false },
    });
  }));

  app.post('/api/field/shift', use, wrap(async (req, res) => {
    const action = String(req.body?.action ?? '');
    if (action === 'start') {
      await pool.query(
        `insert into field_shifts (tenant_id, staff_id) values ($1,$2)
         on conflict (staff_id) where ended_at is null do nothing`, [req.tenant.id, me(req)]);
    } else if (action === 'end') {
      await pool.query(
        'update field_shifts set ended_at=now() where tenant_id=$1 and staff_id=$2 and ended_at is null',
        [req.tenant.id, me(req)]);
      // Off shift means not on the map: the last position is dropped, not left showing for hours.
      await pool.query('delete from staff_locations where tenant_id=$1 and staff_id=$2', [req.tenant.id, me(req)]);
    } else {
      return res.status(400).json({ error: 'action must be start or end' });
    }
    const { rows: [shift] } = await pool.query(
      'select started_at from field_shifts where tenant_id=$1 and staff_id=$2 and ended_at is null',
      [req.tenant.id, me(req)]);
    res.json({ active: !!shift, since: shift?.started_at ?? null });
  }));

  // Position, only while a shift is open. The latest is kept for the map; a thin trail for review.
  app.post('/api/field/location', use, wrap(async (req, res) => {
    const lat = num(req.body?.lat); const lng = num(req.body?.lng);
    if (!validLat(lat) || !validLng(lng)) return res.status(400).json({ error: 'A valid position is needed.' });
    const accuracy = num(req.body?.accuracy);
    const { rows: [shift] } = await pool.query(
      'select 1 from field_shifts where tenant_id=$1 and staff_id=$2 and ended_at is null', [req.tenant.id, me(req)]);
    if (!shift) return res.status(409).json({ error: 'Start your shift first — location is only shared while you are on shift.' });

    const ticketId = req.body?.ticketId ? String(req.body.ticketId) : null;
    await pool.query(
      `insert into staff_locations (tenant_id, staff_id, lat, lng, accuracy, ticket_id, at)
       values ($1,$2,$3,$4,$5,
               (select id from tickets where id=$6 and tenant_id=$1), now())
       on conflict (staff_id) do update
         set lat=excluded.lat, lng=excluded.lng, accuracy=excluded.accuracy, ticket_id=excluded.ticket_id, at=now()`,
      [req.tenant.id, me(req), lat, lng, Number.isFinite(accuracy) ? accuracy : null, ticketId]);
    // A trail point at most every 30 seconds.
    await pool.query(
      `insert into staff_location_log (tenant_id, staff_id, lat, lng, accuracy)
       select $1,$2,$3,$4,$5
        where not exists (select 1 from staff_location_log
                           where staff_id=$2 and at > now() - interval '30 seconds')`,
      [req.tenant.id, me(req), lat, lng, Number.isFinite(accuracy) ? accuracy : null]);
    if (Math.random() < 0.01) {
      await pool.query("delete from staff_location_log where at < now() - interval '30 days'").catch(() => {});
    }
    res.json({ ok: true });
  }));

  // ── jobs ───────────────────────────────────────────────────────────────
  const JOB_SELECT = `
    select t.id, t.number, t.subject, t.description, t.kind, t.priority, t.status, t.assigned_to,
           t.created_at, t.due_at, t.resolved_at,
           s.id as customer_id, s.name as customer_name, s.phone as customer_phone, s.phone_alt as customer_phone_alt,
           s.account_code, s.location as customer_location, s.lat as customer_lat, s.lng as customer_lng,
           p.title as plan_title, p.rate_down, p.rate_up,
           r.name as router_name,
           (select count(*)::int from ticket_photos ph where ph.ticket_id = t.id) as photo_count,
           exists (select 1 from radacct a where a.username = s.pppoe_user and a.acctstoptime is null
                    and coalesce(a.acctupdatetime, a.acctstarttime) > now() - interval '15 minutes') as customer_online
      from tickets t
      left join subscribers s on s.id = t.subscriber_id
      left join plans p on p.id = s.plan_id
      left join routers r on r.id = s.router_id`;

  app.get('/api/field/jobs', use, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `${JOB_SELECT}
        where t.tenant_id=$1 and t.status <> 'resolved'
          and (t.assigned_to = $2 or t.assigned_to is null)
        order by (t.assigned_to = $2) desc nulls last,
                 case t.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
                 t.created_at`,
      [req.tenant.id, me(req)]);
    res.json(rows.map((j) => ({ ...j, mine: j.assigned_to === me(req) })));
  }));

  app.get('/api/field/jobs/:id', use, wrap(async (req, res) => {
    const job = await jobFor(req, res, req.params.id);
    if (!job) return;
    const { rows: [j] } = await pool.query(`${JOB_SELECT} where t.tenant_id=$1 and t.id=$2`, [req.tenant.id, job.id]);
    const { rows: notes } = await pool.query(
      'select id, author, body, at from ticket_notes where tenant_id=$1 and ticket_id=$2 order by at', [req.tenant.id, job.id]);
    const { rows: photos } = await pool.query(
      `select id, kind, taken_at, lat, lng from ticket_photos where tenant_id=$1 and ticket_id=$2 order by taken_at`,
      [req.tenant.id, job.id]);
    // What a technician needs to set the customer's equipment up. Service credentials, not money.
    const { rows: [creds] } = await pool.query(
      `select s.pppoe_user, s.pppoe_pass from tickets t join subscribers s on s.id = t.subscriber_id
        where t.tenant_id=$1 and t.id=$2`, [req.tenant.id, job.id]);
    res.json({ ...j, mine: j.assigned_to === me(req), notes, photos, pppoe_user: creds?.pppoe_user ?? null, pppoe_pass: creds?.pppoe_pass ?? null });
  }));

  // Take an unassigned job.
  app.post('/api/field/jobs/:id/claim', use, wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(
      `update tickets set assigned_to=$3, status=case when status='open' then 'in_progress' else status end, updated_at=now()
        where tenant_id=$1 and id=$2 and assigned_to is null and status <> 'resolved' returning id`,
      [req.tenant.id, req.params.id, me(req)]);
    if (!t) return res.status(409).json({ error: 'Someone else has taken this job.' });
    res.json({ ok: true });
  }));

  app.post('/api/field/jobs/:id/start', use, wrap(async (req, res) => {
    const job = await jobFor(req, res, req.params.id);
    if (!job) return;
    await pool.query(
      "update tickets set status='in_progress', updated_at=now() where tenant_id=$1 and id=$2 and status='open'",
      [req.tenant.id, job.id]);
    await pool.query(
      `insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,$3,$4,true)`,
      [req.tenant.id, job.id, req.session.name, 'Arrived and started the job.']);
    res.json({ ok: true });
  }));

  app.post('/api/field/jobs/:id/notes', use, wrap(async (req, res) => {
    const job = await jobFor(req, res, req.params.id);
    if (!job) return;
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    const { rows: [n] } = await pool.query(
      `insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,$3,$4,true) returning id, author, body, at`,
      [req.tenant.id, job.id, req.session.name, body.slice(0, 2000)]);
    await pool.query('update tickets set updated_at=now() where id=$1', [job.id]);
    res.json(n);
  }));

  // ── photos ─────────────────────────────────────────────────────────────
  app.post('/api/field/jobs/:id/photos', use, wrap(async (req, res) => {
    const job = await jobFor(req, res, req.params.id);
    if (!job) return;
    const photo = parsePhoto(req.body?.dataUrl);
    if (!photo) return res.status(400).json({ error: 'That is not a usable photo (JPEG, PNG or WebP, under 4 MB).' });
    const kind = KINDS.has(req.body?.kind) ? req.body.kind : 'other';
    const lat = num(req.body?.lat); const lng = num(req.body?.lng);
    const { rows: [p] } = await pool.query(
      `insert into ticket_photos (tenant_id, ticket_id, staff_id, kind, mime, data, lat, lng)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, kind, taken_at`,
      [req.tenant.id, job.id, me(req), kind, photo.mime, photo.buf,
       validLat(lat) && validLng(lng) ? lat : null, validLat(lat) && validLng(lng) ? lng : null]);
    await pool.query('update tickets set updated_at=now() where id=$1', [job.id]);
    res.json(p);
  }));

  // Bytes of a photo: the technician on the job, or anyone who may view tickets.
  app.get('/api/field/photos/:id', wrap(async (req, res) => {
    const { rows: [p] } = await pool.query(
      `select ph.mime, ph.data, t.assigned_to from ticket_photos ph join tickets t on t.id = ph.ticket_id
        where ph.tenant_id=$1 and ph.id=$2`, [req.tenant.id, req.params.id]);
    if (!p) return res.status(404).json({ error: 'not found' });
    const mine = p.assigned_to && p.assigned_to === me(req);
    const may = mine || req.session?.is_super_admin
      || await hasPermission(req.tenant.id, req.session?.role, 'tickets.view');
    if (!may) return res.status(403).json({ error: 'not allowed' });
    res.set('Content-Type', p.mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(p.data);
  }));

  // ── closing a job ──────────────────────────────────────────────────────
  app.post('/api/field/jobs/:id/close', use, wrap(async (req, res) => {
    const job = await jobFor(req, res, req.params.id);
    if (!job) return;
    if (job.status === 'resolved') return res.status(409).json({ error: 'This job is already closed.' });

    // The proof of work. A role the matrix lets close without one (the office) may skip it.
    const skip = req.session?.is_super_admin
      || await hasPermission(req.tenant.id, req.session?.role, 'tickets.close_without_photo');
    if (!skip) {
      const { rows: [after] } = await pool.query(
        "select 1 from ticket_photos where tenant_id=$1 and ticket_id=$2 and kind='after' limit 1", [req.tenant.id, job.id]);
      if (!after) return res.status(409).json({ error: 'Take an "after" photo of the finished work before closing this job.' });
    }

    // An install also leaves the customer's exact spot on the map.
    const lat = num(req.body?.lat); const lng = num(req.body?.lng);
    if (job.subscriber_id && validLat(lat) && validLng(lng) && req.body?.saveLocation) {
      await pool.query('update subscribers set lat=$3, lng=$4 where tenant_id=$1 and id=$2',
        [req.tenant.id, job.subscriber_id, lat, lng]);
    }
    const note = String(req.body?.note ?? '').trim();
    if (note) {
      await pool.query(
        `insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,$3,$4,true)`,
        [req.tenant.id, job.id, req.session.name, note.slice(0, 2000)]);
    }
    await pool.query(
      `update tickets set status='resolved', resolved_at=coalesce(resolved_at, now()), updated_at=now(), sla_breach_notified=false
        where tenant_id=$1 and id=$2`, [req.tenant.id, job.id]);
    res.json({ ok: true });
  }));

  // ── customers ──────────────────────────────────────────────────────────
  const CUSTOMER_SELECT = `
    select s.id, s.name, s.phone, s.phone_alt, s.account_code, s.service, s.status, s.line_label,
           s.location, s.lat, s.lng, s.pppoe_user, s.expires_at,
           p.title as plan_title, p.rate_down, p.rate_up, r.name as router_name,
           exists (select 1 from radacct a where a.username = s.pppoe_user and a.acctstoptime is null
                    and coalesce(a.acctupdatetime, a.acctstarttime) > now() - interval '15 minutes') as online,
           (select host(a.framedipaddress) from radacct a where a.username = s.pppoe_user
             order by a.acctstarttime desc limit 1) as last_ip,
           (select coalesce(a.acctupdatetime, a.acctstarttime) from radacct a where a.username = s.pppoe_user
             order by a.acctstarttime desc limit 1) as last_seen
      from subscribers s
      left join plans p on p.id = s.plan_id
      left join routers r on r.id = s.router_id`;

  // The service state in words. Never a balance or an amount.
  const stateOf = (c) => {
    if (c.status === 'active') return 'Service is on';
    if (c.status === 'grace') return 'Service is on (payment window)';
    if (c.status === 'expired') return 'Service is switched off';
    if (c.status === 'suspended') return 'Suspended by the office';
    if (c.status === 'paused') return 'Paused';
    return c.status;
  };

  app.get('/api/field/customers', use, wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const digits = q.replace(/[^0-9]/g, '');
    const { rows } = await pool.query(
      `${CUSTOMER_SELECT}
        where s.tenant_id=$1
          and (s.name ilike $2 or s.account_code ilike $2 or s.pppoe_user ilike $2 or s.line_label ilike $2
               or ($3 <> '' and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 9) like '%' || right($3, 9)))
        order by s.name limit 20`,
      [req.tenant.id, like, digits.length >= 6 ? digits : '']);
    res.json(rows.map((c) => ({ ...c, state: stateOf(c), expires_at: undefined })));
  }));

  app.get('/api/field/customers/:id', use, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query(`${CUSTOMER_SELECT} where s.tenant_id=$1 and s.id=$2`, [req.tenant.id, req.params.id]);
    if (!c) return res.status(404).json({ error: 'No such customer' });
    const { rows: jobs } = await pool.query(
      `select id, number, subject, kind, status, created_at from tickets
        where tenant_id=$1 and subscriber_id=$2 order by created_at desc limit 8`, [req.tenant.id, c.id]);
    res.json({ ...c, state: stateOf(c), expires_at: undefined, jobs });
  }));

  // Drop the customer's session so their router dials back in fresh (a first thing to try on a repair).
  app.post('/api/field/customers/:id/reconnect', use, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query(
      `select s.pppoe_user, r.host, r.secret from subscribers s left join routers r on r.id = s.router_id
        where s.tenant_id=$1 and s.id=$2`, [req.tenant.id, req.params.id]);
    if (!c?.pppoe_user || !c.host) return res.status(409).json({ error: 'This customer has no router or PPPoE login on file.' });
    await radius.disconnectSubscriberSession(pool, c.host, c.secret, c.pppoe_user);
    res.json({ ok: true });
  }));

  // ── the owner's view of the team ───────────────────────────────────────
  app.get('/api/field/team', requirePermission('field.locations'), wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select st.id, st.name, fs.started_at,
              l.lat, l.lng, l.accuracy, l.at as seen_at,
              tk.id as ticket_id, tk.number as ticket_number, tk.subject as ticket_subject
         from field_shifts fs
         join staff st on st.id = fs.staff_id
         left join staff_locations l on l.staff_id = fs.staff_id
         left join tickets tk on tk.id = l.ticket_id
        where fs.tenant_id=$1 and fs.ended_at is null
        order by st.name`, [req.tenant.id]);
    res.json(rows);
  }));

  app.get('/api/field/team/:staffId/trail', requirePermission('field.locations'), wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select lat, lng, at from staff_location_log
        where tenant_id=$1 and staff_id=$2 and at > now() - interval '12 hours' order by at`,
      [req.tenant.id, req.params.staffId]);
    res.json(rows);
  }));
}
