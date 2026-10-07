import React, { useEffect, useState } from 'react';
import { color } from '../../theme/tokens';
import { api } from '../../api/client';
import { Button, Modal } from '../../ui/primitives';

/**
 * "Online but no internet?": asks the router about one PPPoE line (account status, the session, whether the router
 * itself has internet, whether the customer's device answers, whether anything is moving) and says the likely cause in
 * plain words. Runs as soon as it opens. `line` is the service line to check.
 */
export default function Troubleshoot({ open, line, onClose }) {
  const [res, setRes] = useState(null);   // { busy } | { error } | the /diagnose result

  const run = async () => {
    if (!line) return;
    setRes({ busy: true });
    try { setRes(await api.diagnoseLine(line.id)); } catch (e) { setRes({ error: e.message }); }
  };

  useEffect(() => {
    if (open && line) run();
    if (!open) setRes(null);
  }, [open, line?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const dot = (level) => (level === 'bad' ? color.rust : level === 'warn' ? color.amberInk : color.green);

  return (
    <Modal
      open={open}
      title={`Troubleshoot — ${line?.pppoe_user ?? line?.name ?? ''}`}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={run} disabled={!!res?.busy}>{res?.busy ? 'Checking…' : 'Run again'}</Button>
        </>
      }
    >
      {res?.busy && <div style={{ fontSize: 13.5, color: color.muted }}>Asking the router about this line…</div>}
      {res?.error && <div style={{ fontSize: 13.5, color: color.rust }}>{res.error}</div>}
      {res?.findings && (
        <div style={{ display: 'grid', gap: 12 }}>
          {res.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, alignItems: 'flex-start' }}>
              <span style={{ marginTop: 6, width: 9, height: 9, borderRadius: 99, flex: 'none', background: dot(f.level) }} />
              <span>{f.text}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: 10, fontSize: 12, color: color.muted, display: 'grid', gap: 3 }}>
            {res.session && <div>Session: {res.session.address ?? 'no address'}{res.session.callerId ? ` · ${res.session.callerId}` : ''}</div>}
            {res.ping && <div>Router to customer's device: {res.ping.received}/{res.ping.sent} replies{res.ping.avgMs != null ? `, ${res.ping.avgMs} ms` : ''}</div>}
            {res.uplink && <div>Router to the internet: {res.uplink.received}/{res.uplink.sent} replies{res.uplink.avgMs != null ? `, ${res.uplink.avgMs} ms` : ''}</div>}
            {res.traffic && <div>Traffic right now: ↓ {(res.traffic.downKbps / 1000).toFixed(2)} Mbps · ↑ {(res.traffic.upKbps / 1000).toFixed(2)} Mbps</div>}
            {res.at && <div>Checked {new Date(res.at).toLocaleTimeString('en-KE')}</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}
