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
// Readings worse than this (metres) are not trusted: the shift will not start on one and the map ignores them.
const MAX_ACCURACY_M = 150;
const KINDS = new Set(['before', 'after', 'other']);   // 'serial' is only ever made by recording equipment

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
   * No shift, no work: every route that shows or changes field work refuses until the person has started a
   * shift (which needs location on). The office — the owner or platform owner, helping from a desk — is not
   * the field team and is exempt. /me, /shift and /location are not behind this: they are how a shift starts.
   */
  // A technician sets up a customer's equipment with the PPPoE login, so it is shown — read-only: nothing under
  // /api/field writes it, and the office routes that do need clients.edit, which a technician does not have.
  const mayCreds = async (req) => !!req.session?.is_super_admin
    || await hasPermission(req.tenant.id, req.session?.role, 'field.view_credentials');

  const onShift = async (req, res, next) => {
    try {
      if (req.session?.is_super_admin || req.session?.role === 'owner') return next();
      const { rowCount } = await pool.query(
        'select 1 from field_shifts where tenant_id=$1 and staff_id=$2 and ended_at is null', [req.tenant.id, me(req)]);
      if (!rowCount) return res.status(409).json({ error: 'Start your shift first — no work can be seen or done while you are off shift.', needsShift: true });
      return next();
    } catch (e) { return next(e); }
  };

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
    const may = async (key) => !!req.session?.is_super_admin || await hasPermission(req.tenant.id, req.session?.role, key);
    res.json({
      id: me(req), name: req.session.name, role: req.session.role,
      company: req.session.company ?? req.tenant.name,
      shift: shift ? { active: true, since: shift.started_at } : { active: false },
      // What the New tab offers: only what the permission matrix lets this login actually do.
      can: { ticket: await may('tickets.edit'), lead: await may('leads.create'), location: await may('field.update_location'), credentials: await may('field.view_credentials') },
    });
  }));

  app.post('/api/field/shift', use, wrap(async (req, res) => {
    const action = String(req.body?.action ?? '');
    if (action === 'start') {
      // A shift only exists with location on: starting needs a real, reasonably accurate fix, so there is
      // no way to be "on shift" while sharing nothing (or a wildly wrong place) with the office.
      const lat = num(req.body?.lat); const lng = num(req.body?.lng); const accuracy = num(req.body?.accuracy);
      if (!validLat(lat) || !validLng(lng)) {
        return res.status(400).json({ error: 'Location is required to start a shift. Switch it on for this app and try again.' });
      }
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
        return res.status(400).json({ error: `Your location is not accurate enough yet (about ${Math.round(accuracy)} m). Step into the open, wait for the GPS to settle and try again.` });
      }
      await pool.query(
        `insert into field_shifts (tenant_id, staff_id) values ($1,$2)
         on conflict (staff_id) where ended_at is null do nothing`, [req.tenant.id, me(req)]);
      await pool.query(
        `insert into staff_locations (tenant_id, staff_id, lat, lng, accuracy, at) values ($1,$2,$3,$4,$5, now())
         on conflict (staff_id) do update set lat=excluded.lat, lng=excluded.lng, accuracy=excluded.accuracy, ticket_id=null, at=now()`,
        [req.tenant.id, me(req), lat, lng, Number.isFinite(accuracy) ? accuracy : null]);
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
    // A cell-tower or Wi-Fi guess hundreds of metres off would drag the pin (and the trail) to the wrong
    // street: keep the last good position instead of overwriting it with a poor one.
    if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) return res.json({ ok: true, skipped: true });

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

  app.get('/api/field/jobs', use, onShift, wrap(async (req, res) => {
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

  app.get('/api/field/jobs/:id', use, onShift, wrap(async (req, res) => {
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
    const { rows: equipment } = await pool.query(
      `select id, name, category, serial_number, mac_address, quantity, deducted, needs_review, review_reason, created_at
         from job_equipment where tenant_id=$1 and ticket_id=$2 order by created_at`, [req.tenant.id, job.id]);
    const seeCreds = await mayCreds(req);
    res.json({ ...j, mine: j.assigned_to === me(req), notes, photos, equipment, pppoe_user: creds?.pppoe_user ?? null, pppoe_pass: seeCreds ? (creds?.pppoe_pass ?? null) : null });
  }));

  // Take an unassigned job.
  app.post('/api/field/jobs/:id/claim', use, onShift, wrap(async (req, res) => {
    const { rows: [t] } = await pool.query(
      `update tickets set assigned_to=$3, status=case when status='open' then 'in_progress' else status end, updated_at=now()
        where tenant_id=$1 and id=$2 and assigned_to is null and status <> 'resolved' returning id`,
      [req.tenant.id, req.params.id, me(req)]);
    if (!t) return res.status(409).json({ error: 'Someone else has taken this job.' });
    res.json({ ok: true });
  }));

  app.post('/api/field/jobs/:id/start', use, onShift, wrap(async (req, res) => {
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

  app.post('/api/field/jobs/:id/notes', use, onShift, wrap(async (req, res) => {
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
  app.post('/api/field/jobs/:id/photos', use, onShift, wrap(async (req, res) => {
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
  app.post('/api/field/jobs/:id/close', use, onShift, wrap(async (req, res) => {
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

    // An install has to say what went in: a device recorded with its serial photo, or that none was used.
    if (job.kind === 'install' && !skip) {
      const { rows: [eq] } = await pool.query('select 1 from job_equipment where tenant_id=$1 and ticket_id=$2 limit 1', [req.tenant.id, job.id]);
      if (!eq && !req.body?.noEquipment) {
        return res.status(409).json({ error: 'Record the equipment you installed (a photo of its serial number), or say that none was used.', needsEquipment: true });
      }
    }

    // An install also leaves the customer's exact spot on the map — and cannot be closed without it: a
    // technician at the site is the only one who knows where the connection really is. The office (anyone the
    // matrix lets close without a photo) is not at the site, so it is exempt, same as the photo rule.
    const lat = num(req.body?.lat); const lng = num(req.body?.lng); const accuracy = num(req.body?.accuracy);
    const mustLocate = job.kind === 'install' && !!job.subscriber_id && !skip;
    if (mustLocate) {
      if (!validLat(lat) || !validLng(lng)) {
        return res.status(409).json({ error: "Save the customer's location before closing an install. Switch location on for this app and try again.", needsLocation: true });
      }
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
        return res.status(409).json({ error: `The location is not accurate enough (about ${Math.round(accuracy)} m). Step into the open, wait for the GPS to settle and try again.`, needsLocation: true });
      }
    }
    if (job.subscriber_id && validLat(lat) && validLng(lng) && (mustLocate || req.body?.saveLocation)) {
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

  app.get('/api/field/customers', use, onShift, wrap(async (req, res) => {
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

  // Pin a customer's service line where the phone is standing. Only that line: a second service is often a
  // different building. Needs a trustworthy fix, same bar as starting a shift.
  app.post('/api/field/customers/:id/location', use, onShift, requirePermission('field.update_location'), wrap(async (req, res) => {
    const lat = num(req.body?.lat); const lng = num(req.body?.lng); const accuracy = num(req.body?.accuracy);
    if (!validLat(lat) || !validLng(lng)) return res.status(400).json({ error: 'A valid position is needed.' });
    if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
      return res.status(400).json({ error: `That reading is not accurate enough (about ${Math.round(accuracy)} m). Step outside the building, wait for the GPS to settle and try again.` });
    }
    const { rows: [c] } = await pool.query(
      'update subscribers set lat=$3, lng=$4 where tenant_id=$1 and id=$2 returning id, lat, lng', [req.tenant.id, req.params.id, lat, lng]);
    if (!c) return res.status(404).json({ error: 'No such customer' });
    res.json({ ok: true, lat: c.lat, lng: c.lng });
  }));

  app.get('/api/field/customers/:id', use, onShift, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query(`${CUSTOMER_SELECT} where s.tenant_id=$1 and s.id=$2`, [req.tenant.id, req.params.id]);
    if (!c) return res.status(404).json({ error: 'No such customer' });
    const { rows: jobs } = await pool.query(
      `select id, number, subject, kind, status, created_at from tickets
        where tenant_id=$1 and subscriber_id=$2 order by created_at desc limit 8`, [req.tenant.id, c.id]);
    const { rows: [cr] } = (await mayCreds(req))
      ? await pool.query('select pppoe_pass from subscribers where tenant_id=$1 and id=$2', [req.tenant.id, c.id])
      : { rows: [] };
    res.json({ ...c, state: stateOf(c), expires_at: undefined, jobs, pppoe_pass: cr?.pppoe_pass ?? null });
  }));

  // Drop the customer's session so their router dials back in fresh (a first thing to try on a repair).
  app.post('/api/field/customers/:id/reconnect', use, onShift, wrap(async (req, res) => {
    const { rows: [c] } = await pool.query(
      `select s.pppoe_user, r.host, r.secret from subscribers s left join routers r on r.id = s.router_id
        where s.tenant_id=$1 and s.id=$2`, [req.tenant.id, req.params.id]);
    if (!c?.pppoe_user || !c.host) return res.status(409).json({ error: 'This customer has no router or PPPoE login on file.' });
    await radius.disconnectSubscriberSession(pool, c.host, c.secret, c.pppoe_user);
    res.json({ ok: true });
  }));

  // ── equipment used on a job ────────────────────────────────────────────
  // A MAC as twelve hex digits, however it was written (AA:BB:.., aa-bb-.., aabb..), or null.
  const macOf = (v) => { const h = String(v ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase(); return h.length === 12 ? h : null; };
  const colonMac = (h) => h.match(/.{2}/g).join(':');
  const cleanSerial = (v) => { const t = String(v ?? '').trim().replace(/\s+/g, ''); return t.length >= 4 ? t.slice(0, 64) : null; };

  /** Which customers this device (by MAC or serial) is already tied to, and how we know. */
  async function deviceUsage(tenantId, { mac, serial }) {
    const out = [];
    const add = (rows, via) => rows.forEach((r) => out.push({ customerId: r.id, name: r.name, account: r.account_code, via, at: r.at ?? null }));
    if (mac) {
      const { rows: sess } = await pool.query(
        `select s.id, s.name, s.account_code, max(a.acctstarttime) as at
           from radacct a join subscribers s on s.pppoe_user = a.username and s.tenant_id = $1
          where upper(regexp_replace(coalesce(a.callingstationid, ''), '[^0-9A-Fa-f]', '', 'g')) = $2
            and a.acctstarttime > now() - interval '90 days'
          group by s.id order by max(a.acctstarttime) desc limit 3`, [tenantId, mac]);
      add(sess, 'has dialled in from this device');
      const { rows: locked } = await pool.query(
        `select id, name, account_code from subscribers
          where tenant_id=$1 and upper(regexp_replace(coalesce(locked_mac::text, ''), '[^0-9A-Fa-f]', '', 'g')) = $2 limit 3`, [tenantId, mac]);
      add(locked, 'has their router locked to this device');
    }
    if (serial) {
      const { rows: onu } = await pool.query(
        `select s.id, s.name, s.account_code from smartolt_onus o join subscribers s on s.id = o.subscriber_id
          where o.tenant_id=$1 and lower(o.sn) = lower($2) limit 3`, [tenantId, serial]).catch(() => ({ rows: [] }));
      add(onu, 'is linked to this ONU in SmartOLT');
      const { rows: bySn } = await pool.query(
        'select id, name, account_code from subscribers where tenant_id=$1 and lower(onu_sn) = lower($2) limit 3', [tenantId, serial]);
      add(bySn, 'has this ONU serial on their account');
    }
    const { rows: inv } = await pool.query(
      `select s.id, s.name, s.account_code from inventory_items i join subscribers s on s.id = i.subscriber_id
        where i.tenant_id=$1 and i.status='installed'
          and (($2::text is not null and upper(regexp_replace(coalesce(i.mac_address, ''), '[^0-9A-Fa-f]', '', 'g')) = $2)
            or ($3::text is not null and lower(btrim(i.serial_number)) = lower($3))) limit 3`, [tenantId, mac ?? null, serial ?? null]);
    add(inv, 'has this device installed (inventory)');
    const seen = new Set();
    return out.filter((u) => { const k = `${u.customerId}|${u.via}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  /** The inventory item a scanned serial or MAC belongs to; the technician's own van stock first. */
  async function findItem(tenantId, { id, mac, serial, staffId }) {
    if (id) {
      const { rows: [it] } = await pool.query('select * from inventory_items where tenant_id=$1 and id=$2', [tenantId, id]);
      return it ?? null;
    }
    if (!mac && !serial) return null;
    const { rows: [it] } = await pool.query(
      `select * from inventory_items
        where tenant_id=$1
          and (($2::text is not null and upper(regexp_replace(coalesce(mac_address, ''), '[^0-9A-Fa-f]', '', 'g')) = $2)
            or ($3::text is not null and lower(btrim(serial_number)) = lower($3)))
        order by (assigned_staff_id = $4) desc nulls last, (status = 'in_stock') desc, created_at desc
        limit 1`, [tenantId, mac ?? null, serial ?? null, staffId]);
    return it ?? null;
  }

  const itemView = (it) => it && ({
    id: it.id, name: it.name, category: it.category, tracking: it.tracking, status: it.status, location: it.location,
    serial: it.serial_number, mac: it.mac_address, quantity: it.quantity, unit: it.unit,
    inMyVan: it.assigned_staff_id != null,
  });

  // ── raising work from the phone: a support ticket, or a lead ───────────
  // Both check the same permission the office screen does (tickets.edit, leads.create), on top of
  // field.use, so the matrix stays the one place that decides who may do what.
  const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

  app.post('/api/field/tickets', use, onShift, requirePermission('tickets.edit'), wrap(async (req, res) => {
    const subject = String(req.body?.subject ?? '').trim().slice(0, 200);
    if (!subject) return res.status(400).json({ error: 'Say what the problem is.' });
    const priority = PRIORITIES.has(req.body?.priority) ? req.body.priority : 'medium';
    const kind = req.body?.kind === 'install' ? 'install' : 'repair';
    const subscriberId = req.body?.subscriberId || null;
    if (subscriberId) {
      const { rowCount } = await pool.query('select 1 from subscribers where tenant_id=$1 and id=$2', [req.tenant.id, subscriberId]);
      if (!rowCount) return res.status(404).json({ error: 'No such customer.' });
    }
    // Same promise-keeping as the office's New ticket: an enabled SLA policy for this priority sets the due time.
    const { rows: [policy] } = await pool.query(
      `select id, resolve_mins from sla_policies
        where tenant_id=$1 and priority=$2 and coalesce(enabled, true) order by resolve_mins asc limit 1`,
      [req.tenant.id, priority]);
    const { rows: [t] } = await pool.query(
      `insert into tickets (tenant_id, number, subject, subscriber_id, priority, sla_policy_id, due_at, kind, assigned_to)
       values ($1, 'TK-' || substr(gen_random_uuid()::text,1,6), $2, $3, $4, $5, $6, $7, $8)
       returning id, number, subject, kind, priority, status`,
      [req.tenant.id, subject, subscriberId, priority, policy?.id ?? null,
       policy ? new Date(Date.now() + policy.resolve_mins * 60000) : null, kind,
       req.body?.assignToMe === false ? null : me(req)]);
    const note = String(req.body?.note ?? '').trim();
    if (note) {
      await pool.query(
        'insert into ticket_notes (tenant_id, ticket_id, author, body, internal) values ($1,$2,$3,$4,true)',
        [req.tenant.id, t.id, req.session.name, note.slice(0, 2000)]);
    }
    res.json(t);
  }));

  app.post('/api/field/leads', use, onShift, requirePermission('leads.create'), wrap(async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 120);
    const phone = String(req.body?.phone ?? '').trim().slice(0, 30);
    if (!name) return res.status(400).json({ error: 'Enter their name.' });
    if (phone.replace(/[^0-9]/g, '').length < 9) return res.status(400).json({ error: 'Enter a phone number we can reach them on.' });
    const lat = num(req.body?.lat); const lng = num(req.body?.lng);
    const { rows: [l] } = await pool.query(
      `insert into leads (tenant_id, name, phone, source, assigned_to, created_by, lat, lng)
       values ($1,$2,$3,'field visit',$4,$4,$5,$6) returning id, name, phone, status`,
      [req.tenant.id, name, phone, me(req), validLat(lat) && validLng(lng) ? lat : null, validLat(lat) && validLng(lng) ? lng : null]);
    const note = String(req.body?.note ?? '').trim();
    if (note) {
      await pool.query('insert into lead_notes (tenant_id, lead_id, author, body) values ($1,$2,$3,$4)',
        [req.tenant.id, l.id, req.session.name, note.slice(0, 2000)]);
    }
    res.json(l);
  }));

  // What the technician is carrying, and the counted stock they can draw on.
  app.get('/api/field/inventory', use, onShift, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select * from inventory_items
        where tenant_id=$1 and status = 'in_stock'
          and ((tracking = 'serialized' and location = 'van' and assigned_staff_id = $2)
            or (tracking = 'bulk' and quantity > 0))
        order by tracking, name limit 200`, [req.tenant.id, me(req)]);
    res.json(rows.map(itemView));
  }));

  // "What is this?" for a serial or MAC just read off a label: the inventory item, and who already uses the device.
  app.post('/api/field/equipment/lookup', use, onShift, wrap(async (req, res) => {
    const mac = macOf(req.body?.mac); const serial = cleanSerial(req.body?.serial);
    if (!mac && !serial) return res.status(400).json({ error: 'Give a serial number or a MAC address.' });
    const item = await findItem(req.tenant.id, { mac, serial, staffId: me(req) });
    const usage = await deviceUsage(req.tenant.id, { mac: mac ?? macOf(item?.mac_address), serial: serial ?? item?.serial_number ?? null });
    const jobCustomer = req.body?.jobId
      ? (await pool.query('select subscriber_id from tickets where tenant_id=$1 and id=$2', [req.tenant.id, req.body.jobId])).rows[0]?.subscriber_id
      : null;
    const others = usage.filter((u) => u.customerId !== jobCustomer);
    res.json({
      item: itemView(item),
      usage,
      conflict: others.length > 0 || (item?.status === 'installed' && item.subscriber_id && item.subscriber_id !== jobCustomer),
    });
  }));

  /**
   * Record equipment on a job.
   *
   * A serialized device (router, ONU, CPE, anything with an identity) needs a photo of its serial
   * label; the serial and MAC come from that photo (read in the app, confirmed by the technician),
   * are matched to the inventory item, and the item is moved onto the customer: no longer in stock,
   * tied to them, the move logged. A counted item (cable, connectors) is deducted by quantity, with
   * no photo. A device the inventory does not know, or one already installed for someone else, is
   * still recorded, but flagged for the office to check rather than silently guessed at.
   */
  app.post('/api/field/jobs/:id/equipment', use, onShift, wrap(async (req, res) => {
    const job = await jobFor(req, res, req.params.id);
    if (!job) return;
    if (job.status === 'resolved') return res.status(409).json({ error: 'This job is already closed.' });

    const body = req.body ?? {};
    const mac = macOf(body.mac); const serial = cleanSerial(body.serial);
    const item = await findItem(req.tenant.id, { id: body.inventoryItemId, mac, serial, staffId: me(req) });
    const counted = item?.tracking === 'bulk';
    const qty = counted ? Math.max(1, Math.trunc(Number(body.quantity)) || 1) : 1;

    let photo = null;
    if (!counted) {
      photo = parsePhoto(body.photo);
      if (!photo) return res.status(400).json({ error: 'Take a photo of the serial-number label on the device.' });
      if (!mac && !serial && !(item?.serial_number || item?.mac_address)) {
        return res.status(400).json({ error: 'Type or scan the serial number or MAC address from the label.' });
      }
    } else if (qty > item.quantity) {
      return res.status(409).json({ error: `Only ${item.quantity}${item.unit ? ' ' + item.unit : ''} of that in stock.` });
    }

    // Where the device is already known to be, other than on this customer.
    const useMac = mac ?? macOf(item?.mac_address); const useSerial = serial ?? item?.serial_number ?? null;
    const usage = counted ? [] : await deviceUsage(req.tenant.id, { mac: useMac, serial: useSerial });
    const others = usage.filter((u) => u.customerId !== job.subscriber_id);
    const elsewhere = !counted && item?.status === 'installed' && item.subscriber_id && item.subscriber_id !== job.subscriber_id;
    if ((others.length || elsewhere) && !body.acknowledgeConflict) {
      return res.status(409).json({ error: 'This device is already in use by another customer.', conflict: true, usage: others });
    }

    const reasons = [];
    if (!counted && !item) reasons.push('Not in inventory: nothing was deducted');
    if (others.length) reasons.push(`Already used by ${others.map((o) => `${o.name} (${o.account})`).join(', ')}`);
    if (elsewhere) reasons.push('Was recorded as installed for a different customer');
    if (!counted && item && item.status !== 'in_stock' && item.status !== 'installed') reasons.push(`Was marked ${item.status}`);

    const c = await pool.connect();
    try {
      await c.query('begin');
      let photoId = null;
      if (photo) {
        const { rows: [p] } = await c.query(
          `insert into ticket_photos (tenant_id, ticket_id, staff_id, kind, mime, data) values ($1,$2,$3,'serial',$4,$5) returning id`,
          [req.tenant.id, job.id, me(req), photo.mime, photo.buf]);
        photoId = p.id;
      }
      let deducted = false;
      if (item && counted) {
        await c.query('update inventory_items set quantity = quantity - $2, updated_at = now() where id=$1', [item.id, qty]);
        await c.query(
          `insert into inventory_movements (tenant_id, item_id, action, from_location, to_location, staff_id, subscriber_id, quantity, note)
           values ($1,$2,'installed',$3,'premises',$4,$5,$6,$7)`,
          [req.tenant.id, item.id, item.location, me(req), job.subscriber_id, qty, `Used on job ${job.number}`]);
        deducted = true;
      } else if (item) {
        // Fill in whichever identifier the record lacked, from the label. A clash with another record is left alone.
        const macText = useMac ? colonMac(useMac) : null;
        // A savepoint, because a clash on the MAC would otherwise abort the whole transaction.
        await c.query('savepoint fill');
        try {
          await c.query(
            `update inventory_items set location='premises', status='installed', subscriber_id=$2, assigned_staff_id=null,
                    mac_address = coalesce(mac_address, $3), serial_number = coalesce(serial_number, $4), updated_at = now()
              where id=$1`, [item.id, job.subscriber_id, macText, useSerial]);
          await c.query('release savepoint fill');
        } catch (e) {
          if (e.code !== '23505') throw e;
          await c.query('rollback to savepoint fill');
          await c.query(`update inventory_items set location='premises', status='installed', subscriber_id=$2, assigned_staff_id=null, updated_at=now() where id=$1`, [item.id, job.subscriber_id]);
        }
        await c.query(
          `insert into inventory_movements (tenant_id, item_id, action, from_location, to_location, staff_id, subscriber_id, quantity, note)
           values ($1,$2,'installed',$3,'premises',$4,$5,1,$6)`,
          [req.tenant.id, item.id, item.location, me(req), job.subscriber_id, `Installed on job ${job.number}`]);
        deducted = true;
      }
      const { rows: [row] } = await c.query(
        `insert into job_equipment (tenant_id, ticket_id, staff_id, item_id, name, category, serial_number, mac_address, quantity,
                                     photo_id, deducted, needs_review, review_reason, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [req.tenant.id, job.id, me(req), item?.id ?? null, item?.name ?? (String(body.name ?? '').trim() || null), item?.category ?? (String(body.category ?? '').trim() || null),
         useSerial, useMac ? colonMac(useMac) : null, qty, photoId, deducted, reasons.length > 0, reasons.join('; ') || null,
         String(body.note ?? '').trim().slice(0, 500) || null]);
      await c.query('commit');
      res.json({ ok: true, id: row.id, matched: !!item, deducted, needsReview: reasons.length > 0, reasons });
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
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
