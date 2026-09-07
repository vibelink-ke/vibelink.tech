import React, { useEffect, useState } from 'react';
import { color, font } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Drawer, Empty, Field, Input, Screen, Select, Table, Tabs } from '../ui/primitives';

const STATUS_TONE = { pending: 'pending', processing: 'pending', paid: 'active', failed: 'suspended' };

function StaffPay() {
  const store = useStore();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setRows(await api.hrProfiles());
  useEffect(() => { load(); }, []);

  const openEdit = (r) => setEditing({
    staffId: r.staff_id, baseSalary: String(r.base_salary ?? 0), salaryFrequency: r.salary_frequency ?? 'monthly',
    payoutMethod: r.payout_method ?? 'manual', payoutPhone: r.payout_phone ?? '', employmentStatus: r.employment_status ?? 'active',
  });

  const save = async () => {
    setBusy(true);
    try {
      await api.saveHrProfile(editing.staffId, {
        baseSalary: Number(editing.baseSalary) || 0, salaryFrequency: editing.salaryFrequency,
        payoutMethod: editing.payoutMethod, payoutPhone: editing.payoutPhone || null, employmentStatus: editing.employmentStatus,
      });
      await load();
      store.toast('Saved');
      setEditing(null);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <Empty>Loading…</Empty>;

  return (
    <Card title="Staff pay">
      <Table
        rowKey={(r) => r.staff_id}
        empty="No staff yet"
        rows={rows}
        columns={[
          { key: 'name', label: 'Name', render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
          { key: 'role', label: 'Role', render: (r) => <span style={{ textTransform: 'capitalize' }}>{r.role}</span> },
          {
            key: 'salary', label: 'Base salary', align: 'right',
            render: (r) => r.base_salary > 0
              ? <span style={{ fontFamily: font.mono }}>KES {Number(r.base_salary).toLocaleString('en-KE')} / {r.salary_frequency ?? 'monthly'}</span>
              : <span style={{ color: color.muted }}>Not set</span>,
          },
          {
            key: 'payout', label: 'Payout',
            render: (r) => r.base_salary > 0 || r.payout_method
              ? <Badge tone={r.payout_method === 'mpesa' ? 'active' : 'default'}>{r.payout_method === 'mpesa' ? `M-Pesa · ${r.payout_phone || r.phone}` : 'Manual'}</Badge>
              : <span style={{ color: color.muted }}>—</span>,
          },
          {
            key: 'act', label: '', align: 'right',
            render: (r) => <span onClick={() => openEdit(r)} style={{ color: color.green, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Edit</span>,
          },
        ]}
      />

      <Drawer open={!!editing} title="Edit pay details" onClose={() => setEditing(null)} width={420}>
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Base salary (KES)">
              <Input type="number" min="0" value={editing.baseSalary} onChange={(e) => setEditing((s) => ({ ...s, baseSalary: e.target.value }))} />
            </Field>
            <Field label="Frequency">
              <Select
                value={editing.salaryFrequency}
                onChange={(e) => setEditing((s) => ({ ...s, salaryFrequency: e.target.value }))}
                options={[{ value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }]}
              />
            </Field>
            <Field label="Payout method">
              <Select
                value={editing.payoutMethod}
                onChange={(e) => setEditing((s) => ({ ...s, payoutMethod: e.target.value }))}
                options={[{ value: 'manual', label: 'Manual — pay outside the system, mark done' }, { value: 'mpesa', label: 'M-Pesa — sent automatically on disburse' }]}
              />
            </Field>
            {editing.payoutMethod === 'mpesa' && (
              <Field label="M-Pesa number" hint="Leave blank to use their own phone on file">
                <Input value={editing.payoutPhone} onChange={(e) => setEditing((s) => ({ ...s, payoutPhone: e.target.value }))} placeholder="07xx xxx xxx" />
              </Field>
            )}
            <Field label="Employment status">
              <Select
                value={editing.employmentStatus}
                onChange={(e) => setEditing((s) => ({ ...s, employmentStatus: e.target.value }))}
                options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'terminated', label: 'Terminated' }]}
              />
            </Field>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      </Drawer>
    </Card>
  );
}

function Payroll() {
  const store = useStore();
  const [runs, setRuns] = useState(null);
  const [creating, setCreating] = useState(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);   // full run detail, loaded on open
  const [adding, setAdding] = useState(null);     // manual line-item form

  const load = async () => setRuns(await api.payrollRuns());
  useEffect(() => { load(); }, []);

  const openRun = async (id) => setViewing(await api.payrollRun(id));
  const refreshRun = async () => { if (viewing) setViewing(await api.payrollRun(viewing.id)); };

  const createRun = async () => {
    if (!creating.periodStart || !creating.periodEnd) return store.toast('Pick a period');
    setBusy(true);
    try {
      const run = await api.createPayrollRun(creating);
      await load();
      setCreating(null);
      store.toast(`Draft created — ${run.salaryLines} salary line(s), ${run.commissionLines} commission line(s)`);
      openRun(run.id);
    } catch (e) {
      store.toast(`Could not create run: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const addItem = async () => {
    setBusy(true);
    try {
      await api.addPayrollItem(viewing.id, {
        staffId: adding.staffId, type: adding.type, amount: Number(adding.amount) || 0, note: adding.note || undefined,
      });
      await refreshRun();
      setAdding(null);
    } catch (e) {
      store.toast(`Could not add line: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!window.confirm('Approve this run? Line items become fixed and payouts are computed per staff member.')) return;
    setBusy(true);
    try {
      await api.approvePayrollRun(viewing.id);
      await refreshRun();
      await load();
      store.toast('Approved');
    } catch (e) {
      store.toast(`Could not approve: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const disburse = async () => {
    if (!window.confirm('Disburse this run? M-Pesa payouts send real money now; manual ones are marked paid.')) return;
    setBusy(true);
    try {
      const { results } = await api.disbursePayrollRun(viewing.id);
      await refreshRun();
      await load();
      const failed = results.filter((r) => !r.ok);
      store.toast(failed.length ? `${failed.length} payout(s) need attention` : 'Disbursed');
    } catch (e) {
      store.toast(`Could not disburse: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!runs) return <Empty>Loading…</Empty>;

  return (
    <>
      <Card title="Payroll runs" actions={<Button variant="primary" onClick={() => setCreating({ periodStart: '', periodEnd: '' })}>+ New run</Button>}>
        <Table
          rowKey={(r) => r.id}
          empty="No payroll runs yet"
          rows={runs}
          columns={[
            { key: 'period', label: 'Period', render: (r) => `${r.period_start} – ${r.period_end}` },
            { key: 'total', label: 'Total', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>KES {Number(r.total).toLocaleString('en-KE')}</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'completed' ? 'active' : r.status === 'draft' ? 'default' : 'pending'}>{r.status}</Badge> },
            { key: 'act', label: '', align: 'right', render: (r) => <span onClick={() => openRun(r.id)} style={{ color: color.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>View</span> },
          ]}
        />
      </Card>

      <Drawer open={!!creating} title="New payroll run" onClose={() => setCreating(null)} width={380}>
        {creating && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Period start">
              <Input type="date" value={creating.periodStart} onChange={(e) => setCreating((s) => ({ ...s, periodStart: e.target.value }))} />
            </Field>
            <Field label="Period end">
              <Input type="date" value={creating.periodEnd} onChange={(e) => setCreating((s) => ({ ...s, periodEnd: e.target.value }))} />
            </Field>
            <div style={{ fontSize: 12, color: color.muted }}>
              Auto-fills one salary line per active staff member with pay set up, plus any staff
              commission still owed. Bonuses, deductions, and expense reimbursements can be added after.
            </div>
            <Button variant="primary" onClick={createRun} disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</Button>
          </div>
        )}
      </Drawer>

      <Drawer open={!!viewing} title={viewing ? `Payroll — ${viewing.period_start} – ${viewing.period_end}` : ''} onClose={() => setViewing(null)} width={640}>
        {viewing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge tone={viewing.status === 'completed' ? 'active' : viewing.status === 'draft' ? 'default' : 'pending'}>{viewing.status}</Badge>
              {viewing.status === 'draft' && (
                <>
                  <Button onClick={() => setAdding({ staffId: '', type: 'bonus', amount: '', note: '' })}>+ Add line</Button>
                  <Button variant="primary" onClick={approve} disabled={busy}>{busy ? 'Approving…' : 'Approve'}</Button>
                </>
              )}
              {(viewing.status === 'approved' || viewing.status === 'processing') && (
                <Button variant="primary" onClick={disburse} disabled={busy}>{busy ? 'Disbursing…' : 'Disburse'}</Button>
              )}
            </div>

            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Line items</div>
              <Table
                rowKey={(i) => i.id}
                empty="No line items"
                rows={viewing.items}
                columns={[
                  { key: 'staff', label: 'Staff', render: (i) => i.staff_name },
                  { key: 'type', label: 'Type', render: (i) => <span style={{ textTransform: 'capitalize' }}>{i.type.replace('_', ' ')}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (i) => <span style={{ fontFamily: font.mono }}>KES {Number(i.amount).toLocaleString('en-KE')}</span> },
                  { key: 'note', label: 'Note', render: (i) => <span style={{ color: color.muted, fontSize: 12 }}>{i.note ?? ''}</span> },
                ]}
              />
            </div>

            {viewing.payouts.length > 0 && (
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Payouts</div>
                <Table
                  rowKey={(p) => p.id}
                  rows={viewing.payouts}
                  columns={[
                    { key: 'staff', label: 'Staff', render: (p) => p.staff_name },
                    { key: 'amount', label: 'Amount', align: 'right', render: (p) => <span style={{ fontFamily: font.mono }}>KES {Number(p.amount).toLocaleString('en-KE')}</span> },
                    { key: 'method', label: 'Method', render: (p) => p.method },
                    {
                      key: 'status', label: 'Status',
                      render: (p) => (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                          {p.failed_reason && <span style={{ fontSize: 11, color: color.rust }}>{p.failed_reason}</span>}
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Drawer open={!!adding} title="Add line item" onClose={() => setAdding(null)} width={360}>
        {adding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Staff member">
              <Select
                value={adding.staffId}
                onChange={(e) => setAdding((s) => ({ ...s, staffId: e.target.value }))}
                options={[{ value: '', label: 'Select…' }, ...(store.staff ?? []).map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
            <Field label="Type">
              <Select
                value={adding.type}
                onChange={(e) => setAdding((s) => ({ ...s, type: e.target.value }))}
                options={[{ value: 'bonus', label: 'Bonus' }, { value: 'deduction', label: 'Deduction' }]}
              />
            </Field>
            <Field label="Amount (KES)">
              <Input type="number" min="0" value={adding.amount} onChange={(e) => setAdding((s) => ({ ...s, amount: e.target.value }))} />
            </Field>
            <Field label="Note">
              <Input value={adding.note} onChange={(e) => setAdding((s) => ({ ...s, note: e.target.value }))} />
            </Field>
            <Button variant="primary" onClick={addItem} disabled={busy || !adding.staffId}>{busy ? 'Adding…' : 'Add'}</Button>
          </div>
        )}
      </Drawer>
    </>
  );
}

export default function Hr() {
  const [tab, setTab] = useState('pay');
  return (
    <Screen title="HR & payroll" subtitle="Staff pay, salaries, commissions, and getting people actually paid.">
      <Tabs tabs={[{ id: 'pay', label: 'Staff pay' }, { id: 'payroll', label: 'Payroll' }]} value={tab} onChange={setTab} />
      {tab === 'pay' ? <StaffPay /> : <Payroll />}
    </Screen>
  );
}
