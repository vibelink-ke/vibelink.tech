import React, { useState } from 'react';
import { color, font, kes } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Empty, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table } from '../ui/primitives';

const BLANK = { name: '', subdomain: '', planType: 'flat', planAmount: '', revsharePct: '', supportPhone: '' };
const PLAN_TYPES = [
  { value: 'flat', label: 'Flat monthly fee' },
  { value: 'per_device', label: 'Per active device' },
  { value: 'revshare', label: 'Revenue share' },
];

export default function Tenants() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [staffFor, setStaffFor] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [resetResult, setResetResult] = useState(null);

  if (!store.isPlatformOwner) {
    return (
      <Screen title="ISP tenants">
        <Card>
          <Empty>This screen is only visible to the platform owner. Switch the role in the top bar.</Empty>
        </Card>
      </Screen>
    );
  }

  const tenants = store.tenants ?? [];
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const onboard = async () => {
    if (!f.name.trim() || !f.subdomain.trim()) return store.toast('Name and subdomain are required');
    setBusy(true);
    try {
      const created = await api.createTenant({
        name: f.name,
        subdomain: f.subdomain,
        planType: f.planType,
        planAmount: f.planAmount ? Number(f.planAmount) : null,
        revsharePct: f.revsharePct ? Number(f.revsharePct) : null,
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
  const isSelf = (t) => t.subdomain === store.session?.subdomain;

  const saveEdit = async () => {
    try {
      const updated = await api.updateTenant(editing.id, {
        status: editing.status,
        plan_type: editing.plan_type,
        plan_amount: editing.plan_amount === '' ? null : Number(editing.plan_amount),
        revshare_pct: editing.revshare_pct === '' ? null : Number(editing.revshare_pct),
        support_phone: editing.support_phone || null,
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
    if (deleting.confirmText !== deleting.subdomain) return;
    try {
      await api.deleteTenant(deleting.id);
      store.setCollection('tenants', (ts) => ts.filter((t) => t.id !== deleting.id));
      store.toast(`${deleting.name} and all its data deleted`);
      setDeleting(null);
    } catch (e) {
      store.toast(`Could not delete: ${e.message}`);
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

      <Card title="Tenants">
        <Table
          rowKey={(t) => t.id}
          empty="No tenants yet — onboard your first ISP"
          rows={tenants}
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
            { key: 'plan_type', label: 'Plan', render: (t) => t.planType ?? t.plan_type ?? '—' },
            {
              key: 'amount',
              label: 'Rate',
              align: 'right',
              render: (t) => {
                const type = t.planType ?? t.plan_type;
                if (type === 'revshare') return `${t.revsharePct ?? t.revshare_pct ?? 0}%`;
                return `KES ${kes(t.planAmount ?? t.plan_amount)}`;
              },
            },
            { key: 'devices', label: 'Active', align: 'right', render: (t) => <span style={{ fontFamily: font.mono }}>{t.devices ?? 0}</span> },
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
                        plan_type: t.plan_type ?? 'flat',
                        plan_amount: t.plan_amount ?? '',
                        revshare_pct: t.revshare_pct ?? '',
                        support_phone: t.support_phone ?? '',
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
                      Delete
                    </span>
                  ) : (
                    <span
                      onClick={() => setDeleting({ ...t, confirmText: '' })}
                      style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Delete
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
          <Field label="Billing model">
            <Select value={f.planType} onChange={set('planType')} options={PLAN_TYPES} />
          </Field>
          {f.planType === 'revshare' ? (
            <Field label="Revenue share (%)" hint="Capped at KES 120,000/month">
              <Input value={f.revsharePct} onChange={set('revsharePct')} type="number" step="0.1" />
            </Field>
          ) : (
            <Field label={f.planType === 'per_device' ? 'Per device (KES)' : 'Monthly fee (KES)'}>
              <Input value={f.planAmount} onChange={set('planAmount')} type="number" />
            </Field>
          )}
        </div>
      </Modal>

      <Drawer open={!!viewing} title={viewing?.name} onClose={() => setViewing(null)}>
        {viewing && (
          <>
            <KV k="Portal" v={`${viewing.subdomain}.vibelink.tech`} />
            <KV k="Status" v={viewing.status} />
            <KV k="Billing model" v={viewing.plan_type ?? '—'} />
            <KV
              k="Rate"
              v={viewing.plan_type === 'revshare' ? `${viewing.revshare_pct ?? 0}%` : `KES ${kes(viewing.plan_amount)}`}
            />
            <KV k="Active devices" v={viewing.devices ?? 0} />
            <KV k="Collected this month" v={`KES ${kes(viewing.collected)}`} />
            <KV k="Currency" v={viewing.currency ?? 'KES'} />
            <KV k="Timezone" v={viewing.timezone ?? '—'} />
            <KV k="KRA PIN" v={viewing.kra_pin ?? '—'} />
            <KV k="Support phone" v={viewing.support_phone ?? '—'} />
            <KV k="Licence ends" v={viewing.licence_ends ? new Date(viewing.licence_ends).toLocaleDateString('en-KE') : '—'} />
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
            <Field label="Billing model">
              <Select
                value={editing.plan_type}
                onChange={(e) => setEditing((s) => ({ ...s, plan_type: e.target.value }))}
                options={PLAN_TYPES}
              />
            </Field>
            {editing.plan_type === 'revshare' ? (
              <Field label="Revenue share (%)" hint="Capped at KES 120,000/month">
                <Input type="number" step="0.1" value={editing.revshare_pct} onChange={(e) => setEditing((s) => ({ ...s, revshare_pct: e.target.value }))} />
              </Field>
            ) : (
              <Field label={editing.plan_type === 'per_device' ? 'Per device (KES)' : 'Monthly fee (KES)'}>
                <Input type="number" value={editing.plan_amount} onChange={(e) => setEditing((s) => ({ ...s, plan_amount: e.target.value }))} />
              </Field>
            )}
            <Field label="Support phone" span={2}>
              <Input value={editing.support_phone} onChange={(e) => setEditing((s) => ({ ...s, support_phone: e.target.value }))} />
            </Field>
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
        title={`Delete ${deleting?.name ?? ''}`}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={deleting?.confirmText !== deleting?.subdomain}
              onClick={confirmDelete}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        {deleting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#fdf1ec', border: '1px solid #f0d8ce', borderRadius: 9, padding: '11px 13px', fontSize: 12.5, color: color.rust, lineHeight: 1.5 }}>
              This removes the tenant and <strong>everything belonging to it</strong> — subscribers,
              payments, invoices, vouchers, routers, tickets and staff logins. It cannot be undone.
            </div>
            <KV k="Active devices" v={deleting.devices ?? 0} />
            <KV k="Collected this month" v={`KES ${kes(deleting.collected)}`} />
            <Field label={`Type "${deleting.subdomain}" to confirm`}>
              <Input
                value={deleting.confirmText}
                onChange={(e) => setDeleting((s) => ({ ...s, confirmText: e.target.value }))}
                placeholder={deleting.subdomain}
                style={{ fontFamily: font.mono }}
              />
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
