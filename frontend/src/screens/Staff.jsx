import React, { useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Tabs, Toggle } from '../ui/primitives';

/** Permission matrix, transcribed verbatim from `state.permissions` / `state.permissionMeta`. */
const DEFAULT_ROLES = ['Owner', 'Cashier', 'Technician', 'Support'];

const DEFAULT_PERMISSIONS = {
  'view.clients':    { Owner: true, Cashier: true,  Technician: true,  Support: true },
  'edit.clients':    { Owner: true, Cashier: false, Technician: false, Support: false },
  'view.money':      { Owner: true, Cashier: true,  Technician: false, Support: false },
  'apply.payments':  { Owner: true, Cashier: true,  Technician: false, Support: false },
  'edit.paymentcfg': { Owner: true, Cashier: false, Technician: false, Support: false },
  'manage.routers':  { Owner: true, Cashier: false, Technician: true,  Support: false },
  'manage.tickets':  { Owner: true, Cashier: false, Technician: true,  Support: true },
  'manage.staff':    { Owner: true, Cashier: false, Technician: false, Support: false },
  'view.tenants':    { Owner: true, Cashier: false, Technician: false, Support: false },
  'edit.kb':         { Owner: true, Cashier: false, Technician: true,  Support: true },
};

const PERMISSION_META = [
  { key: 'view.clients',    label: 'View clients',             detail: 'See the subscriber list and details' },
  { key: 'edit.clients',    label: 'Add / edit clients',       detail: 'Create, edit, suspend or delete subscribers' },
  { key: 'view.money',      label: 'View money screens',       detail: 'Payments, invoices and revenue reports' },
  { key: 'apply.payments',  label: 'Apply & match payments',   detail: 'Resolve unmatched payments, issue receipts' },
  { key: 'edit.paymentcfg', label: 'Edit payment credentials', detail: 'Paybill, till, KopoKopo and bank config' },
  { key: 'manage.routers',  label: 'Manage routers & network', detail: 'Onboard MikroTiks, IP pools, RADIUS' },
  { key: 'manage.tickets',  label: 'Work tickets',             detail: 'Assign, update and close support tickets' },
  { key: 'manage.staff',    label: 'Manage staff & roles',     detail: 'Invite people and change permissions' },
  { key: 'view.tenants',    label: 'Platform owner screens',   detail: 'ISP tenants and SaaS revenue' },
  { key: 'edit.kb',         label: 'Edit knowledge base',      detail: 'Write and publish help articles' },
];

const BLANK = { name: '', phone: '', email: '', role: 'Cashier' };

