import React, { useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const BLANK = { collect: 'own', site: '', router: '', provider: 'daraja', shortcode: '', account: '', paymentConfigId: '' };
const PROVIDERS = [
  { value: 'daraja', label: 'M-Pesa Paybill (Daraja)' },
  { value: 'kopokopo', label: 'KopoKopo till (hotspot)' },
  { value: 'piggyback_till', label: 'Till / Bank (via platform)' },
];

/**
 * Per-site payment routing: which paybill or till the customers at a given
 * tower pay into. Useful when an ISP runs several shortcodes.
 */
export default function SiteProfiles() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(null);   // the profile being edited, or null when adding
  const [view, setView] = useState(false);          // read-only look at a profile

  const close = () => { setOpen(false); setEditing(null); setView(false); setF(BLANK); };
  const openProfile = (p, readOnly) => {
    setF({
      ...BLANK, site: p.site, router: p.router_id ?? '', provider: p.provider, shortcode: p.shortcode ?? '',
      account: p.account_prefix ?? '', paymentConfigId: p.payment_config_id ?? '',
    });
    setEditing(readOnly ? null : p);
    setView(readOnly);
    setOpen(true);
  };

  const profiles = store.siteProfiles ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const [busy, setBusy] = useState(false);

  const paybillsForProvider = (provider) => (store.paymentMethods ?? []).filter((m) => m.provider === provider);

  // Picking a paybill fills the shortcode from it — the shortcode column is
  // always one of the tenant's already-configured gateways, never free text,
  // so there is no way to save a site profile pointing at a typo'd number
  // that doesn't match any real credential.
  const pickPaybill = (e) => {
    const id = e.target.value;
    const row = paybillsForProvider(f.provider).find((m) => m.id === id);
    setF((s) => ({ ...s, paymentConfigId: id, shortcode: row?.shortcode ?? '' }));
  };

  const setProvider = (e) => {
    const provider = e.target.value;
    setF((s) => ({ ...s, provider, paymentConfigId: '', shortcode: '' }));
  };

  const platformOn = !!store.session?.platformCollectEnabled;
  const platformSites = (store.routers ?? []).filter((r) => r.collection_mode === 'platform');

  /** A router's own say on where its customers pay (routers.collection_mode): saved on the router itself. */
  const setSiteMode = async (routerId, mode) => {
    const updated = await api.updateRouter(routerId, { collectionMode: mode });
    store.setCollection('routers', (rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
    return updated;
  };

  const save = async () => {
    // Through the platform: no paybill to pick — customers at this router pay the platform's, settled to the tenant.
    if (f.collect === 'platform') {
      if (!f.router) return store.toast('Pick the router (site) that should collect through the platform');
      setBusy(true);
      try {
        const r = await setSiteMode(f.router, 'platform');
        store.toast(`${r.name}: customers now pay through the platform`);
        setOpen(false);
        setF(BLANK);
      } catch (e) {
        store.toast(`Could not save: ${e.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!f.site.trim() || !f.shortcode.trim()) return store.toast('Site and shortcode are required');
    setBusy(true);
    try {
      const body = {
        site: f.site,
        routerId: f.router || null,
        provider: f.provider,
        shortcode: f.shortcode,
        accountPrefix: f.account || null,
        // Hotspot always uses the tenant's one default gateway, by design —
        // only PPPoE payments can be routed to a specific paybill per site.
        paymentConfigId: f.provider === 'kopokopo' ? null : (f.paymentConfigId || null),
      };
      const created = editing ? await api.updateSiteProfile(editing.id, body) : await api.createSiteProfile(body);
      store.setCollection('siteProfiles', (ps) => [...ps.filter((p) => p.id !== created.id), created]);
      // Pinned to a router and the platform is available: say outright that this site is the tenant's own.
      if (f.router && platformOn) await setSiteMode(f.router, 'own').catch(() => {});
      store.toast(`${created.site} profile saved`);
      close();
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    try {
      await api.deleteSiteProfile(p.id);
      store.setCollection('siteProfiles', (ps) => ps.filter((x) => x.id !== p.id));
      store.toast(`${p.site} profile removed`);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
    }
  };

  return (
    <Screen
      title="Site payment profiles"
      subtitle="Which paybill or till the customers at each site pay into — your own, or the platform's (settled to you). Only needed when you run more than one shortcode, or mix both."
      actions={
        <Button variant="primary" onClick={() => { setEditing(null); setView(false); setF(BLANK); setOpen(true); }}>
          + Add profile
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Profiles" value={profiles.length} hint="configured" />
        <Stat label="Sites covered" value={new Set(profiles.map((p) => p.site)).size} hint="distinct sites" />
        <Stat label="Shortcodes" value={new Set(profiles.map((p) => p.shortcode)).size} hint="in use" />
        <Stat label="Via the platform" value={platformSites.length} hint="sites collecting through it" />
        <Stat label="Routers" value={(store.routers ?? []).length} hint="onboarded" />
      </Grid>

      <Card title="Profiles">
        <Table
          rowKey={(p) => p.id}
          empty="No site profiles — every payment routes through the tenant default"
          rows={profiles}
          columns={[
            { key: 'site', label: 'Site', render: (p) => <span style={{ fontWeight: 600 }}>{p.site}</span> },
            { key: 'router_name', label: 'Router', render: (p) => p.router_name ?? '—' },
            { key: 'provider', label: 'Channel', render: (p) => <Badge tone="default">{p.provider}</Badge> },
            { key: 'shortcode', label: 'Shortcode', render: (p) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{p.shortcode}</span> },
            {
              key: 'payment_config_label',
              label: 'Paybill used',
              render: (p) =>
                p.provider === 'kopokopo'
                  ? <span style={{ color: color.muted }}>Tenant default (hotspot)</span>
                  : p.payment_config_id
                  ? <span>{p.payment_config_label || p.payment_config_shortcode || 'Custom paybill'}</span>
                  : <span style={{ color: color.muted }}>Tenant default</span>,
            },
            { key: 'account_prefix', label: 'Account prefix', render: (p) => p.account_prefix || '—' },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (p) => (
                <span style={{ display: 'inline-flex', gap: 14 }}>
                  <span onClick={() => openProfile(p, true)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>View</span>
                  <span onClick={() => openProfile(p, false)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</span>
                  <span onClick={() => remove(p)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                </span>
              ),
            },
          ]}
        />
      </Card>

      {platformSites.length > 0 && (
        <Card title="Sites collecting through the platform" subtitle="Customers here pay the platform's paybill; what they pay is settled to your payout details, whatever gateways you also have.">
          <Table
            rowKey={(r) => r.id}
            toolbar="never"
            rows={platformSites}
            columns={[
              { key: 'name', label: 'Router (site)', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
              { key: 'how', label: 'Pays', render: () => <Badge tone="default">platform paybill</Badge> },
              {
                key: 'act', label: '', align: 'right',
                render: (r) => (
                  <span
                    onClick={() => setSiteMode(r.id, 'default').then(() => store.toast(`${r.name} follows the account again`)).catch((e) => store.toast(e.message))}
                    style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Remove
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        open={open}
        title={view ? 'Site payment profile' : editing ? 'Edit site profile' : 'Add site profile'}
        onClose={close}
        footer={
          view ? (
            <>
              <Button onClick={close}>Close</Button>
              <Button variant="primary" onClick={() => { const p = profiles.find((x) => x.site === f.site); if (p) openProfile(p, false); }}>Edit</Button>
            </>
          ) : (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add profile'}
              </Button>
            </>
          )
        }
      >
        <fieldset disabled={view} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field
            label="Customers at this site pay"
            span={2}
            hint={platformOn ? undefined : 'The platform option needs "Platform collects on my behalf" switched on first (Settings → Gateways).'}
          >
            <Select
              value={f.collect}
              onChange={set('collect')}
              options={[
                { value: 'own', label: 'My own paybill or till' },
                { value: 'platform', label: platformOn ? "Through the platform — settled to me" : "Through the platform (not switched on yet)" },
              ]}
            />
          </Field>
          {f.collect === 'platform' ? (
            <>
              <Field label="Router (site)" span={2} hint="Everything on this router — hotspot sales and PPPoE renewals — pays the platform paybill, even if you also have your own gateway.">
                <Select
                  value={f.router}
                  onChange={set('router')}
                  options={[{ value: '', label: 'Choose a router…' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
                />
              </Field>
            </>
          ) : (
          <>
          <Field label="Site name" span={2}>
            <Input value={f.site} onChange={set('site')} placeholder="Kimumu" />
          </Field>
          <Field label="Router">
            <Select
              value={f.router}
              onChange={set('router')}
              options={[{ value: '', label: 'Any router' }, ...(store.routers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
            />
          </Field>
          <Field label="Channel">
            <Select value={f.provider} onChange={setProvider} options={PROVIDERS.some((p) => p.value === f.provider) ? PROVIDERS : [...PROVIDERS, { value: f.provider, label: `${f.provider} (no longer offered)` }]} />
          </Field>
          <Field
            label="Paybill"
            hint={
              paybillsForProvider(f.provider).length
                ? f.provider === 'kopokopo'
                  ? "Hotspot always charges through the tenant's one default gateway — pick which shortcode to show, it doesn't change routing."
                  : undefined
                : 'No paybills configured for this channel yet — add one under Settings → Payment methods first.'
            }
          >
            <Select
              value={f.paymentConfigId}
              onChange={pickPaybill}
              disabled={!paybillsForProvider(f.provider).length}
              options={[
                { value: '', label: 'Choose a paybill…' },
                ...paybillsForProvider(f.provider).map((m) => ({
                  value: m.id,
                  label: `${m.label || m.provider}${m.shortcode ? ` (${m.shortcode})` : ''}`,
                })),
              ]}
            />
          </Field>
          <Field label="Account prefix" hint="Prepended to what the client types">
            <Input value={f.account} onChange={set('account')} placeholder="KIM-" />
          </Field>
          </>
          )}
        </div>
        </fieldset>
      </Modal>
    </Screen>
  );
}
