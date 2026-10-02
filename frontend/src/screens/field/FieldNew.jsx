import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { color } from '../../theme/tokens';
import { api } from '../../api/client';
import { useStore } from '../../state/store';
import { useField } from './fieldContext';
import { Btn, Dot, getPosition, page, panel } from './fieldKit';

const input = {
  width: '100%', boxSizing: 'border-box', minHeight: 46, borderRadius: 12, border: `1px solid ${color.line}`,
  padding: '0 14px', fontSize: 16, background: '#fff', color: color.ink, fontFamily: 'inherit',
};
const label = { fontSize: 13, fontWeight: 600, color: '#4a524c' };
const Seg = ({ value, options, onChange }) => (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    {options.map(([v, text]) => (
      <button
        key={v} type="button" onClick={() => onChange(v)}
        style={{
          flex: '1 1 0', minHeight: 42, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${value === v ? color.green : color.line}`,
          background: value === v ? color.green : '#fff', color: value === v ? '#fff' : color.ink,
        }}
      >
        {text}
      </button>
    ))}
  </div>
);

/** Raise work from the phone: a support ticket for a customer, or a lead for someone met on the road. */
export default function FieldNew() {
  const { me } = useField();
  const can = me?.can ?? {};
  const [params] = useSearchParams();
  const [which, setWhich] = useState(null);   // 'ticket' | 'lead'

  useEffect(() => {
    if (which || !me) return;
    setWhich(can.ticket ? 'ticket' : can.lead ? 'lead' : 'none');
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return <div style={page}><div style={{ color: color.muted }}>Loading…</div></div>;
  if (which === 'none') return <div style={page}><div style={{ ...panel, color: color.muted }}>Your login cannot raise tickets or leads. Ask the office to switch it on.</div></div>;

  return (
    <div style={page}>
      <h2 style={{ margin: 0, fontSize: 20 }}>New</h2>
      {can.ticket && can.lead && (
        <Seg value={which} onChange={setWhich} options={[['ticket', 'Support ticket'], ['lead', 'Lead']]} />
      )}
      {which === 'ticket' && <TicketForm presetId={params.get('customer')} presetName={params.get('name')} />}
      {which === 'lead' && <LeadForm />}
    </div>
  );
}

function TicketForm({ presetId, presetName }) {
  const store = useStore();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(presetId ? { id: presetId, name: presetName || 'Customer' } : null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [subject, setSubject] = useState('');
  const [kind, setKind] = useState('repair');
  const [priority, setPriority] = useState('medium');
  const [note, setNote] = useState('');
  const [mine, setMine] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (customer || q.trim().length < 2) { setRows(null); return undefined; }
    let stop = false;
    const t = setTimeout(() => { api.fieldCustomers(q.trim()).then((r) => { if (!stop) setRows(r); }).catch(() => {}); }, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [q, customer]);

  const submit = async () => {
    if (!subject.trim()) return store.toast('Say what the problem is first');
    setBusy(true);
    try {
      const t = await api.fieldCreateTicket({
        subject: subject.trim(), subscriberId: customer?.id ?? null, kind, priority, note: note.trim() || undefined, assignToMe: mine,
      });
      store.toast(`${t.number} created`);
      navigate(mine ? `/field/job/${t.id}` : '/field', { replace: true });
    } catch (e) {
      store.toast(`Could not create it: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={panel}>
      <div style={label}>Customer</div>
      {customer ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{customer.name}</span>
          <span onClick={() => setCustomer(null)} style={{ color: color.green, fontWeight: 600, cursor: 'pointer' }}>Change</span>
        </div>
      ) : (
        <>
          <input style={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or account (optional)" />
          {(rows ?? []).map((c) => (
            <div key={c.id} onClick={() => { setCustomer({ id: c.id, name: c.name }); setRows(null); }} style={{ padding: '8px 2px', cursor: 'pointer', borderTop: `1px solid ${color.line}` }}>
              <div style={{ fontWeight: 600 }}><Dot on={c.online} />{c.name}{c.line_label ? ` — ${c.line_label}` : ''}</div>
              <div style={{ fontSize: 12.5, color: color.muted }}>{c.account_code} · {c.phone}</div>
            </div>
          ))}
          {rows && !rows.length && <div style={{ fontSize: 13, color: color.muted }}>Nobody matches “{q}”.</div>}
        </>
      )}
      <div style={label}>What is the problem?</div>
      <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. No internet since morning" />
      <div style={label}>Type</div>
      <Seg value={kind} onChange={setKind} options={[['repair', 'Support / repair'], ['install', 'Install']]} />
      <div style={label}>Priority</div>
      <Seg value={priority} onChange={setPriority} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']]} />
      <div style={label}>Details (optional)</div>
      <textarea style={{ ...input, minHeight: 90, padding: 12 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next person should know" />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assign it to me
      </label>
      <Btn onClick={submit} busy={busy}>Create ticket</Btn>
    </div>
  );
}

function LeadForm() {
  const store = useStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return store.toast('Enter their name first');
    if (phone.replace(/[^0-9]/g, '').length < 9) return store.toast('Enter a phone number we can reach them on');
    setBusy(true);
    try {
      // Where they were met, when the phone will say; a denied or missing location never blocks the lead.
      const pos = await getPosition({ timeout: 6000 }).catch(() => null);
      await api.fieldCreateLead({ name: name.trim(), phone: phone.trim(), note: note.trim() || undefined, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) });
      store.toast(`${name.trim()} added as a lead`);
      setName(''); setPhone(''); setNote('');
    } catch (e) {
      store.toast(`Could not add the lead: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={panel}>
      <div style={label}>Name</div>
      <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Who did you meet?" />
      <div style={label}>Phone</div>
      <input style={input} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
      <div style={label}>Notes (optional)</div>
      <textarea style={{ ...input, minHeight: 90, padding: 12 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where, what they need, when to call back" />
      <div style={{ fontSize: 12.5, color: color.muted }}>Your location is saved with the lead if the phone shares it.</div>
      <Btn onClick={submit} busy={busy}>Add lead</Btn>
    </div>
  );
}