export default function Staff() {
  const store = useStore();
  const [tab, setTab] = useState('people');
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [perms, setPerms] = useState(DEFAULT_PERMISSIONS);
  const [invite, setInvite] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [aiAssign, setAiAssign] = useState(true);

  const staff = store.staff ?? [];
  const set = (k) => (e) => setInvite((s) => ({ ...s, [k]: e.target.value }));

  const toggle = (key, role) =>
    setPerms((p) => ({ ...p, [key]: { ...p[key], [role]: !p[key]?.[role] } }));

  const addRole = () => {
    const name = newRole.trim();
    if (!name) return;
    if (roles.includes(name)) return store.toast('That role already exists');
    setRoles((r) => [...r, name]);
    setPerms((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, [name]: false }])));
    setNewRole('');
    store.toast(`Role "${name}" added`);
  };

  const removeRole = (name) => {
    if (name === 'Owner') return store.toast('The Owner role cannot be removed');
    setRoles((r) => r.filter((x) => x !== name));
    setPerms((p) =>
      Object.fromEntries(
        Object.entries(p).map(([k, v]) => {
          const { [name]: _drop, ...rest } = v;
          return [k, rest];
        })
      )
    );
    store.toast(`Role "${name}" removed`);
  };

  const [busy, setBusy] = useState(false);

  const sendInvite = async () => {
    if (!invite.name.trim() || !invite.phone.trim()) return store.toast('Name and phone are required');
    setBusy(true);
    try {
      const created = await api.createStaff({ ...invite, role: invite.role.toLowerCase() });
      store.setCollection('staff', (s) => [...s.filter((x) => x.id !== created.id), created]);
      store.toast(`${created.name} invited`);
      setInvite(null);
    } catch (e) {
      store.toast(`Could not invite: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const removeStaff = async (s) => {
    try {
      await api.deleteStaff(s.id);
      store.setCollection('staff', (xs) => xs.filter((x) => x.id !== s.id));
      store.toast(`${s.name} removed`);
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  return (
    <Screen
      title="Staff & roles"
      subtitle="Who can do what. Permissions are per-role; a person inherits everything their role allows."
      actions={
        <Button variant="primary" onClick={() => setInvite(BLANK)}>
          + Invite person
        </Button>
      }
    >
      <Grid min={200} gap={14}>
        <Stat label="People" value={staff.length} hint="with access" />
        <Stat label="Roles" value={roles.length} hint="defined" />
        <Stat label="Online" value={staff.filter((s) => s.last_seen).length} hint="seen recently" />
        <Stat label="Permissions" value={PERMISSION_META.length} hint="assignable" />
      </Grid>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'people', label: 'People' },
          { id: 'roles', label: 'Roles & permissions' },
        ]}
      />

      {tab === 'people' ? (
        <Card title="Team">
          <Table
            rowKey={(s) => s.id}
            empty="Nobody invited yet — you are the only one with access"
            rows={staff}
            columns={[
              { key: 'name', label: 'Name', render: (s) => <span style={{ fontWeight: 600 }}>{s.name}</span> },
              { key: 'phone', label: 'Phone', render: (s) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{s.phone}</span> },
              { key: 'email', label: 'Email', render: (s) => s.email ?? '—' },
              { key: 'role', label: 'Role', render: (s) => <Badge tone="default">{s.role}</Badge> },
              { key: 'last_seen', label: 'Last seen', render: (s) => (s.last_seen ? new Date(s.last_seen).toLocaleString('en-KE') : 'never') },
              {
                key: 'act',
                label: '',
                align: 'right',
                render: (s) => {
                  /*
                   * An owner login is not another member of staff's to remove
                   * — the server refuses it too, but showing an active-looking
                   * link that always fails is its own small trap. Only the
                   * platform owner sees a working Remove here; anyone else sees
                   * why it is not theirs to press.
                   */
                  if (s.role === 'owner' && !store.isPlatformOwner) {
                    return (
                      <span
                        title="Only the platform owner can remove an owner login"
                        style={{ color: color.muted, fontSize: 12.5 }}
                      >
                        Owner
                      </span>
                    );
                  }
                  return (
                    <span onClick={() => removeStaff(s)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                      Remove
                    </span>
                  );
                },
              },
            ]}
          />
        </Card>
      ) : (
        <>
          <Card
            title="Roles"
            actions={
              <div style={{ display: 'flex', gap: 6 }}>
                <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="New role name" style={{ width: 160 }} />
                <Button size="sm" onClick={addRole}>Add</Button>
              </div>
            }
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {roles.map((r) => (
                <span
                  key={r}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '5px 11px',
                    borderRadius: radius.pill,
                    background: color.tileBg,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: color.inkSoft,
                  }}
                >
                  {r}
                  {r !== 'Owner' && (
                    <span onClick={() => removeRole(r)} style={{ cursor: 'pointer', color: color.muted }} title={`Remove ${r}`}>
                      ×
                    </span>
                  )}
                </span>
              ))}
            </div>
          </Card>

          <Card title="Permission matrix" subtitle="Tick what each role may do">
            <div className="scroll-x">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: color.muted, borderBottom: `1px solid ${color.line}` }}>
                      Permission
                    </th>
                    {roles.map((r) => (
                      <th
                        key={r}
                        style={{ textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: color.muted, borderBottom: `1px solid ${color.line}` }}
                      >
                        {r}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_META.map((m) => (
                    <tr key={m.key}>
                      <td style={{ padding: '10px', borderBottom: `1px solid ${color.line}` }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontWeight: 500 }}>{m.label}</span>
                          <span style={{ fontSize: 11.5, color: color.muted }}>{m.detail}</span>
                        </div>
                      </td>
                      {roles.map((r) => (
                        <td key={r} style={{ textAlign: 'center', padding: '10px', borderBottom: `1px solid ${color.line}` }}>
                          <input
                            type="checkbox"
                            checked={!!perms[m.key]?.[r]}
                            disabled={r === 'Owner'}
                            onChange={() => toggle(m.key, r)}
                            aria-label={`${m.label} for ${r}`}
                            style={{ cursor: r === 'Owner' ? 'not-allowed' : 'pointer' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Assignment">
            <Toggle
              checked={aiAssign}
              onChange={setAiAssign}
              label="Auto-assign tickets by expertise"
              detail="Routes each new ticket to the free technician whose skills best match the subject"
            />
          </Card>
        </>
      )}

      <Modal
        open={!!invite}
        title="Invite person"
        onClose={() => setInvite(null)}
        footer={
          <>
            <Button onClick={() => setInvite(null)}>Cancel</Button>
            <Button variant="primary" onClick={sendInvite} disabled={busy}>
              {busy ? 'Inviting…' : 'Send invite'}
            </Button>
          </>
        }
      >
        {invite && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Name">
              <Input value={invite.name} onChange={set('name')} />
            </Field>
            <Field label="Phone" hint="They sign in with this number">
              <Input value={invite.phone} onChange={set('phone')} placeholder="07xx xxx xxx" />
            </Field>
            <Field label="Email">
              <Input value={invite.email} onChange={set('email')} type="email" />
            </Field>
            <Field label="Role">
              <Select value={invite.role} onChange={set('role')} options={roles} />
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
