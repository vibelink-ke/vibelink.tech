import React, { useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const BLANK = { site: '', router: '', provider: 'daraja', shortcode: '', account: '' };
const PROVIDERS = [
  { value: 'daraja', label: 'M-Pesa Paybill (Daraja)' },
  { value: 'kopokopo', label: 'KopoKopo till (hotspot)' },
  { value: 'bankstk', label: 'Bank STK' },
  { value: 'manual_till', label: 'Till without API' },
];

/**
 * Per-site payment routing: which paybill or till the customers at a given
 * tower pay into. Useful when an ISP runs several shortcodes.
 */
export default function SiteProfiles() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);

  const profiles = store.siteProfiles ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.site.trim() || !f.shortcode.trim()) return store.toast('Site and shortcode are required');
    setBusy(true);
    try {
      const created = await api.createSiteProfile({
        site: f.site,
        routerId: f.router || null,
        provider: f.provider,
        shortcode: f.shortcode,
        accountPrefix: f.account || null,
      });
      store.setCollection('siteProfiles', (ps) => [...ps.filter((p) => p.id !== created.id), created]);
      store.toast(`${created.site} profile saved`);
      setOpen(false);
      setF(BLANK);
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
      subtitle="Which paybill or till the customers at each site pay into. Only needed when you run more than one shortcode."
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          + Add profile
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="Profiles" value={profiles.length} hint="configured" />
        <Stat label="Sites covered" value={new Set(profiles.map((p) => p.site)).size} hint="distinct sites" />
        <Stat label="Shortcodes" value={new Set(profiles.map((p) => p.shortcode)).size} hint="in use" />
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
            { key: 'account_prefix', label: 'Account prefix', render: (p) => p.account_prefix || '—' },
            {
              key: 'act',
              label: '',
              align: 'right',
              render: (p) => (
                <span onClick={() => remove(p)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                  Delete
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={open}
        title="Add site profile"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Add profile'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
            <Select value={f.provider} onChange={set('provider')} options={PROVIDERS} />
          </Field>
          <Field label="Shortcode">
            <Input value={f.shortcode} onChange={set('shortcode')} placeholder="4098221" />
          </Field>
          <Field label="Account prefix" hint="Prepended to what the client types">
            <Input value={f.account} onChange={set('account')} placeholder="KIM-" />
          </Field>
        </div>
      </Modal>
    </Screen>
  );
}
