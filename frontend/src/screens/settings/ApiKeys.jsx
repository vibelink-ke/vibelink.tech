import React, { useCallback, useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Input } from '../../ui/primitives';

const when = (d) => (d ? new Date(d).toLocaleString() : '—');

/**
 * API keys for SkyPlan: with one, SkyPlan (on its own site or on someone's computer) can load this network and, if the key
 * was made with write access, save its changes back. A key only reaches the network design — never customers' money or
 * settings — belongs to this organisation alone, and is shown once, when it is made.
 */
export default function ApiKeys() {
  const store = useStore();
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [fresh, setFresh] = useState(null);   // the key just made, shown once

  const load = useCallback(async () => {
    try { setKeys(await api.apiKeys()); } catch (e) { store.toast(`Could not load keys: ${e.message}`); setKeys([]); }
  }, [store]);
  useEffect(() => { load(); }, [load]);

  const make = async () => {
    if (!name.trim()) return store.toast('Give the key a name, for example "Office laptop".');
    try {
      const made = await api.createApiKey({ name: name.trim(), canWrite });
      setFresh(made);
      setName('');
      load();
    } catch (e) { store.toast(`Could not make the key: ${e.message}`); }
  };

  const revoke = async (k) => {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working straight away.`)) return;
    try { await api.revokeApiKey(k.id); load(); } catch (e) { store.toast(`Could not revoke: ${e.message}`); }
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); store.toast('Copied'); } catch { store.toast('Copy it by hand — your browser would not allow it'); }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card title="Connect SkyPlan" subtitle="Load your live network into SkyPlan, and save your design back">
        <div style={{ display: 'grid', gap: 10, fontSize: 13, lineHeight: 1.55 }}>
          <span>
            In SkyPlan open <strong>Connect to billing</strong>, then paste this address and a key from below.
            A key reaches only your network design — towers, equipment, fibre and the customers' places on the map.
            It never deletes anything.
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ fontFamily: font.mono, background: color.tileBg, padding: '5px 9px', borderRadius: 6 }}>{window.location.origin}</code>
            <Button size="sm" onClick={() => copy(window.location.origin)}>Copy address</Button>
          </div>
        </div>
      </Card>

      {fresh && (
        <Card title="Your new key" subtitle="Copy it now — it is shown only this once">
          <div style={{ display: 'grid', gap: 10 }}>
            <code style={{ fontFamily: font.mono, background: color.tileBg, padding: '8px 10px', borderRadius: 6, wordBreak: 'break-all', fontSize: 12.5 }}>{fresh.key}</code>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" size="sm" onClick={() => copy(fresh.key)}>Copy key</Button>
              <Button size="sm" onClick={() => setFresh(null)}>I have copied it</Button>
            </div>
          </div>
        </Card>
      )}

      <Card title="Make a key">
        <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Office laptop" />
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <input type="checkbox" checked={canWrite} onChange={(e) => setCanWrite(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Allow saving back. Without this the key can only read your network.</span>
          </label>
          <div><Button variant="primary" onClick={make}>Make key</Button></div>
        </div>
      </Card>

      <Card title="Your keys">
        {keys === null ? (
          <span style={{ color: color.muted, fontSize: 13 }}>Loading…</span>
        ) : keys.length === 0 ? (
          <span style={{ color: color.muted, fontSize: 13 }}>No keys yet.</span>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {keys.map((k) => (
              <div key={k.id} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', border: `1px solid ${color.line}`, borderRadius: 8, padding: '9px 11px' }}>
                <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {k.name} <span style={{ fontFamily: font.mono, color: color.muted, fontWeight: 400 }}>…{k.key_last4}</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: color.muted }}>
                    Made {when(k.created_at)} · last used {when(k.last_used_at)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {k.revoked_at ? <Badge tone="failed">Revoked</Badge> : <Badge tone={k.can_write ? "pending" : "active"}>{k.can_write ? 'Read and save' : 'Read only'}</Badge>}
                  {!k.revoked_at && <Button size="sm" onClick={() => revoke(k)}>Revoke</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
