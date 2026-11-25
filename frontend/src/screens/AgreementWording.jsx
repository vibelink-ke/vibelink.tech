import React, { useEffect, useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button } from '../ui/primitives';

/**
 * The wording of the service agreement customers sign at installation (backend agreement.js). Words in braces are
 * filled in for each customer. Shown on the Installations screen.
 */
const WORDS = ['{company}', '{customer}', '{account}', '{address}', '{package}', '{price}', '{equipment}', '{support}', '{date}', '{technician}', '{phone}'];

export default function AgreementWording() {
  const store = useStore();
  const canEdit = !!(store.session?.perms?.['agreements.manage'] || store.session?.is_super_admin);
  const [d, setD] = useState(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.agreementWording().then((x) => { setD(x); setText(x.body || x.default); }).catch(() => {}); }, []);
  if (!d) return null;

  const save = async (value) => {
    setBusy(true);
    try { await api.saveAgreementWording({ body: value }); store.toast('Agreement wording saved'); setD((x) => ({ ...x, body: value })); }
    catch (e) { store.toast(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ background: color.cardBg, border: `1px solid ${color.line}`, borderRadius: radius.lg, padding: '14px 16px', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Service agreement</div>
          <div style={{ fontSize: 12.5, color: color.muted }}>What customers sign on the technician's phone at installation. Their copy is texted to them.</div>
        </div>
        <Button size="sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide wording' : canEdit ? 'Edit wording' : 'See wording'}</Button>
      </div>
      {open && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!canEdit}
            rows={16}
            aria-label="Agreement wording"
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: font.sans, fontSize: 13.5, lineHeight: 1.5, padding: 12, border: `1px solid ${color.line}`, borderRadius: radius.md }}
          />
          <div style={{ fontSize: 12, color: color.muted }}>
            Filled in for each customer: {WORDS.map((w) => <code key={w} style={{ fontFamily: font.mono, marginRight: 6 }}>{w}</code>)}
            <div style={{ marginTop: 4 }}>Technicians do not see prices anywhere else, so add <code style={{ fontFamily: font.mono }}>{'{price}'}</code> only if you are happy for them to see it here.</div>
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={() => save(text)} disabled={busy}>{busy ? 'Saving…' : 'Save wording'}</Button>
              <Button onClick={() => { setText(d.default); save(''); }} disabled={busy}>Use the standard wording</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
