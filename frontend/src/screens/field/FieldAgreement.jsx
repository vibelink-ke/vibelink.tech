import React, { useEffect, useRef, useState } from 'react';
import { color } from '../../theme/tokens';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { Btn, getPosition, panel } from './fieldKit';

/**
 * The customer's service agreement, signed on this phone at the installation (backend agreement.js). The customer
 * reads it, types their name and signs with a finger. Their copy is texted to them. Needs signal: a signature is not
 * kept on the phone to send later.
 */
function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  useEffect(() => {
    const c = ref.current;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * ratio; c.height = h * ratio;
    const g = c.getContext('2d');
    g.scale(ratio, ratio);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#161a17';
  }, []);
  const at = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture?.(e.pointerId); drawing.current = true; const g = ref.current.getContext('2d'); const [x, y] = at(e); g.beginPath(); g.moveTo(x, y); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const g = ref.current.getContext('2d'); const [x, y] = at(e); g.lineTo(x, y); g.stroke();
    if (!inked.current) { inked.current = true; onChange(true); }
  };
  const up = () => { drawing.current = false; };
  const clear = () => {
    const c = ref.current; const g = c.getContext('2d');
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.restore();
    inked.current = false; onChange(false);
  };
  SignaturePad.toPng = () => ref.current?.toDataURL('image/png');
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <canvas
        ref={ref}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
        aria-label="Sign here with your finger"
        style={{ width: '100%', height: 170, border: `1px dashed ${color.line}`, borderRadius: 10, background: '#fff', touchAction: 'none' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: color.muted }}>
        <span>Sign above with your finger</span>
        <button type="button" onClick={clear} style={{ border: 0, background: 'none', color: color.green, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Clear</button>
      </div>
    </div>
  );
}

export default function FieldAgreement({ jobId, customerName }) {
  const store = useStore();
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(customerName ?? '');
  const [read, setRead] = useState(false);
  const [inked, setInked] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api.fieldAgreement(jobId).then(setInfo).catch(() => setInfo(null));
  useEffect(() => { load(); }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return null;
  const save = async () => {
    setBusy(true);
    try {
      const p = await getPosition().catch(() => null);
      const out = await api.signFieldAgreement(jobId, { signature: SignaturePad.toPng(), name: name.trim(), lat: p?.lat, lng: p?.lng });
      store.toast(out.texted ? 'Signed. The customer has their copy by SMS' : 'Signed and saved');
      setOpen(false);
      await load();
    } catch (e) {
      store.toast(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={panel}>
      <div style={{ fontWeight: 600 }}>Customer agreement</div>
      {info.signed ? (
        <div style={{ fontSize: 13.5 }}>
          Signed by <b>{info.signed.name}</b>, {new Date(info.signed.at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.{' '}
          <a href={info.signed.link} target="_blank" rel="noreferrer" style={{ color: color.green, fontWeight: 600 }}>Open the signed copy</a>
        </div>
      ) : !open ? (
        <>
          <div style={{ fontSize: 13.5, color: '#4a524c' }}>Record the equipment first, so it is listed in the agreement. Then let the customer read and sign. Needs signal.</div>
          <Btn tone="quiet" onClick={() => { setOpen(true); load(); }}>Sign with the customer</Btn>
        </>
      ) : (
        <>
          <div style={{ maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.5, border: `1px solid ${color.line}`, borderRadius: 10, padding: 12, background: '#fafbf9' }}>
            {info.text}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} style={{ marginTop: 3 }} />
            I have read this agreement and agree to it.
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
            <span>Name of the person signing</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
              style={{ width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `1px solid ${color.line}`, padding: 10, fontSize: 15, fontFamily: 'inherit' }} />
          </label>
          <SignaturePad onChange={setInked} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn tone="quiet" style={{ flex: 1 }} onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn style={{ flex: 2 }} busy={busy} disabled={!read || !inked || name.trim().length < 2} onClick={save}>Save signed agreement</Btn>
          </div>
        </>
      )}
    </div>
  );
}
