import React, { useEffect, useState } from 'react';
import { color, font, kes, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Empty, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const BLANK = { name: '', subdomain: '', hosting: 'platform', chargeMode: 'usage', hotspotCommissionPct: '3', pppoeClientRate: '16', flatMonthlyFee: '', supportPhone: '' };

export default function Tenants() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [licenceDate, setLicenceDate] = useState('');
  const [licenceBusy, setLicenceBusy] = useState(false);
  // A self-hosted tenant's licence key, shown once when it is made.
  const [instanceKey, setInstanceKey] = useState(null);
  const makeInstanceKey = async (tenant) => {
    if (tenant.has_instance_key
        && !window.confirm('Making a new key stops the old one working at once. Their server will need the new key. Continue?')) return;
    try {
      const out = await api.tenantInstanceKey(tenant.id);
      setInstanceKey({ name: out.name, key: out.key });
      store.setCollection('tenants', (ts) => ts.map((t) => (t.id === tenant.id ? { ...t, has_instance_key: true } : t)));
      setEditing((e) => (e ? { ...e, has_instance_key: true } : e));
    } catch (e) {
      store.toast(`Could not make a key: ${e.message}`);
    }
  };
  const [editing, setEditing] = useState(null);
  // Remove (hide + suspend, keeps everything) and, from the Removed list, Delete permanently.
  // { ...tenant, mode: 'remove' | 'purge', confirmText, force, check }
  // The PPPoE rate and the hotspot percentage, for every tenant at once.
  const [bulkRate, setBulkRate] = useState('');
  const [bulkPct, setBulkPct] = useState('');
  const [bulkNew, setBulkNew] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const openRemoval = (t, mode) => {
    setDeleting({ ...t, mode, confirmText: '', force: false, check: null });
    api.tenantDeleteCheck(t.id).then((c) => setDeleting((d) => (d && d.id === t.id ? { ...d, check: c.blockers } : d))).catch(() => {});
  };
  const [staffFor, setStaffFor] = useState(null);

  /**
   * Licence controls for the tenant open in the panel: add or take back days,
   * or set the exact end date. Days back on the clock switch a lapsed tenant
   * straight back on. Reloads the list afterwards because the status can change
   * as a side effect, and the panel should show the truth.
   */
  const changeLicence = async (run, done) => {
    setLicenceBusy(true);
    try {
      await run();
      const list = await api.tenants();
      store.setCollection('tenants', list);
      setViewing((v) => list.find((t) => t.id === v?.id) ?? v);
      setLicenceDate('');
      store.toast(done);
    } catch (e) {
      store.toast(`Could not change the licence: ${e.message}`);
    } finally {
      setLicenceBusy(false);
    }
  };
  const addLicenceDays = (days) => changeLicence(
    () => api.tenantLicence(viewing.id, days),
    days > 0 ? `Added ${days} days` : `Took back ${-days} days`);
  const setLicenceEnd = () => {
    const future = licenceDate >= new Date().toISOString().slice(0, 10);
    return changeLicence(
      () => api.updateTenant(viewing.id, {
        licence_ends: licenceDate,
        // A date in the future should not leave a lapsed tenant locked out.
        ...(future && ['readonly', 'suspended'].includes(viewing.status) ? { status: 'active' } : {}),
      }),
      'Licence date saved');
  };
  const [staffList, setStaffList] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [balanceFor, setBalanceFor] = useState(null);   // tenant row being topped up
  const [balanceInput, setBalanceInput] = useState('');
  const [balanceCost, setBalanceCost] = useState('');
  const [balancePaidTo, setBalancePaidTo] = useState('');
  const [balanceBusy, setBalanceBusy] = useState(false);

  const [gateways, setGateways] = useState([]);      // every platform-owned gateway (sender)
  const [gwFields, setGwFields] = useState({});
  const [gwForm, setGwForm] = useState(null);         // null=closed, {} for new, {...gw} to edit
  const [gwCreds, setGwCreds] = useState({});
  const [gwBusy, setGwBusy] = useState(false);
  const [gwBalances, setGwBalances] = useState({});   // gateway id -> { loading, value }
  const [assigning, setAssigning] = useState(null);   // tenant id currently being re-saved
  const [relaySources, setRelaySources] = useState([]); // sibling deployments relaying through us
  const [assigningSource, setAssigningSource] = useState(null);
  // Narrowing a long list of tenants: by state, where they run, how they are charged, licence.
  const [tf, setTf] = useState({ status: 'all', hosting: 'all', charge: 'all', licence: 'all' });
  // Payouts sent to Safaricom that have not been confirmed — to mark paid or take back.
  const [inflight, setInflight] = useState([]);
  const loadInflight = () => api.inFlightSettlements().then(setInflight).catch(() => {});
  useEffect(() => { loadInflight(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [upstream, setUpstream] = useState(null);        // { totals, byProvider } across every tenant's routers

  const loadUpstream = async () => {
    try {
      setUpstream(await api.platformUpstreamBreakdown());
    } catch { /* the card just shows empty */ }
  };

  const loadGateways = async () => {
    try {
      const r = await api.platformSmsGateways();
      setGateways(r.gateways ?? []);
      setGwFields(r.fields ?? {});
      setRelaySources(r.relaySources ?? []);
    } catch { /* the card just shows empty */ }
  };

  const assignRelaySource = async (source, gatewayId) => {
    setAssigningSource(source);
    try {
      await api.setRelaySourceSmsGateway(source, gatewayId || null);
      setRelaySources((rs) => rs.map((r) => (r.source === source ? { ...r, gatewayId: gatewayId || null } : r)));
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setAssigningSource(null);
    }
  };

  const checkGatewayBalance = async (id, force) => {
    setGwBalances((s) => ({ ...s, [id]: { ...(s[id] ?? {}), loading: true } }));
    try {
      const value = await api.platformSmsGatewayBalance(id, force);
      setGwBalances((s) => ({ ...s, [id]: { loading: false, value } }));
    } catch (e) {
      store.toast(`Could not check balance: ${e.message}`);
      setGwBalances((s) => ({ ...s, [id]: { loading: false, value: null } }));
    }
  };

  const openGwForm = (gw) => {
    setGwForm(gw ?? { name: '', provider: 'hostpinnacle', pricePerCredit: '2', isDefault: gateways.length === 0 });
    setGwCreds({});
  };

  const saveGwForm = async () => {
    setGwBusy(true);
    try {
      const body = {
        name: gwForm.name?.trim(),
        provider: gwForm.provider,
        credentials: gwCreds,
        pricePerCredit: Number(gwForm.pricePerCredit) || 0,
        isDefault: !!gwForm.isDefault,
      };
      if (!body.name) throw new Error('Give this sender a name');
      if (gwForm.id) await api.savePlatformSmsGateway(gwForm.id, body);
      else await api.createPlatformSmsGateway(body);
      store.toast('Gateway saved');
      setGwForm(null);
      setGwCreds({});
      await loadGateways();
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setGwBusy(false);
    }
  };

  const deleteGateway = async (gw) => {
    try {
      await api.deletePlatformSmsGateway(gw.id);
      store.toast(`${gw.name} removed`);
      await loadGateways();
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  // A choice is only pending until Save is pressed, so the dropdown always shows what was picked.
  const [pendingSender, setPendingSender] = useState({});
  const assignSender = async (t, gatewayId) => {
    setAssigning(t.id);
    try {
      await api.setTenantSmsGateway(t.id, gatewayId || null);
      setPendingSender((p) => { const n = { ...p }; delete n[t.id]; return n; });
      store.toast(`Sender saved for ${t.name}`);
      store.setCollection('tenants', (ts) => ts.map((x) =>
        (x.id === t.id ? { ...x, platform_sms_gateway_id: gatewayId || null } : x)));
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setAssigning(null);
    }
  };

  const saveBalance = async () => {
    if (!balanceFor) return;
    setBalanceBusy(true);
    try {
      const cost = Number(balanceCost);
      const r = await api.setTenantSmsBalance(balanceFor.id, {
        set: Number(balanceInput) || 0,
        ...(cost > 0 ? { cost, paidTo: balancePaidTo || undefined } : {}),
      });
      store.setCollection('tenants', (ts) => ts.map((x) =>
        (x.id === balanceFor.id ? { ...x, platform_sms_balance: r.platform_sms_balance } : x)));
      store.toast(`${balanceFor.name}: ${r.platform_sms_balance} platform SMS credits`);
      setBalanceFor(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBalanceBusy(false);
    }
  };

  useEffect(() => { loadGateways(); loadUpstream(); }, []);

  // The global 30s poll (store.jsx) keeps every screen current in the
  // background, but it's on its own clock — navigate here right after it
  // just ticked and this shows data up to 30s stale until the next one,
  // reading as "doesn't refresh" to someone switching tabs to check on a
  // tenant they just changed elsewhere. Refreshing the moment this screen
  // is actually opened closes that gap without polling any faster overall.
  useEffect(() => { store.reload({ quiet: true }); }, []);

  if (!store.isPlatformOwner) {
    return (
      <Screen title="ISP tenants">
        <Card>
          <Empty>This screen is only visible to the platform owner. Switch the role in the top bar.</Empty>
        </Card>
      </Screen>
    );
  }

  const allTenants = store.tenants ?? [];
  const tenants = allTenants.filter((t) => !t.deleted_at);
  const removedTenants = allTenants.filter((t) => t.deleted_at);

  // What tenants are charged today, so the effect of a change is plain.
  const groupsOf = (get, dflt) => Object.entries(tenants.reduce((m, t) => {
    const r = Number(get(t) ?? dflt);
    m[r] = (m[r] ?? 0) + 1;
    return m;
  }, {})).sort((a, b) => b[1] - a[1]);
  const rateGroups = groupsOf((t) => t.pppoe_client_rate, 16);
  const pctGroups = groupsOf((t) => t.hotspot_commission_pct, 3);
  const applyBulkRate = async () => {
    const rate = bulkRate === '' ? null : Number(bulkRate);
    const pct = bulkPct === '' ? null : Number(bulkPct);
    if (rate === null && pct === null) return store.toast('Enter a PPPoE rate, a hotspot percentage, or both');
    if (rate !== null && !(Number.isFinite(rate) && rate >= 0)) return store.toast('The PPPoE rate must be zero or more');
    if (pct !== null && !(Number.isFinite(pct) && pct >= 0 && pct <= 100)) return store.toast('The hotspot percentage must be between 0 and 100');
    const lines = [];
    if (rate !== null) lines.push(`PPPoE: KES ${rate} per active client (${tenants.filter((t) => Number(t.pppoe_client_rate ?? 16) !== rate).length} tenants change)`);
    if (pct !== null) lines.push(`Hotspot: ${pct}% of sales (${tenants.filter((t) => Number(t.hotspot_commission_pct ?? 3) !== pct).length} tenants change)`);
    if (!window.confirm(
      `Apply to all ${tenants.length} tenants?\n\n${lines.join('\n')}\n\nStatements already drawn keep their old rates.`
      + (bulkNew ? '\nNew tenants will start on these too.' : ''))) return;
    setBulkBusy(true);
    try {
      await api.setAllRates({ pppoeClientRate: rate, hotspotCommissionPct: pct, alsoNew: bulkNew });
      store.setCollection('tenants', (ts) => ts.map((t) => (t.deleted_at ? t : {
        ...t,
        ...(rate !== null ? { pppoe_client_rate: rate } : {}),
        ...(pct !== null ? { hotspot_commission_pct: pct } : {}),
      })));
      store.toast('Rates updated for every tenant');
      setBulkRate('');
      setBulkPct('');
    } catch (e) {
      store.toast(e.message);
    } finally {
      setBulkBusy(false);
    }
  };
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const onboard = async () => {
    if (!f.name.trim() || !f.subdomain.trim()) return store.toast('Name and subdomain are required');
    setBusy(true);
    try {
      const created = await api.createTenant({
        name: f.name,
        subdomain: f.subdomain,
        hotspotCommissionPct: Number(f.hotspotCommissionPct),
        pppoeClientRate: Number(f.pppoeClientRate),
        hosting: f.hosting,
        flatMonthlyFee: f.chargeMode === 'flat' || f.hosting === 'self' ? Number(f.flatMonthlyFee) : null,
        supportPhone: f.supportPhone || null,
      });
      store.setCollection('tenants', (ts) => [created, ...ts]);
      store.toast(`${created.name} onboarded at ${created.subdomain}`);
      setOpen(false);
      setF(BLANK);
    } catch (e) {
      store.toast(`Could not onboard: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const byStatus = (s) => tenants.filter((t) => t.status === s).length;

  // Expired = read-only or past its end date; soon = ends within two weeks.
  const licenceState = (t) => {
    const end = t.licence_ends ? new Date(t.licence_ends).getTime() : null;
    if (t.status === 'readonly' || (end != null && end < new Date().setHours(0, 0, 0, 0))) return 'expired';
    if (end != null && (end - Date.now()) / 86400000 <= 14) return 'soon';
    return 'ok';
  };
  const shownTenants = tenants.filter((t) =>
    (tf.status === 'all' || t.status === tf.status)
    && (tf.hosting === 'all' || (tf.hosting === 'self') === (t.hosting === 'self'))
    && (tf.charge === 'all' || (tf.charge === 'flat') === (t.flat_monthly_fee != null))
    && (tf.licence === 'all' || licenceState(t) === tf.licence));
  const filtering = Object.values(tf).some((v) => v !== 'all');
  const isSelf = (t) => t.subdomain === store.session?.subdomain;

  const saveEdit = async () => {
    try {
      const updated = await api.updateTenant(editing.id, {
        status: editing.status,
        support_phone: editing.support_phone || null,
        platform_collect_enabled: !!editing.platform_collect_enabled,
        settlement_phone: editing.settlement_phone || null,
        hotspot_commission_pct: Number(editing.hotspot_commission_pct),
        pppoe_client_rate: Number(editing.pppoe_client_rate),
        flat_monthly_fee: editing.charge_mode === 'flat' ? Number(editing.flat_monthly_fee) : null,
        settlement_frequency: editing.settlement_frequency,
        settlement_time: editing.settlement_time || '00:00',
        settlement_fee_mode: editing.settlement_fee_mode,
      });
      store.setCollection('tenants', (ts) => ts.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
      store.toast(`${updated.name} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    }
  };

  const setStatus = (t, status) => async () => {
    try {
      const updated = await api.updateTenant(t.id, { status });
      store.setCollection('tenants', (ts) => ts.map((x) => (x.id === t.id ? { ...x, ...updated } : x)));
      store.toast(`${t.name} → ${status}`);
    } catch (e) {
      store.toast(`Could not update: ${e.message}`);
    }
  };

  const openStaff = async (t) => {
    setStaffFor(t);
    setStaffLoading(true);
    try {
      const rows = await api.tenantStaff(t.id);
      setStaffList(rows);
    } catch (e) {
      store.toast(`Could not load staff: ${e.message}`);
      setStaffFor(null);
    } finally {
      setStaffLoading(false);
    }
  };

  const submitReset = async () => {
    try {
      const body = {
        email: resetting.email || undefined,
        username: resetting.username || undefined,
        password: resetting.genPassword ? true : undefined,
      };
      const result = await api.resetTenantStaffLogin(staffFor.id, resetting.id, body);
      setStaffList((rows) => rows.map((r) => (r.id === resetting.id ? { ...r, email: result.email, username: result.username } : r)));
      setResetResult(result);
      store.toast(`${resetting.name}'s login updated`);
    } catch (e) {
      store.toast(`Could not reset login: ${e.message}`);
    }
  };

  const confirmDelete = async () => {
    try {
      if (deleting.mode === 'remove') {
        await api.removeTenant(deleting.id);
        store.setCollection('tenants', (ts) => ts.map((t) => (t.id === deleting.id ? { ...t, status: 'suspended', deleted_at: new Date().toISOString() } : t)));
        store.toast(`${deleting.name} removed — nothing was deleted, and it can be restored`);
      } else {
        if (deleting.confirmText !== deleting.subdomain) return;
        await api.purgeTenant(deleting.id, { confirm: deleting.confirmText, force: deleting.force });
        store.setCollection('tenants', (ts) => ts.filter((t) => t.id !== deleting.id));
        store.toast(`${deleting.name} and all its data deleted`);
      }
      setDeleting(null);
    } catch (e) {
      store.toast(e.message);
    }
  };

  const restore = async (t) => {
    try {
      await api.restoreTenant(t.id);
      store.setCollection('tenants', (ts) => ts.map((x) => (x.id === t.id ? { ...x, deleted_at: null, deleted_by: null } : x)));
      store.toast(`${t.name} restored — it is still suspended; reactivate it from Edit when ready`);
    } catch (e) {
      store.toast(e.message);
    }
  };

  return (
    <Screen
      title="ISP tenants"
      subtitle="Every ISP running on this platform. Each resolves by subdomain and is isolated by row-level security."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Onboard ISP
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Tenants" value={tenants.length} hint="all statuses" />
        <Stat label="Active" value={byStatus('active')} tone={color.green} hint="paying" />
        <Stat label="Trial" value={byStatus('trial')} tone={color.amberInk} hint="not yet billed" />
        <Stat label="Suspended" value={byStatus('suspended')} tone={byStatus('suspended') ? color.rust : undefined} hint="API returns 402" />
      </Grid>

      <Card
        title="Upstream providers"
        subtitle="Every onboarded router across every tenant, grouped by which ISP actually carries its internet — set per-router under Routers → Edit"
      >
        {!upstream || upstream.byProvider.length === 0 ? (
          <div style={{ padding: '10px 0', fontSize: 13, color: color.muted }}>
            {upstream ? 'No routers onboarded on the platform yet.' : 'Loading…'}
          </div>
        ) : (
          <Table
            rowKey={(row) => row.provider}
            rows={upstream.byProvider}
            columns={[
              {
                key: 'provider', label: 'Upstream',
                render: (row) => row.provider === '(not recorded)'
                  ? <span style={{ color: color.muted, fontStyle: 'italic' }}>{row.provider}</span>
                  : <span style={{ fontWeight: 600 }}>{row.provider}</span>,
              },
              { key: 'routers', label: 'Routers', align: 'right' },
              {
                key: 'share', label: 'Share', align: 'right',
                render: (row) => `${((row.routers / (upstream.totals.routers || 1)) * 100).toFixed(0)}%`,
              },
              { key: 'tenants', label: 'Tenants', align: 'right' },
              {
                key: 'down', label: 'Down now', align: 'right',
                render: (row) => row.down > 0
                  ? <span style={{ color: color.rust, fontWeight: 600 }}>{row.down}</span>
                  : <span style={{ color: color.muted }}>0</span>,
              },
            ]}
          />
        )}
        {upstream && upstream.totals.routers > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: color.muted }}>
            {upstream.totals.routers} router{upstream.totals.routers === 1 ? '' : 's'} across {upstream.totals.tenants} tenant{upstream.totals.tenants === 1 ? '' : 's'} in total.
          </div>
        )}
      </Card>

      <Card
        title="Platform SMS gateways"
        subtitle="Your own gateway(s) — a tenant with none of their own configured falls back to sending through whichever of these it's assigned below (or the default), spending only from the balance you give them"
        actions={<Button variant="primary" onClick={() => openGwForm(null)}>Add sender</Button>}
      >
        {gateways.length === 0 && (
          <div style={{ padding: '10px 0', fontSize: 13, color: color.muted }}>None set up yet — tenants with no gateway of their own can't be sent to.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {gateways.map((g) => {
            const bal = gwBalances[g.id];
            return (
              <div
                key={g.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 11px', border: `1px solid ${color.line}`, borderRadius: radius.md, fontSize: 13,
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>
                    {g.name}{' '}
                    {g.isDefault && <Badge tone="active">default</Badge>}
                  </span>
                  <span style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>
                    {g.provider} · KES {g.pricePerCredit}/credit
                    {g.missing?.length > 0 && <span style={{ color: color.rust }}> · missing {g.missing.join(', ')}</span>}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontFamily: font.mono, fontSize: 12, color: color.muted }}>
                    {bal?.loading ? 'checking…' : bal?.value?.configured
                      ? `${bal.value.credits} credit${bal.value.credits === 1 ? '' : 's'}`
                      : bal?.value && !bal.value.configured ? 'unavailable' : ''}
                  </span>
                  <Button onClick={() => checkGatewayBalance(g.id, true)} disabled={bal?.loading}>Check balance</Button>
                  <span onClick={() => openGwForm(g)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</span>
                  <span onClick={() => deleteGateway(g)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Remove</span>
                </span>
              </div>
            );
          })}
        </div>

        {gwForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${color.line}` }}>
            <Field label="Sender name" hint="Just for you — shown nowhere the tenant sees">
              <Input value={gwForm.name} onChange={(e) => setGwForm((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Sender 1" />
            </Field>
            <Field label="Gateway">
              <Select
                value={gwForm.provider}
                onChange={(e) => { setGwForm((s) => ({ ...s, provider: e.target.value })); setGwCreds({}); }}
                options={Object.keys(gwFields)}
              />
            </Field>
            {(gwFields[gwForm.provider] ?? []).map((f) => (
              <Field
                key={f.key}
                label={f.required ? f.label : `${f.label} (optional)`}
                hint={gwForm.credentialKeys?.includes(f.key) ? 'Saved — leave blank to keep it' : undefined}
              >
                <Input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={gwCreds[f.key] ?? ''}
                  onChange={(e) => setGwCreds((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={gwForm.credentialKeys?.includes(f.key) ? '••••••••' : ''}
                />
              </Field>
            ))}
            <Field label="Price per credit" hint="What a tenant assigned to this sender pays (KES) when they buy more via M-Pesa">
              <Input type="number" min="0" step="0.5" value={gwForm.pricePerCredit} onChange={(e) => setGwForm((s) => ({ ...s, pricePerCredit: e.target.value }))} />
            </Field>
            <Field label="Default sender" hint="Used by any tenant with no sender specifically assigned below">
              <Select
                value={gwForm.isDefault ? 'yes' : 'no'}
                onChange={(e) => setGwForm((s) => ({ ...s, isDefault: e.target.value === 'yes' }))}
                options={['no', 'yes']}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={saveGwForm} disabled={gwBusy}>{gwBusy ? 'Saving…' : 'Save sender'}</Button>
              <Button onClick={() => setGwForm(null)} disabled={gwBusy}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>

      {gateways.length > 1 && (
        <Card title="Tenant senders" subtitle="Which sender each tenant falls back to — unset uses the default above">
          <Table
            rowKey={(t) => t.id}
            rows={tenants}
            columns={[
              { key: 'name', label: 'ISP', render: (t) => t.name },
              {
                key: 'sender',
                label: 'Sender',
                align: 'right',
                render: (t) => {
                  const saved = t.platform_sms_gateway_id ?? '';
                  const picked = pendingSender[t.id] ?? saved;
                  return (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <Select
                        value={picked}
                        disabled={assigning === t.id}
                        onChange={(e) => setPendingSender((p) => ({ ...p, [t.id]: e.target.value }))}
                        options={[
                          { value: '', label: `Default (${gateways.find((g) => g.isDefault)?.name ?? '—'})` },
                          ...gateways.map((g) => ({ value: g.id, label: g.name })),
                        ]}
                      />
                      <Button size="sm" variant="primary" disabled={picked === saved || assigning === t.id} onClick={() => assignSender(t, picked)}>
                        {assigning === t.id ? 'Saving…' : 'Save'}
                      </Button>
                    </span>
                  );
                },
              },
            ]}
          />
        </Card>
      )}

      {gateways.length > 0 && relaySources.length > 0 && (
        <Card
          title="External deployments"
          subtitle="A sibling Vibelink deployment relaying SMS through your gateway(s) — which sender it uses"
        >
          <Table
            rowKey={(r) => r.source}
            rows={relaySources}
            columns={[
              { key: 'label', label: 'Deployment', render: (r) => r.label },
              {
                key: 'sender',
                label: 'Sender',
                align: 'right',
                render: (r) => (
                  <Select
                    value={r.gatewayId ?? ''}
                    disabled={assigningSource === r.source}
                    onChange={(e) => assignRelaySource(r.source, e.target.value)}
                    options={[
                      { value: '', label: `Default (${gateways.find((g) => g.isDefault)?.name ?? '—'})` },
                      ...gateways.map((g) => ({ value: g.id, label: g.name })),
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}

      {inflight.length > 0 && (
        <Card
          title="Payouts awaiting Safaricom"
          subtitle="Sent, but no result has come back. Check the M-Pesa portal: if the money reached them, mark it paid with the receipt; if it did not, cancel it so it is paid again."
        >
          <Table
            rowKey={(r) => r.id}
            toolbar="never"
            rows={inflight}
            columns={[
              { key: 'tenant', label: 'Tenant', render: (r) => <span style={{ fontWeight: 600 }}>{r.tenant}</span> },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => `KES ${kes(r.amount)}` },
              { key: 'phone', label: 'To', render: (r) => <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{r.settlement_phone ?? '—'}</span> },
              { key: 'since', label: 'Sent', render: (r) => new Date(r.since).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
              {
                key: 'act', label: '', align: 'right',
                render: (r) => (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <Button
                      size="sm"
                      onClick={async () => {
                        const receipt = window.prompt(`M-Pesa receipt number for the KES ${kes(r.amount)} sent to ${r.tenant}:`);
                        if (!receipt) return;
                        try { await api.platformMarkSettlementPaid(r.id, receipt); store.toast('Marked paid'); loadInflight(); } catch (e) { store.toast(e.message); }
                      }}
                    >
                      Mark paid
                    </Button>
                    <Button
                      size="sm"
                      style={{ color: color.rust }}
                      onClick={async () => {
                        if (!window.confirm(`Cancel the KES ${kes(r.amount)} payout to ${r.tenant}?\n\nOnly if the money did NOT reach them — otherwise it will be paid a second time.`)) return;
                        try { await api.platformCancelSettlement(r.id); store.toast('Cancelled — it goes out again on their next payout'); loadInflight(); } catch (e) { store.toast(e.message); }
                      }}
                    >
                      Cancel
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card
        title="Rates for all tenants"
        subtitle="What every tenant is charged each month: a rate per active PPPoE client and a percentage of hotspot sales. Fill in either or both and apply to everyone at once; a single tenant can still be changed under Edit."
      >
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="PPPoE rate (KES per active client)" hint={rateGroups.length ? `Now: ${rateGroups.map(([r, n]) => `KES ${r} (${n})`).join(', ')}` : undefined}>
            <Input type="number" min="0" value={bulkRate} onChange={(e) => setBulkRate(e.target.value)} placeholder="e.g. 16" style={{ width: 190 }} />
          </Field>
          <Field label="Hotspot commission (% of sales)" hint={pctGroups.length ? `Now: ${pctGroups.map(([r, n]) => `${r}% (${n})`).join(', ')}` : undefined}>
            <Input type="number" min="0" max="100" step="0.1" value={bulkPct} onChange={(e) => setBulkPct(e.target.value)} placeholder="e.g. 3" style={{ width: 190 }} />
          </Field>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, paddingBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={bulkNew} onChange={(e) => setBulkNew(e.target.checked)} />
            Also use for tenants created from now on
          </label>
          <div style={{ paddingBottom: 6 }}>
            <Button variant="primary" onClick={applyBulkRate} disabled={bulkBusy || (bulkRate === '' && bulkPct === '')}>
              {bulkBusy ? 'Applying…' : `Apply to all ${tenants.length} tenants`}
            </Button>
          </div>
        </div>
      </Card>

      {removedTenants.length > 0 && (
        <Card
          title="Removed tenants"
          subtitle="Suspended and hidden, with every record kept. Restore one, or delete it permanently once nothing is owed either way."
        >
          <Table
            rowKey={(t) => t.id}
            toolbar="never"
            rows={removedTenants}
            columns={[
              { key: 'name', label: 'ISP', render: (t) => <span style={{ fontWeight: 600 }}>{t.name}</span> },
              { key: 'subdomain', label: 'Address', render: (t) => <span style={{ fontFamily: font.mono, fontSize: 12.5 }}>{t.subdomain}</span> },
              { key: 'deleted', label: 'Removed', render: (t) => `${new Date(t.deleted_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}${t.deleted_by ? ` · ${t.deleted_by}` : ''}` },
              {
                key: 'act', label: '', align: 'right',
                render: (t) => (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <Button size="sm" onClick={() => restore(t)}>Restore</Button>
                    <Button size="sm" style={{ color: color.rust }} onClick={() => openRemoval(t, 'purge')}>Delete permanently</Button>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card title="Tenants" subtitle={filtering ? `${shownTenants.length} of ${tenants.length} match` : `${tenants.length} in total — search by name, subdomain, billing ID, phone or status`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'end', paddingBottom: 12 }}>
          <Field label="Status">
            <Select value={tf.status} onChange={(e) => setTf((x) => ({ ...x, status: e.target.value }))} options={[
              { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'trial', label: 'Trial' },
              { value: 'readonly', label: 'Expired (locked)' }, { value: 'suspended', label: 'Suspended' },
            ]} />
          </Field>
          <Field label="Licence">
            <Select value={tf.licence} onChange={(e) => setTf((x) => ({ ...x, licence: e.target.value }))} options={[
              { value: 'all', label: 'Any licence' }, { value: 'expired', label: 'Expired' },
              { value: 'soon', label: 'Ends within 14 days' }, { value: 'ok', label: 'Running' },
            ]} />
          </Field>
          <Field label="Runs on">
            <Select value={tf.hosting} onChange={(e) => setTf((x) => ({ ...x, hosting: e.target.value }))} options={[
              { value: 'all', label: 'Anywhere' }, { value: 'platform', label: 'Our platform' }, { value: 'self', label: 'Their own server' },
            ]} />
          </Field>
          <Field label="Charged">
            <Select value={tf.charge} onChange={(e) => setTf((x) => ({ ...x, charge: e.target.value }))} options={[
              { value: 'all', label: 'Any way' }, { value: 'usage', label: 'By usage' }, { value: 'flat', label: 'Flat monthly fee' },
            ]} />
          </Field>
          {filtering && (
            <div>
              <Button onClick={() => setTf({ status: 'all', hosting: 'all', charge: 'all', licence: 'all' })}>Clear filters</Button>
            </div>
          )}
        </div>
        <Table
          rowKey={(t) => t.id}
          empty={filtering ? 'No tenants match these filters' : 'No tenants yet — onboard your first ISP'}
          rows={shownTenants}
          columns={[
            { key: 'name', label: 'ISP', render: (t) => <span style={{ fontWeight: 600 }}>{t.name}</span> },
            { key: 'subdomain', label: 'Subdomain', render: (t) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{t.subdomain}</span> },
            {
              // The handle WHMCS invoices against. The uuid is the real key
              // everywhere internally, but nobody reads one down the phone or
              // types one onto an invoice line.
              key: 'billing_ref',
              label: 'Billing ID',
              render: (t) => (
                <span style={{ fontFamily: font.mono, fontSize: 12 }}>{t.billing_ref ?? '—'}</span>
              ),
            },
            {
              key: 'hosting', label: 'Runs on',
              render: (t) => (t.hosting === 'self' ? <Badge tone="default">self-hosted</Badge> : <span style={{ color: color.muted }}>platform</span>),
            },
            {
              key: 'hotspot_pct', label: 'Hotspot %', align: 'right',
              render: (t) => (t.flat_monthly_fee != null
                ? <span style={{ fontFamily: font.mono }}>Flat</span>
                : <span style={{ fontFamily: font.mono }}>{Number(t.hotspot_commission_pct ?? 3)}%</span>),
            },
            {
              key: 'pppoe_rate', label: 'Per PPPoE client', align: 'right',
              render: (t) => (t.flat_monthly_fee != null
                ? <span style={{ fontFamily: font.mono }}>KES {kes(t.flat_monthly_fee)} / month</span>
                : <span style={{ fontFamily: font.mono }}>KES {Number(t.pppoe_client_rate ?? 16)}</span>),
            },
            { key: 'devices', label: 'Active', align: 'right', render: (t) => <span style={{ fontFamily: font.mono }}>{t.devices ?? 0}</span> },
            {
              key: 'sms_balance',
              label: 'SMS credit',
              align: 'right',
              render: (t) => (
                <span
                  onClick={() => { setBalanceFor(t); setBalanceInput(String(t.platform_sms_balance ?? 0)); setBalanceCost(''); setBalancePaidTo(''); }}
                  title="From the platform gateway — click to change"
                  style={{
                    fontFamily: font.mono, cursor: 'pointer',
                    color: Number(t.platform_sms_balance) > 0 ? color.green : color.muted,
                  }}
                >
                  {t.platform_sms_balance ?? 0}
                </span>
              ),
            },
            { key: 'status', label: 'Status', render: (t) => <Badge tone={t.status}>{t.status}</Badge> },
            {
              key: 'created_at',
              label: 'Joined',
              render: (t) => (t.created_at ? new Date(t.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'),
            },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (t) => (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <span onClick={() => setViewing(t)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>View</span>
                  <span onClick={() => openStaff(t)} style={{ color: '#4a524c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>Staff logins</span>
                  <span
                    onClick={() =>
                      setEditing({
                        ...t,
                        support_phone: t.support_phone ?? '',
                        platform_collect_enabled: t.platform_collect_enabled ?? false,
                        settlement_phone: t.settlement_phone ?? '',
                        charge_mode: t.flat_monthly_fee != null ? 'flat' : 'usage',
                        flat_monthly_fee: t.flat_monthly_fee ?? '',
                        hotspot_commission_pct: t.hotspot_commission_pct ?? 3,
                        pppoe_client_rate: t.pppoe_client_rate ?? 16,
                        settlement_frequency: t.settlement_frequency ?? 'daily',
                        settlement_time: String(t.settlement_time ?? '00:00').slice(0, 5),
                        settlement_fee_mode: t.settlement_fee_mode ?? 'tiered',
                      })
                    }
                    style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}
                  >
                    Edit
                  </span>
                  <span
                    onClick={setStatus(t, t.status === 'suspended' ? 'active' : 'suspended')}
                    style={{ color: color.amberInk, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}
                  >
                    {t.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                  </span>
                  {isSelf(t) ? (
                    <span style={{ color: color.muted, fontSize: 12.5, fontWeight: 600 }} title="You are signed in to this tenant">
                      Remove
                    </span>
                  ) : (
                    <span
                      onClick={() => openRemoval(t, 'remove')}
                      style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Remove
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="Onboard ISP"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={onboard} disabled={busy}>
              {busy ? 'Onboarding…' : 'Onboard'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="ISP name" span={2}>
            <Input value={f.name} onChange={set('name')} placeholder="Zurinet" />
          </Field>
          <Field label="Subdomain" hint="Becomes zurinet.vibelink.tech">
            <Input value={f.subdomain} onChange={set('subdomain')} placeholder="zurinet" />
          </Field>
          <Field label="Support phone">
            <Input value={f.supportPhone} onChange={set('supportPhone')} />
          </Field>
          <Field label="Where does it run?" span={2}>
            <Select
              value={f.hosting}
              onChange={(e) => setF((s) => ({ ...s, hosting: e.target.value, chargeMode: e.target.value === 'self' ? 'flat' : s.chargeMode }))}
              options={[
                { value: 'platform', label: 'On our platform — they use it at their own address here' },
                { value: 'self', label: 'Self-hosted — they run their own copy on their own server' },
              ]}
            />
          </Field>
          {f.hosting === 'self' ? (
            <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12.5, color: color.muted }}>
              A self-hosted tenant is billed a flat monthly fee. Their server checks its licence with us every day, and shows a
              "licence expired" page to their staff if it lapses — never to their customers. After creating them, make their licence
              key from the tenant's Edit screen and give it to whoever runs their server.
            </p>
          ) : (
            <Field label="How are they charged?" span={2}>
              <Select
                value={f.chargeMode}
                onChange={set('chargeMode')}
                options={[
                  { value: 'usage', label: 'By usage — hotspot % plus a rate per active PPPoE client' },
                  { value: 'flat', label: 'Flat monthly fee — the same amount every month' },
                ]}
              />
            </Field>
          )}
          {f.chargeMode === 'flat' ? (
            <Field label="Flat monthly fee (KES)" span={2} hint="The same every month, whatever their usage">
              <Input value={f.flatMonthlyFee} onChange={set('flatMonthlyFee')} type="number" min="0" />
            </Field>
          ) : (
            <>
              <Field label="Hotspot commission (%)" hint="Of their hotspot sales, billed monthly. Standard is 3.">
                <Input value={f.hotspotCommissionPct} onChange={set('hotspotCommissionPct')} type="number" step="0.1" min="0" max="100" />
              </Field>
              <Field label="Per active PPPoE client (KES)" hint="Billed monthly for each active client. Standard is 16.">
                <Input value={f.pppoeClientRate} onChange={set('pppoeClientRate')} type="number" min="0" />
              </Field>
            </>
          )}
        </div>
      </Modal>

      <Drawer open={!!viewing} title={viewing?.name} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <KV k="Portal" v={`${viewing.subdomain}.vibelink.tech`} />
            {viewing.hosting === 'self' && (
              <>
                <KV k="Runs on" v="Their own server" />
                <KV k="Last checked in" v={viewing.instance_last_seen ? new Date(viewing.instance_last_seen).toLocaleString('en-KE') : 'Never — no key in use yet'} />
              </>
            )}
            <KV k="Status" v={viewing.status} />
            {viewing.flat_monthly_fee != null ? (
              <KV k="Charged" v={`Flat KES ${kes(viewing.flat_monthly_fee)} per month`} />
            ) : (
              <>
                <KV k="Hotspot commission" v={`${Number(viewing.hotspot_commission_pct ?? 3)}% of hotspot sales`} />
                <KV k="PPPoE" v={`KES ${Number(viewing.pppoe_client_rate ?? 16)} per active client`} />
              </>
            )}
            <KV k="Active devices" v={viewing.devices ?? 0} />
            <KV k="Collected this month" v={`KES ${kes(viewing.collected)}`} />
            <KV k="Currency" v={viewing.currency ?? 'KES'} />
            <KV k="Timezone" v={viewing.timezone ?? '—'} />
            <KV k="KRA PIN" v={viewing.kra_pin ?? '—'} />
            <KV k="Support phone" v={viewing.support_phone ?? '—'} />
            <KV k="Licence ends" v={viewing.licence_ends ? new Date(viewing.licence_ends).toLocaleDateString('en-KE') : 'No end date'} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0' }}>
              <span style={{ fontSize: 12, color: color.muted }}>
                A trial is never invoiced. <b>Activate</b> makes them a paying customer — billing starts with the first full month after today. Each statement they pay adds a month; the buttons below only change how long they have, and never start billing.
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  onClick={() => changeLicence(() => api.tenantActivate(viewing.id, 30), 'Activated for 30 days')}
                  disabled={licenceBusy}
                >
                  Activate — 30 days
                </Button>
                <Button onClick={() => addLicenceDays(30)} disabled={licenceBusy}>+30 days</Button>
                <Button onClick={() => addLicenceDays(90)} disabled={licenceBusy}>+90 days</Button>
                <Button onClick={() => addLicenceDays(365)} disabled={licenceBusy}>+1 year</Button>
                <Button onClick={() => addLicenceDays(-7)} disabled={licenceBusy}>−7 days</Button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Input type="date" value={licenceDate} onChange={(e) => setLicenceDate(e.target.value)} />
                <Button onClick={setLicenceEnd} disabled={licenceBusy || !licenceDate}>Set end date</Button>
              </div>
            </div>
            <KV k="Joined" v={viewing.created_at ? new Date(viewing.created_at).toLocaleString('en-KE') : '—'} />
            {isSelf(viewing) && (
              <div style={{ fontSize: 12, color: color.amberInk, background: '#fff9ec', border: '1px solid #ecd9a8', borderRadius: 8, padding: '10px 12px' }}>
                This is the tenant you are signed in to.
              </div>
            )}
          </>
        )}
      </Drawer>

      <Modal
        open={!!editing}
        title={`Edit ${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit}>Save changes</Button>
          </>
        }
      >
        {editing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Status" span={2} hint="Suspended tenants get 402 from every API call">
              <Select
                value={editing.status}
                onChange={(e) => setEditing((s) => ({ ...s, status: e.target.value }))}
                options={['trial', 'active', 'readonly', 'suspended']}
              />
            </Field>
            <Field label="Support phone" span={2}>
              <Input value={editing.support_phone} onChange={(e) => setEditing((s) => ({ ...s, support_phone: e.target.value }))} />
            </Field>
            {editing.hosting === 'self' && (
              <div style={{ gridColumn: '1 / -1', border: `1px solid ${color.line}`, borderRadius: radius.md, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Self-hosted — licence key</span>
                <span style={{ fontSize: 12.5, color: color.muted }}>
                  Their server uses this key to check the licence every day. It is shown once, when made; only a fingerprint is kept.
                  {editing.has_instance_key ? ' A key already exists.' : ' None made yet.'}
                </span>
                <div>
                  <Button onClick={() => makeInstanceKey(editing)}>{editing.has_instance_key ? 'Make a new key' : 'Make licence key'}</Button>
                </div>
                {instanceKey && instanceKey.name === editing.name && (
                  <div style={{ background: color.tileBg, borderRadius: radius.sm, padding: '10px 12px' }}>
                    <div style={{ fontSize: 12, color: color.rust, fontWeight: 600, marginBottom: 6 }}>Copy this now — it will not be shown again.</div>
                    <code style={{ display: 'block', fontFamily: font.mono, fontSize: 12, userSelect: 'all', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                      {`LICENCE_URL=https://vibelink.tech\nLICENCE_KEY=${instanceKey.key}`}
                    </code>
                    <div style={{ fontSize: 12, color: color.muted, marginTop: 6 }}>Add both lines to the .env on their server and restart it.</div>
                  </div>
                )}
              </div>
            )}
            <Field label="How is this tenant charged?" span={2} hint="Choose one. Either way, payouts to them are never reduced.">
              <Select
                value={editing.charge_mode}
                onChange={(e) => setEditing((s) => ({ ...s, charge_mode: e.target.value }))}
                options={[
                  { value: 'usage', label: 'By usage — hotspot % plus a rate per active PPPoE client' },
                  { value: 'flat', label: 'Flat monthly fee — the same amount every month' },
                ]}
              />
            </Field>
            {editing.charge_mode === 'flat' ? (
              <Field label="Flat monthly fee (KES)" span={2} hint="The same amount every month, whatever their usage. The hotspot % and per-client rate do not apply.">
                <Input type="number" step="1" min="0" value={editing.flat_monthly_fee} onChange={(e) => setEditing((s) => ({ ...s, flat_monthly_fee: e.target.value }))} />
              </Field>
            ) : (
              <>
                <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12.5, color: color.muted }}>
                  By usage, a tenant pays <b>both</b> charges added together: a percentage of their hotspot sales, plus a fixed amount for each active
                  PPPoE client. Set one to 0 if it should not apply. For example, KES 100,000 of hotspot sales at 3% and 300 active clients at KES 16
                  is KES 3,000 + KES 4,800 = KES 7,800.
                </p>
                <Field label="Hotspot commission (%)" hint="Of their hotspot sales, billed monthly. Standard is 3.">
                  <Input type="number" step="0.1" min="0" max="100" value={editing.hotspot_commission_pct} onChange={(e) => setEditing((s) => ({ ...s, hotspot_commission_pct: e.target.value }))} />
                </Field>
                <Field label="Per active PPPoE client (KES)" hint="Billed monthly for each active line. Standard is 16.">
                  <Input type="number" step="1" min="0" value={editing.pppoe_client_rate} onChange={(e) => setEditing((s) => ({ ...s, pppoe_client_rate: e.target.value }))} />
                </Field>
              </>
            )}
            <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12.5, color: color.muted }}>
              Changes apply to this month and after; statements already drawn keep the amounts they were drawn at.
            </p>
            <Field label="Platform collects on their behalf" span={2} hint="For a tenant with no payment gateway of their own: customers pay into our own paybill, and we pay it out to them in full on their schedule">
              <Select
                value={editing.platform_collect_enabled ? 'yes' : 'no'}
                onChange={(e) => setEditing((s) => ({ ...s, platform_collect_enabled: e.target.value === 'yes' }))}
                options={['no', 'yes']}
              />
            </Field>
            {editing.platform_collect_enabled && (
              <>
                <Field label="Settlement M-Pesa number" hint="Where payouts are sent">
                  <Input value={editing.settlement_phone} onChange={(e) => setEditing((s) => ({ ...s, settlement_phone: e.target.value }))} />
                </Field>
                <Field label="Payout schedule" hint="Always paid in full">
                  <Select
                    value={editing.settlement_frequency}
                    onChange={(e) => setEditing((s) => ({ ...s, settlement_frequency: e.target.value }))}
                    options={[
                      { value: 'daily', label: 'Daily' },
                      { value: 'weekly', label: 'Weekly (Mondays)' },
                      { value: 'manual', label: 'Manual (on request)' },
                    ]}
                  />
                </Field>
                {editing.settlement_frequency !== 'manual' && (
                  <Field label="Payout time" hint="Nairobi time — midnight unless the tenant chose another">
                    <Input type="time" value={editing.settlement_time} onChange={(e) => setEditing((s) => ({ ...s, settlement_time: e.target.value }))} />
                  </Field>
                )}
                <Field
                  label="Safaricom's B2C fee"
                  span={2}
                  hint="Safaricom charges us to send a payout — who covers that cost?"
                >
                  <Select
                    value={editing.settlement_fee_mode}
                    onChange={(e) => setEditing((s) => ({ ...s, settlement_fee_mode: e.target.value }))}
                    options={[
                      { value: 'commission_only', label: 'Platform absorbs it' },
                      { value: 'tiered', label: "Deduct from the tenant's payout — automatic (Safaricom's tariff)" },
                    ]}
                  />
                </Field>
              </>
            )}
          </div>
        )}
      </Modal>

      <Drawer open={!!staffFor} title={`Staff logins — ${staffFor?.name ?? ''}`} onClose={() => setStaffFor(null)}>
        {staffLoading ? (
          <Empty>Loading…</Empty>
        ) : staffList.length === 0 ? (
          <Empty>No staff accounts on this tenant yet.</Empty>
        ) : (
          <Table
            rowKey={(s) => s.id}
            rows={staffList}
            columns={[
              {
                key: 'name',
                label: 'Name',
                render: (s) => (
                  <span>
                    {s.name}{' '}
                    {s.role === 'platform_admin' && (
                      <Badge tone={{ bg: '#fff9ec', fg: color.amberInk }}>maintenance</Badge>
                    )}
                  </span>
                ),
              },
              { key: 'role', label: 'Role' },
              { key: 'email', label: 'Email', render: (s) => s.email ?? '—' },
              { key: 'username', label: 'Username', render: (s) => s.username ?? '—' },
              {
                key: 'last_seen',
                label: 'Last seen',
                render: (s) => (s.last_seen ? new Date(s.last_seen).toLocaleString('en-KE') : '—'),
              },
              {
                key: 'act',
                label: '',
                align: 'right',
                render: (s) => (
                  <span
                    onClick={() => {
                      setResetResult(null);
                      setResetting({ id: s.id, name: s.name, email: s.email ?? '', username: s.username ?? '', genPassword: false });
                    }}
                    style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Reset login
                  </span>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      <Modal
        open={!!resetting}
        title={`Reset login — ${resetting?.name ?? ''}`}
        onClose={() => { setResetting(null); setResetResult(null); }}
        footer={
          resetResult ? (
            <Button variant="primary" onClick={() => { setResetting(null); setResetResult(null); }}>Done</Button>
          ) : (
            <>
              <Button onClick={() => setResetting(null)}>Cancel</Button>
              <Button variant="primary" onClick={submitReset}>Save</Button>
            </>
          )
        }
      >
        {resetting && !resetResult && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Email">
              <Input value={resetting.email} onChange={(e) => setResetting((s) => ({ ...s, email: e.target.value }))} />
            </Field>
            <Field label="Username">
              <Input value={resetting.username} onChange={(e) => setResetting((s) => ({ ...s, username: e.target.value }))} />
            </Field>
            <Field label="Password" hint="Generates a new random password and signs this account out everywhere.">
              <Button onClick={() => setResetting((s) => ({ ...s, genPassword: !s.genPassword }))}>
                {resetting.genPassword ? '✓ Will generate a new password' : 'Generate new password'}
              </Button>
            </Field>
          </div>
        )}
        {resetResult && (
          <div style={{ display: 'grid', gap: 10 }}>
            <KV k="Email" v={resetResult.email ?? '—'} />
            <KV k="Username" v={resetResult.username ?? '—'} />
            {resetResult.password && (
              <div style={{ background: '#f4f8f5', border: `1px solid ${color.line}`, borderRadius: 9, padding: '11px 13px' }}>
                <div style={{ fontSize: 12, color: color.muted, marginBottom: 4 }}>New password (shown once)</div>
                <div style={{ fontFamily: font.mono, fontSize: 14, fontWeight: 600 }}>{resetResult.password}</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleting}
        title={deleting ? (deleting.mode === 'remove' ? `Remove ${deleting.name}` : `Delete ${deleting.name} permanently`) : ''}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={deleting?.mode === 'purge' && (deleting?.confirmText !== deleting?.subdomain || (deleting?.check?.length > 0 && !deleting?.force))}
              onClick={confirmDelete}
            >
              {deleting?.mode === 'remove' ? 'Remove' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        {deleting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {deleting.mode === 'remove' ? (
              <div style={{ background: color.amberBg, border: '1px solid #ecd9a8', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, color: color.amberInk, lineHeight: 1.55 }}>
                <strong>Nothing is deleted.</strong> The tenant is suspended and hidden from this list; its address shows
                &ldquo;not available&rdquo;, its staff are signed out, and jobs, messages and payouts skip it. All its
                records stay, and you can restore it. To erase it for good you delete it permanently afterwards.
              </div>
            ) : (
              <div style={{ background: '#fdf1ec', border: '1px solid #f0d8ce', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, color: color.rust, lineHeight: 1.5 }}>
                This erases the tenant and <strong>everything belonging to it</strong> — subscribers, payments, payout
                records, invoices, vouchers, routers, tickets and staff logins. It cannot be undone.
              </div>
            )}
            <KV k="Active devices" v={deleting.devices ?? 0} />
            <KV k="Collected this month" v={`KES ${kes(deleting.collected)}`} />
            {deleting.check === null ? (
              <span style={{ fontSize: 12.5, color: color.muted }}>Checking for money still to settle…</span>
            ) : deleting.check.length > 0 ? (
              <div style={{ border: `1px solid ${color.rust}`, borderRadius: 9, padding: '10px 13px', fontSize: 12.5 }}>
                <strong style={{ color: color.rust }}>Money still to settle with this tenant:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                  {deleting.check.map((b) => <li key={b.kind}>{b.text}</li>)}
                </ul>
                {deleting.mode === 'purge' && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={deleting.force} onChange={(e) => setDeleting((d) => ({ ...d, force: e.target.checked }))} style={{ marginTop: 3 }} />
                    <span>I understand these records are erased with the tenant and I have settled it another way.</span>
                  </label>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 12.5, color: color.green }}>No money outstanding either way.</span>
            )}
            {deleting.mode === 'purge' && (
              <Field label={`Type "${deleting.subdomain}" to confirm`}>
                <Input
                  value={deleting.confirmText}
                  onChange={(e) => setDeleting((s) => ({ ...s, confirmText: e.target.value }))}
                  placeholder={deleting.subdomain}
                  style={{ fontFamily: font.mono }}
                />
              </Field>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!balanceFor}
        title={`SMS credit — ${balanceFor?.name ?? ''}`}
        onClose={() => setBalanceFor(null)}
        footer={
          <>
            <Button onClick={() => setBalanceFor(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveBalance} disabled={balanceBusy}>
              {balanceBusy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: color.muted }}>
            How many messages this tenant may send through your platform gateway before it stops —
            only spent when they have no working gateway of their own.
          </p>
          <Field label="Credits">
            <Input type="number" min="0" value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)} />
          </Field>
          <Field label="Cost paid to your SMS provider (KES)" hint="Only fill this in if you actually just bought this credit — it gets logged in Expenses. Leave blank for a correction or goodwill credit.">
            <Input type="number" min="0" value={balanceCost} onChange={(e) => setBalanceCost(e.target.value)} placeholder="0" />
          </Field>
          {Number(balanceCost) > 0 && (
            <Field label="Paid to" hint="Vendor name, defaults to “SMS gateway provider”">
              <Input value={balancePaidTo} onChange={(e) => setBalancePaidTo(e.target.value)} placeholder="e.g. Africa's Talking" />
            </Field>
          )}
        </div>
      </Modal>
    </Screen>
  );
}
