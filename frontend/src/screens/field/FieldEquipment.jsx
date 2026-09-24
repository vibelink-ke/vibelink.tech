import React, { useEffect, useRef, useState } from 'react';
import { color } from '../../theme/tokens';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { Btn, Chip, panel, resizePhoto } from './fieldKit';
import { scanLabel } from './scan';
import { doOrQueue, isNetworkError } from './offline';

const inputStyle = {
  width: '100%', boxSizing: 'border-box', height: 46, borderRadius: 10, border: `1px solid ${color.line}`,
  padding: '0 12px', fontSize: 16, fontFamily: 'monospace',
};

/**
 * Recording a device or material used on a job.
 *
 * A router, ONU or CPE: photograph its serial-number label. The serial and MAC are read from the photo
 * (barcode first, then the printed text), shown for the technician to correct, matched to the inventory
 * item, and checked against the customers already using that device. Counted materials (cable,
 * connectors) are picked from stock with a quantity, no photo. With no signal the record is kept on the
 * phone and matched to stock when it is sent.
 */
export default function AddEquipment({ job, onDone, onCancel }) {
  const store = useStore();
  const fileRef = useRef(null);
  const [mode, setMode] = useState(null);           // null | 'scan' | 'counted'
  const [busy, setBusy] = useState('');
  const [photo, setPhoto] = useState(null);         // data URL kept and sent
  const [serial, setSerial] = useState('');
  const [mac, setMac] = useState('');
  const [how, setHow] = useState('');
  const [suggest, setSuggest] = useState({ serials: [], macs: [] });
  const [check, setCheck] = useState(null);         // the server's answer about this device
  const [warn, setWarn] = useState(null);           // a conflict the technician must confirm
  const [note, setNote] = useState('');
  const [stock, setStock] = useState(null);
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState('1');

  useEffect(() => {
    if (mode !== 'counted') return;
    api.fieldInventory().then((rows) => setStock(rows.filter((r) => r.tracking === 'bulk'))).catch(() => setStock([]));
  }, [mode]);

  const onFile = async (file) => {
    if (!file) return;
    setBusy('scan');
    setCheck(null); setWarn(null); setHow('');
    try {
      // The photo and the boxes to type in appear at once; reading the label carries on behind them, and
      // fills only what is still empty when it finishes, so slow or no signal never holds anyone up.
      setPhoto(await resizePhoto(file, 1600, 0.8));
    } catch (e) {
      store.toast(e.message ?? 'That photo could not be read');
      setBusy('');
      return;
    }
    scanLabel(file).then(async (found) => {
      setSuggest(found);
      setHow(found.how);
      setSerial((s) => s || found.serials[0] || '');
      setMac((m) => m || found.macs[0] || '');
      if (found.serials[0] || found.macs[0]) await lookup(found.serials[0] ?? '', found.macs[0] ?? '');
    }).catch(() => setHow('none')).finally(() => setBusy(''));
  };

  const lookup = async (s = serial, m = mac) => {
    if (!s.trim() && !m.trim()) return;
    try {
      setCheck(await api.fieldLookup({ serial: s.trim() || undefined, mac: m.trim() || undefined, jobId: job.id }));
    } catch (e) {
      // No signal (or a value the server cannot use): carry on, the office matches it to stock later.
      setCheck(isNetworkError(e) ? { offline: true } : null);
    }
  };

  const save = async (acknowledgeConflict = false) => {
    setBusy('save');
    try {
      const body = mode === 'counted'
        ? { inventoryItemId: pick, quantity: Number(qty) || 1, note: note.trim() || undefined }
        : { photo, serial: serial.trim() || undefined, mac: mac.trim() || undefined, note: note.trim() || undefined, acknowledgeConflict };
      const r = await doOrQueue('equipment', { jobId: job.id, body });
      store.toast(r.queued ? 'Saved on the phone — it will be sent when the signal returns'
        : r.result?.needsReview ? 'Recorded — the office will check it' : r.result?.deducted ? 'Recorded and taken off stock' : 'Recorded');
      onDone();
    } catch (e) {
      if (e.body?.conflict) setWarn(e.body);
      else store.toast(e.message ?? 'That did not work');
    } finally {
      setBusy('');
    }
  };

  const canSaveScan = !!photo && (serial.trim() || mac.trim());
  const canSaveCounted = !!pick && Number(qty) >= 1;

  return (
    <div style={{ ...panel, borderColor: color.green }}>
      <div style={{ fontWeight: 600 }}>Add equipment</div>

      {!mode && (
        <>
          <Btn onClick={() => setMode('scan')}>Router / ONU / CPE — scan its label</Btn>
          <Btn tone="quiet" onClick={() => setMode('counted')}>Cable or connectors — from stock</Btn>
          <Btn tone="quiet" onClick={onCancel}>Cancel</Btn>
        </>
      )}

      {mode === 'scan' && (
        <>
          <div style={{ fontSize: 13.5, color: '#4a524c' }}>Take a clear photo of the label with the serial number (and MAC). It is read for you; check it.</div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />
          <Btn tone={photo ? 'quiet' : 'primary'} onClick={() => fileRef.current?.click()}>
            {photo ? 'Retake the photo' : 'Photograph the label'}
          </Btn>
          {photo && (
            <>
              <img src={photo} alt="label" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 8, background: '#eee' }} />
              <div style={{ fontSize: 12.5, color: how === 'none' ? color.amberInk : color.muted }}>
                {busy === 'scan' ? 'Reading the label… you can type the serial now if you prefer.'
                  : how === 'barcode' ? 'Read from the barcode.'
                    : how === 'text' ? 'Read from the printed text — check every character.'
                      : 'Could not read it automatically — type the serial from the label.'}
              </div>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Serial number</label>
              <input value={serial} onChange={(e) => setSerial(e.target.value)} onBlur={() => lookup()} style={inputStyle} autoCapitalize="characters" />
              {suggest.serials.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {suggest.serials.map((s) => <span key={s} onClick={() => { setSerial(s); lookup(s, mac); }} style={{ cursor: 'pointer' }}><Chip tone="blue">{s}</Chip></span>)}
                </div>
              )}
              <label style={{ fontSize: 13, fontWeight: 600 }}>MAC address</label>
              <input value={mac} onChange={(e) => setMac(e.target.value)} onBlur={() => lookup()} style={inputStyle} autoCapitalize="characters" placeholder="AA:BB:CC:DD:EE:FF" />
              {suggest.macs.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {suggest.macs.map((m) => <span key={m} onClick={() => { setMac(m); lookup(serial, m); }} style={{ cursor: 'pointer' }}><Chip tone="blue">{m}</Chip></span>)}
                </div>
              )}
              {check && !check.offline && (
                <div style={{ fontSize: 13.5, background: '#f4f5f2', borderRadius: 10, padding: 10, lineHeight: 1.5 }}>
                  {check.item
                    ? <div><b>{check.item.name}</b> is in stock records{check.item.inMyVan ? ' (in your van)' : ''}. It will be taken off stock.</div>
                    : <div style={{ color: color.amberInk }}>Not in the stock list. It will be recorded and the office will check it.</div>}
                  {check.usage.map((u) => (
                    <div key={u.customerId + u.via} style={{ color: color.rust, marginTop: 4 }}>
                      Already used by <b>{u.name}</b> ({u.account}) — {u.via}.
                    </div>
                  ))}
                </div>
              )}
              {check?.offline && <div style={{ fontSize: 13, color: color.muted }}>No signal: it will be matched to stock when it is sent.</div>}
              {warn && (
                <div style={{ fontSize: 13.5, color: color.rust, lineHeight: 1.5 }}>
                  This device is already in use by another customer. If you are sure it is this one, record it anyway and the office will be told to check.
                </div>
              )}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ ...inputStyle, fontFamily: 'inherit' }} />
              <Btn disabled={!canSaveScan} busy={busy === 'save'} onClick={() => save(!!warn)} tone={warn ? 'danger' : 'primary'}>
                {warn ? 'Record it anyway' : 'Record this device'}
              </Btn>
            </>
          )}
          <Btn tone="quiet" onClick={onCancel}>Cancel</Btn>
        </>
      )}

      {mode === 'counted' && (
        <>
          {stock === null && <div style={{ color: color.muted, fontSize: 13.5 }}>Loading stock…</div>}
          {stock && !stock.length && <div style={{ color: color.muted, fontSize: 13.5 }}>No counted stock is available (or there is no signal).</div>}
          {stock && stock.map((s) => (
            <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14.5 }}>
              <input type="radio" name="stock" checked={pick === s.id} onChange={() => setPick(s.id)} />
              {s.name} <span style={{ color: color.muted }}>({s.quantity}{s.unit ? ` ${s.unit}` : ''} left)</span>
            </label>
          ))}
          <label style={{ fontSize: 13, fontWeight: 600 }}>How many used</label>
          <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" style={inputStyle} />
          <Btn disabled={!canSaveCounted} busy={busy === 'save'} onClick={() => save()}>Record and take off stock</Btn>
          <Btn tone="quiet" onClick={onCancel}>Cancel</Btn>
        </>
      )}
    </div>
  );
}
