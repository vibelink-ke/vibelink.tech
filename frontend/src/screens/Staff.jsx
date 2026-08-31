import React, { useEffect, useState } from 'react';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Field, Grid, Input, Modal, Screen, Select, Stat, Table, Tabs, Toggle } from '../ui/primitives';

// The five roles the backend actually understands (requirePermission,
// requireRole and staff.role are all keyed on these lowercase strings) —
// no more "Add role", which only ever added a name to this screen's own
// state with nothing behind it: a staff member given a made-up role could
// never pass any permission check, since the API has no idea what it means.
const ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'technician', label: 'Technician' },
  { value: 'support', label: 'Support' },
  // Sales closes leads rather than answering tickets or touching money —
  // added for the leads leaderboard/commission feature, since assigning a
  // lead to "chase" needs a real role behind it (store.salesReps filtered
  // on role=sales, previously always empty because nothing ever offered it).
  { value: 'sales', label: 'Sales' },
];

const BLANK = { name: '', phone: '', email: '', role: 'cashier' };

export default function Staff() {
  const store = useStore();
  const [tab, setTab] = useState('people');
  // The matrix and its labels now come from the server (permissions.js) —
  // this used to be a hardcoded local copy with no save button at all, so
  // every checkbox on this tab reverted itself on refresh and nothing any
  // route ever checked read it anyway.
  const [perms, setPerms] = useState(null);       // { matrix, meta }
  const [permsBusy, setPermsBusy] = useState(false);
  const [permsDirty, setPermsDirty] = useState(false);
  useEffect(() => {
    if (tab !== 'roles' || perms) return;
    api.permissions().then(setPerms).catch((e) => store.toast(`Could not load permissions: ${e.message}`));
  }, [tab]);

  const togglePerm = (key, role) => {
    setPerms((p) => ({ ...p, matrix: { ...p.matrix, [key]: { ...p.matrix[key], [role]: !p.matrix[key]?.[role] } } }));
    setPermsDirty(true);
  };

  const savePerms = async () => {
    setPermsBusy(true);
    try {
      const saved = await api.savePermissions(perms.matrix);
      setPerms((p) => ({ ...p, matrix: saved.matrix }));
      setPermsDirty(false);
      store.toast('Permissions saved');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setPermsBusy(false);
    }
  };
  const [invite, setInvite] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [aiAssign, setAiAssign] = useState(true);

  const staff = store.staff ?? [];
  const set = (k) => (e) => setInvite((s) => ({ ...s, [k]: e.target.value }));

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

  const openEdit = (s) => setEditing({ id: s.id, name: s.name, phone: s.phone, email: s.email ?? '', username: s.username ?? '', role: s.role });
  const setEdit = (k) => (e) => setEditing((s) => ({ ...s, [k]: e.target.value }));

  const saveEdit = async () => {
    if (!editing.name.trim() || !editing.phone.trim()) return store.toast('Name and phone are required');
    setEditBusy(true);
    try {
      const updated = await api.updateStaff(editing.id, editing);
      store.setCollection('staff', (xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
      store.toast(`${updated.name} updated`);
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setEditBusy(false);
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
        <Stat label="Roles" value={ROLES.length} hint="defined" />
        <Stat label="Online" value={staff.filter((s) => s.last_seen).length} hint="seen recently" />
        <Stat label="Permissions" value={perms?.meta?.length ?? '—'} hint="assignable" />
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
              { key: 'username', label: 'Username', render: (s) => s.username ? <span style={{ fontFamily: font.mono, fontSize: 12 }}>{s.username}</span> : <span style={{ color: color.muted }}>—</span> },
              { key: 'phone', label: 'Phone', render: (s) => <span style={{ fontFamily: font.mono, fontSize: 12 }}>{s.phone}</span> },
              { key: 'email', label: 'Email', render: (s) => s.email ?? '—' },
              { key: 'role', label: 'Role', render: (s) => <Badge tone="default">{s.role}</Badge> },
              { key: 'last_seen', label: 'Last seen', render: (s) => (s.last_seen ? new Date(s.last_seen).toLocaleString('en-KE') : 'never') },
              {
                key: 'act',
                label: '',
                align: 'right',
                render: (s) => (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <span onClick={() => openEdit(s)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginRight: 10 }}>
                      View / Edit
                    </span>
                    {/*
                      Always shown, even on an owner's own row — the server
                      is what actually enforces "not your own login" and
                      "only the platform owner may remove an owner", with a
                      message explaining why. A link that quietly vanishes
                      for some rows reads as broken; an error that says why
                      it refused reads as intentional.
                    */}
                    <span onClick={() => removeStaff(s)} style={{ color: color.rust, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                      Remove
                    </span>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      ) : (
        <>
          <Card
            title="Permission matrix"
            subtitle="Tick what each role may do, per page — view, edit and delete are checked separately"
            actions={
              <Button variant="primary" onClick={savePerms} disabled={permsBusy || !permsDirty}>
                {permsBusy ? 'Saving…' : 'Save changes'}
              </Button>
            }
          >
            {!perms ? (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: color.muted }}>Loading…</div>
            ) : (
              <div className="scroll-x">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: color.muted, borderBottom: `1px solid ${color.line}` }}>
                        Page / action
                      </th>
                      {ROLES.map((r) => (
                        <th
                          key={r.value}
                          style={{ textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: color.muted, borderBottom: `1px solid ${color.line}` }}
                        >
                          {r.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Grouped by page with one heading row, rather than
                      // repeating the page name on every action's own row —
                      // 30 rows of Clients/Clients/Clients read worse than
                      // one Clients heading over its three actions.
                      const pages = [...new Set(perms.meta.map((m) => m.page))];
                      return pages.map((page) => (
                        <React.Fragment key={page}>
                          <tr>
                            <td colSpan={ROLES.length + 1} style={{ padding: '12px 10px 4px', fontSize: 11.5, fontWeight: 700, color: color.inkSoft, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                              {page}
                            </td>
                          </tr>
                          {perms.meta.filter((m) => m.page === page).map((m) => (
                            <tr key={m.key}>
                              <td style={{ padding: '8px 10px 8px 20px', borderBottom: `1px solid ${color.line}` }}>{m.action}</td>
                              {ROLES.map((r) => (
                                <td key={r.value} style={{ textAlign: 'center', padding: '8px 10px', borderBottom: `1px solid ${color.line}` }}>
                                  <input
                                    type="checkbox"
                                    checked={!!perms.matrix[m.key]?.[r.value]}
                                    disabled={r.value === 'owner'}
                                    onChange={() => togglePerm(m.key, r.value)}
                                    aria-label={`${m.action} on ${page} for ${r.label}`}
                                    style={{ cursor: r.value === 'owner' ? 'not-allowed' : 'pointer' }}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </React.Fragment>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
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
              <Select value={invite.role} onChange={set('role')} options={ROLES.map((r) => ({ value: r.value, label: r.label }))} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editing}
        title={editing ? `${editing.name}` : ''}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit} disabled={editBusy}>
              {editBusy ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Name">
              <Input value={editing.name} onChange={setEdit('name')} />
            </Field>
            <Field label="Phone" hint="They sign in with this number">
              <Input value={editing.phone} onChange={setEdit('phone')} placeholder="07xx xxx xxx" />
            </Field>
            <Field label="Email">
              <Input value={editing.email} onChange={setEdit('email')} type="email" />
            </Field>
            <Field label="Username" hint="Alternative login, instead of phone or email">
              <Input value={editing.username} onChange={setEdit('username')} style={{ fontFamily: font.mono }} />
            </Field>
            <Field label="Role" hint={editing.role === 'owner' ? 'Only the platform owner can change an owner\'s role' : undefined}>
              <Select value={editing.role} onChange={setEdit('role')} options={ROLES.map((r) => ({ value: r.value, label: r.label }))} />
            </Field>
          </div>
        )}
      </Modal>
    </Screen>
  );
}
