import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { color } from '../../theme/tokens';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { useField } from './fieldContext';
import { Btn, Chip, Dot, getPosition, mapsLink, page, panel, resizePhoto, timeAgo } from './fieldKit';

const KINDS = [
  { kind: 'before', label: 'Before' },
  { kind: 'after', label: 'After (required)' },
  { kind: 'other', label: 'Other' },
];

export default function FieldJob() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useStore();
  const { setTicketId, loadMe } = useField();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [saveLoc, setSaveLoc] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const fileInputs = useRef({});

  const load = useCallback(() => api.fieldJob(id).then((j) => { setJob(j); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  // The team map shows which job this technician is at.
  useEffect(() => { setTicketId(id); return () => setTicketId(null); }, [id, setTicketId]);

  const run = async (label, fn, done) => {
    setBusy(label);
    try { await fn(); if (done) store.toast(done); await load(); }
    catch (e) { store.toast(e.message ?? 'That did not work'); }
    finally { setBusy(''); }
  };

  const onPhoto = async (kind, file) => {
    if (!file) return;
    setBusy(`photo-${kind}`);
    try {
      const dataUrl = await resizePhoto(file);
      const p = await getPosition().catch(() => null);
      await api.fieldPhoto(id, { dataUrl, kind, lat: p?.lat, lng: p?.lng });
      store.toast('Photo saved');
      await load();
    } catch (e) {
      store.toast(`Could not save the photo: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const close = async () => {
    setBusy('close');
    try {
      const p = await getPosition().catch(() => null);
      await api.fieldClose(id, {
        note: closeNote.trim() || undefined,
        lat: p?.lat, lng: p?.lng,
        saveLocation: !!(p && saveLoc),
      });
      store.toast('Job closed');
      loadMe();
      navigate('/field', { replace: true });
    } catch (e) {
      store.toast(e.message);
      setBusy('');
    }
  };

  if (error) return <div style={page}><div style={{ ...panel, color: color.rust }}>{error}</div><Btn tone="quiet" onClick={() => navigate('/field')}>Back</Btn></div>;
  if (!job) return <div style={page}><div style={{ color: color.muted }}>Loading…</div></div>;

  const install = job.kind === 'install';
  const afterCount = job.photos.filter((p) => p.kind === 'after').length;
  const canClose = afterCount > 0;
  const nav = mapsLink(job.customer_lat != null ? Number(job.customer_lat) : null, job.customer_lng != null ? Number(job.customer_lng) : null, job.customer_location);
  const resolved = job.status === 'resolved';

  return (
    <div style={page}>
      <button onClick={() => navigate('/field')} style={{ background: 'none', border: 'none', color: color.green, fontWeight: 600, fontSize: 14, textAlign: 'left', padding: 0, cursor: 'pointer' }}>← Jobs</button>

      <div style={panel}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip tone={install ? 'blue' : 'neutral'}>{install ? 'Install' : 'Repair'}</Chip>
          <Chip tone={job.priority === 'critical' ? 'red' : job.priority === 'high' ? 'amber' : 'neutral'}>{job.priority}</Chip>
          <Chip tone={resolved ? 'green' : job.status === 'in_progress' ? 'green' : 'neutral'}>{resolved ? 'Closed' : job.status === 'in_progress' ? 'In progress' : 'Open'}</Chip>
        </div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{job.subject}</div>
        {job.description && <div style={{ fontSize: 14, color: '#4a524c', whiteSpace: 'pre-wrap' }}>{job.description}</div>}
        <div style={{ fontSize: 12, color: color.muted }}>{job.number} · raised {timeAgo(job.created_at)}</div>
        {!job.mine && !resolved && (
          <Btn busy={busy === 'claim'} onClick={() => run('claim', () => api.fieldClaim(id), 'The job is yours')}>Take this job</Btn>
        )}
        {job.mine && job.status === 'open' && (
          <Btn busy={busy === 'start'} onClick={() => run('start', () => api.fieldStart(id), 'Job started')}>I have arrived — start</Btn>
        )}
      </div>

      {job.customer_id && (
        <div style={panel}>
          <div style={{ fontWeight: 600 }}><Dot on={job.customer_online} />{job.customer_name}</div>
          <div style={{ fontSize: 13.5, color: '#4a524c' }}>
            {job.account_code ? `Account ${job.account_code}` : ''}{job.plan_title ? ` · ${job.plan_title}${job.rate_down ? ` (${Math.round(job.rate_down / 1000)} Mbps)` : ''}` : ''}
          </div>
          {job.customer_location && <div style={{ fontSize: 13.5 }}>{job.customer_location}</div>}
          <div style={{ fontSize: 13, color: color.muted }}>{job.customer_online ? 'Online now' : 'Not online'}{job.router_name ? ` · tower ${job.router_name}` : ''}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {job.customer_phone && <Btn href={`tel:${job.customer_phone}`} tone="quiet" style={{ flex: 1 }}>Call</Btn>}
            {nav && <Btn href={nav} tone="quiet" style={{ flex: 1 }}>Navigate</Btn>}
            <Btn tone="quiet" style={{ flex: 1 }} onClick={() => navigate(`/field/customers/${job.customer_id}`)}>Details</Btn>
          </div>
          {(job.pppoe_user || job.pppoe_pass) && (
            <div style={{ fontSize: 13.5, background: '#f4f5f2', borderRadius: 10, padding: 10 }}>
              <div style={{ color: color.muted, fontSize: 12, marginBottom: 4 }}>PPPoE login for the customer's router</div>
              <div>User: <b style={{ fontFamily: 'monospace' }}>{job.pppoe_user ?? '—'}</b></div>
              <div>Password: <b style={{ fontFamily: 'monospace' }}>{showPass ? (job.pppoe_pass ?? '—') : '••••••'}</b>{' '}
                <span onClick={() => setShowPass((s) => !s)} style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }}>{showPass ? 'Hide' : 'Show'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={panel}>
        <div style={{ fontWeight: 600 }}>Photos</div>
        <div style={{ fontSize: 13, color: '#4a524c' }}>Take these with the camera. The job cannot be closed without an “after” photo of the finished work.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {KINDS.map(({ kind, label }) => (
            <span key={kind} style={{ flex: 1, minWidth: 96, display: 'flex' }}>
              <input
                ref={(el) => { fileInputs.current[kind] = el; }}
                type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPhoto(kind, f); }}
              />
              <Btn tone={kind === 'after' && !afterCount ? 'primary' : 'quiet'} style={{ flex: 1 }} busy={busy === `photo-${kind}`}
                disabled={resolved} onClick={() => fileInputs.current[kind]?.click()}>{label}</Btn>
            </span>
          ))}
        </div>
        {job.photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {job.photos.map((p) => (
              <a key={p.id} href={`/api/field/photos/${p.id}`} target="_blank" rel="noreferrer" style={{ position: 'relative' }}>
                <img src={`/api/field/photos/${p.id}`} alt={p.kind} loading="lazy"
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                <span style={{ position: 'absolute', left: 4, bottom: 4 }}><Chip tone={p.kind === 'after' ? 'green' : 'neutral'}>{p.kind}</Chip></span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={panel}>
        <div style={{ fontWeight: 600 }}>Notes</div>
        {job.notes.map((n) => (
          <div key={n.id} style={{ fontSize: 13.5, borderLeft: `3px solid ${color.line}`, paddingLeft: 10 }}>
            <div>{n.body}</div>
            <div style={{ fontSize: 11.5, color: color.muted }}>{n.author} · {timeAgo(n.at)}</div>
          </div>
        ))}
        {!resolved && (
          <>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What did you find or do?"
              style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `1px solid ${color.line}`, padding: 10, fontSize: 15, fontFamily: 'inherit' }} />
            <Btn tone="quiet" busy={busy === 'note'} disabled={!note.trim()}
              onClick={() => run('note', async () => { await api.fieldNote(id, note.trim()); setNote(''); }, 'Note added')}>Add note</Btn>
          </>
        )}
      </div>

      {!resolved && job.mine && (
        <div style={panel}>
          <div style={{ fontWeight: 600 }}>Finish</div>
          {!closing ? (
            <>
              <Btn disabled={!canClose} onClick={() => setClosing(true)}>Close this job</Btn>
              {!canClose && <div style={{ fontSize: 13, color: color.amberInk }}>Take an “after” photo first.</div>}
            </>
          ) : (
            <>
              <textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} rows={3} placeholder="Summary of the work (optional)"
                style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `1px solid ${color.line}`, padding: 10, fontSize: 15, fontFamily: 'inherit' }} />
              {(install || job.customer_lat == null) && job.customer_id && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={saveLoc} onChange={(e) => setSaveLoc(e.target.checked)} />
                  Save this spot as the customer's location
                </label>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn tone="quiet" style={{ flex: 1 }} onClick={() => setClosing(false)}>Back</Btn>
                <Btn style={{ flex: 2 }} busy={busy === 'close'} onClick={close}>Close job</Btn>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
