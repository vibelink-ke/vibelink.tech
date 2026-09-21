import React, { useCallback, useEffect, useState } from 'react';
import { color, font } from '../../theme/tokens';
import { useStore } from '../../state/store';
import { api } from '../../api/client';
import { Badge, Button, Card, Field, Input, Modal, Select, Table, Toggle } from '../../ui/primitives';

/**
 * Loyalty points for hotspot visitors, known by the phone number that paid. Each purchase earns points at a rate set
 * here; points are spent on rewards (a free bundle for a number of points). Turning it on changes nothing already
 * earned or sold, and every change to a balance is kept in a history that can be opened per person.
 */
const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const phoneShown = (p) => (String(p).startsWith('254') ? `0${String(p).slice(3)}` : p);

export default function Loyalty() {
  const store = useStore();
  const canManage = !!store.session?.perms?.['loyalty.manage'];
  const [data, setData] = useState(null);
  const [rules, setRules] = useState({ enabled: false, kesPerPoint: 10 });
  const [savingRules, setSavingRules] = useState(false);
  const [newReward, setNewReward] = useState({ planId: '', pointsCost: '' });
  const [redeeming, setRedeeming] = useState(null);   // { phone, points, rewardId }
  const [history, setHistory] = useState(null);       // { phone, rows }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.loyalty();
      setData(d);
      setRules({ enabled: d.enabled, kesPerPoint: d.kesPerPoint });
    } catch (e) {
      setData({ enabled: false, kesPerPoint: 10, rewards: [], members: [] });
      store.toast(e.message);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const saveRules = async () => {
    setSavingRules(true);
    try {
      await api.saveLoyaltySettings({ enabled: rules.enabled, kesPerPoint: Number(rules.kesPerPoint) });
      store.toast(rules.enabled ? 'Loyalty points are on' : 'Loyalty points are off');
      await load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setSavingRules(false);
    }
  };

  const addReward = async () => {
    if (!newReward.planId) return store.toast('Pick the bundle the reward gives');
    if (!(Number(newReward.pointsCost) >= 1)) return store.toast('Enter how many points it costs');
    try {
      await api.addLoyaltyReward({ planId: newReward.planId, pointsCost: Number(newReward.pointsCost) });
      setNewReward({ planId: '', pointsCost: '' });
      await load();
    } catch (e) {
      store.toast(e.message);
    }
  };
  const removeReward = async (r) => {
    if (!window.confirm(`Remove the reward "${r.plan_title}"? Points already earned are not affected.`)) return;
    try { await api.deleteLoyaltyReward(r.id); await load(); } catch (e) { store.toast(e.message); }
  };

  const openRedeem = (m) => {
    const affordable = (data?.rewards ?? []).filter((r) => r.points_cost <= m.points);
    if (!(data?.rewards ?? []).length) return store.toast('Add a reward first');
    if (!affordable.length) return store.toast(`${phoneShown(m.phone)} has ${m.points} point(s) — not enough for any reward yet`);
    setRedeeming({ phone: m.phone, points: m.points, rewardId: affordable[0].id });
  };
  const confirmRedeem = async () => {
    setBusy(true);
    try {
      const out = await api.redeemLoyalty({ phone: redeeming.phone, rewardId: redeeming.rewardId });
      store.toast(`Code ${out.code} created${out.smsSent ? ' and texted' : ' (the SMS could not be sent)'} — ${out.remaining} point(s) left`);
      setRedeeming(null);
      await load();
    } catch (e) {
      store.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (m) => {
    const raw = window.prompt(`Points to add (or take away, with a minus) for ${phoneShown(m.phone)}. They have ${m.points}.`, '10');
    if (raw === null) return;
    const delta = Math.round(Number(raw));
    if (!delta) return store.toast('Enter a number of points');
    const note = window.prompt('Why? (kept in their history)', '') ?? '';
    try {
      await api.adjustLoyalty({ phone: m.phone, delta, note });
      store.toast('Points updated');
      await load();
    } catch (e) {
      store.toast(e.message);
    }
  };

  const showHistory = async (m) => {
    try { setHistory({ phone: m.phone, rows: await api.loyaltyLedger(m.phone) }); } catch (e) { store.toast(e.message); }
  };

  if (!data) return <Card><div style={{ color: color.muted }}>Loading…</div></Card>;
  const rewardOf = (id) => data.rewards.find((r) => r.id === id);
  const plans = store.hsPlans ?? [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <Card title="Loyalty points" subtitle="Reward visitors who keep coming back: points for every purchase, spent on free bundles">
        <div style={{ display: 'grid', gap: 12, maxWidth: 460, pointerEvents: canManage ? 'auto' : 'none', opacity: canManage ? 1 : 0.7 }}>
          <Toggle
            checked={rules.enabled}
            onChange={(v) => setRules((r) => ({ ...r, enabled: v }))}
            label="Give loyalty points"
            detail={rules.enabled ? 'On — every hotspot purchase earns points' : 'Off — nothing is earned until you turn it on'}
          />
          <Field label="Shillings that earn 1 point" hint={`Now: KES ${rules.kesPerPoint} spent = 1 point (a KES ${Number(rules.kesPerPoint) * 5} purchase earns 5)`}>
            <Input type="number" min="1" value={rules.kesPerPoint} onChange={(e) => setRules((r) => ({ ...r, kesPerPoint: e.target.value }))} style={{ width: 160 }} />
          </Field>
          {canManage && <Button variant="primary" onClick={saveRules} disabled={savingRules} style={{ alignSelf: 'flex-start' }}>{savingRules ? 'Saving…' : 'Save'}</Button>}
        </div>
      </Card>

      <Card title="Rewards" subtitle="What visitors can spend their points on. Redeeming makes a free code and texts it to them.">
        <Table
          rows={data.rewards}
          rowKey={(r) => r.id}
          empty="No rewards yet — add one below"
          columns={[
            { key: 'plan_title', label: 'Free bundle', render: (r) => <span style={{ fontWeight: 600 }}>{r.plan_title}</span> },
            { key: 'points_cost', label: 'Costs', align: 'right', render: (r) => `${r.points_cost} points` },
            ...(canManage ? [{ key: 'x', label: '', align: 'right', render: (r) => <Button size="sm" onClick={() => removeReward(r)}>Remove</Button> }] : []),
          ]}
        />
        {canManage && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}>
            <Field label="Bundle">
              <Select
                value={newReward.planId}
                onChange={(e) => setNewReward((n) => ({ ...n, planId: e.target.value }))}
                options={[{ value: '', label: plans.length ? 'Select a bundle…' : 'No hotspot bundles yet' }, ...plans.map((p) => ({ value: p.id, label: `${p.title} · KES ${p.price}` }))]}
              />
            </Field>
            <Field label="Points">
              <Input type="number" min="1" value={newReward.pointsCost} onChange={(e) => setNewReward((n) => ({ ...n, pointsCost: e.target.value }))} style={{ width: 120 }} />
            </Field>
            <div style={{ paddingBottom: 6 }}><Button onClick={addReward}>Add reward</Button></div>
          </div>
        )}
      </Card>

      <Card title="Members" subtitle={`${data.members.length} visitor(s) with points, best first`}>
        <Table
          rows={data.members}
          rowKey={(m) => m.phone}
          empty="Nobody has earned points yet"
          columns={[
            { key: 'phone', label: 'Phone', render: (m) => <span style={{ fontFamily: font.mono }}>{phoneShown(m.phone)}</span> },
            { key: 'points', label: 'Points', align: 'right', render: (m) => <Badge tone={{ bg: '#e2ebe5', fg: color.green }}>{m.points}</Badge> },
            { key: 'lifetime_points', label: 'Earned in total', align: 'right', render: (m) => m.lifetime_points },
            { key: 'last_earned_at', label: 'Last earned', render: (m) => when(m.last_earned_at) },
            {
              key: 'act', label: '', align: 'right',
              render: (m) => (
                <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                  <Button size="sm" onClick={() => showHistory(m)}>History</Button>
                  {canManage && <Button size="sm" onClick={() => adjust(m)}>Adjust</Button>}
                  {canManage && <Button size="sm" variant="primary" onClick={() => openRedeem(m)}>Redeem</Button>}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!redeeming}
        title="Redeem points"
        onClose={() => !busy && setRedeeming(null)}
        footer={<><Button onClick={() => setRedeeming(null)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={confirmRedeem} disabled={busy}>{busy ? 'Working…' : 'Redeem and text the code'}</Button></>}
      >
        {redeeming && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ fontSize: 13.5 }}><b style={{ fontFamily: font.mono }}>{phoneShown(redeeming.phone)}</b> has <b>{redeeming.points}</b> points.</div>
            <Field label="Reward">
              <Select
                value={redeeming.rewardId}
                onChange={(e) => setRedeeming((r) => ({ ...r, rewardId: e.target.value }))}
                options={data.rewards.filter((r) => r.points_cost <= redeeming.points).map((r) => ({ value: r.id, label: `${r.plan_title} — ${r.points_cost} points` }))}
              />
            </Field>
            <div style={{ fontSize: 12.5, color: color.muted }}>
              A free code for {rewardOf(redeeming.rewardId)?.plan_title} is made and texted to them (one SMS from your balance). Its time starts when they first sign in.
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!history} title={history ? `History · ${phoneShown(history.phone)}` : ''} onClose={() => setHistory(null)} footer={<Button variant="primary" onClick={() => setHistory(null)}>Close</Button>}>
        {history && (
          history.rows.length ? (
            <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
              {history.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>
                    {r.reason === 'purchase' ? 'Earned on a purchase' : r.reason === 'redeem' ? `Redeemed${r.note ? ` — ${r.note}` : ''}` : `Adjusted${r.note ? ` — ${r.note}` : ''}`}
                    <span style={{ color: color.muted }}> · {when(r.created_at)}</span>
                  </span>
                  <b style={{ color: r.delta < 0 ? color.rust : color.green }}>{r.delta > 0 ? `+${r.delta}` : r.delta}</b>
                </div>
              ))}
            </div>
          ) : <div style={{ color: color.muted }}>Nothing recorded yet.</div>
        )}
      </Modal>
    </div>
  );
}
