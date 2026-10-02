import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { exportTable } from '../lib/export';
import ExportMenu from '../ui/ExportMenu';
import { Badge, Button, Card, Drawer, Field, Grid, Input, KV, Modal, Screen, Select, Stat, Table, Tabs, Textarea } from '../ui/primitives';

const STAGES = ['new', 'contacted', 'won', 'lost'];
const CHANNELS = ['manual', 'walk-in', 'referral', 'facebook', 'field visit', 'call'];
const LOST_REASONS = ['Too expensive', 'No coverage in their area', 'Chose a competitor', 'No answer / unreachable', 'Not ready yet', 'Other'];
/** Who can be the installer: the technicians, or everyone when the team has none set up as one. */
const installersOf = (staff) => { const t = staff.filter((s) => s.role === 'technician'); return t.length ? t : staff; };
const digits9 = (p) => String(p ?? '').replace(/[^0-9]/g, '').slice(-9);
const waLink = (p) => `https://wa.me/254${digits9(p)}`;

const stageTone = (s) =>
  s === 'won'
    ? { bg: '#e2ebe5', fg: color.green }
    : s === 'lost'
    ? { bg: color.rustBg, fg: color.rust }
    : s === 'contacted'
    ? { bg: color.amberBg, fg: color.amberInk }
    : { bg: color.tileBg, fg: color.neutralInk };

const kes = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE')}`;
const commissionText = (r) => (r.commission_type === 'fixed' ? kes(r.commission_rate) : `${Number(r.commission_rate)}%`);
const referrerType = (r) => (r.staff_id ? 'staff' : r.subscriber_id ? 'customer' : 'external');
const referrerTypeTone = (t) =>
  t === 'staff' ? { bg: color.tileBg, fg: color.neutralInk }
    : t === 'customer' ? { bg: color.amberBg, fg: color.amberInk }
    : { bg: '#e2ebe5', fg: color.green };

const LEAD_BLANK = { name: '', phone: '', source: 'manual', referredBy: '', assignedTo: '', nextFollowUp: '', interestedPlanId: '' };

/** yyyy-mm-dd for a date <input>, from whatever ISO string the API sent. */
const toDateInput = (iso) => (iso ? String(iso).slice(0, 10) : '');
const isOverdue = (iso) => !!iso && new Date(iso) < new Date(new Date().toDateString());
const isDueToday = (iso) => !!iso && toDateInput(iso) === toDateInput(new Date().toISOString());
const REFERRER_BLANK = { name: '', phone: '', refType: 'external', staffId: '', subscriberId: '', commissionType: 'percent', commissionRate: '', notes: '' };

/**
 * Leads and Referrers together — a referrer is where a lead's "referral"
 * channel actually points, not a separate concern, so they live on one
 * screen with two tabs rather than each claiming its own line in the
 * sidebar.
 */
export default function Leads() {
  const store = useStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') === 'performance' ? 'performance' : 'pipeline');

  const leads = store.leads ?? [];
  const referrers = store.referrers ?? [];
  const staff = store.staff ?? [];
  const clients = store.clients ?? [];

  // Loaded on demand rather than with the rest of the store's global
  // collections — a leaderboard is a report, not something every screen
  // needs on hand, and refetching each time the tab opens keeps it current
  // against the same real CRM data the research behind this was explicit
  // about (a leaderboard only earns trust when it isn't lagged).
  const [perf, setPerf] = useState([]);
  const [perfLoading, setPerfLoading] = useState(false);
  useEffect(() => {
    if (tab !== 'performance') return;
    let cancelled = false;
    setPerfLoading(true);
    api.salesPerformance()
      .then((rows) => { if (!cancelled) setPerf(rows); })
      .catch(() => { if (!cancelled) store.toast('Could not load performance'); })
      .finally(() => { if (!cancelled) setPerfLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  // ── pipeline ─────────────────────────────────────────────────────
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadEdit, setLeadEdit] = useState(null);
  const [leadViewing, setLeadViewing] = useState(null);
  const [leadNotes, setLeadNotes] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [leadDeleting, setLeadDeleting] = useState(null);
  const [lf, setLf] = useState(LEAD_BLANK);
  const [leadBusy, setLeadBusy] = useState(false);
  const setL = (k) => (e) => setLf((s) => ({ ...s, [k]: e.target.value }));

  // Narrowing a long pipeline, picking several to act on, and the reason prompt for a lost lead.
  const [fStage, setFStage] = useState('all');   // all | active | a stage — everything by default, so a won lead's Convert button is never hidden
  const [fAssignee, setFAssignee] = useState('');
  const [fSource, setFSource] = useState('');
  const [fQuick, setFQuick] = useState('');         // '' | overdue | today | unassigned | stale
  const [selectedLeads, setSelectedLeads] = useState(new Set());
  const [bulkAssignTo, setBulkAssignTo] = useState('');
  const [lostFor, setLostFor] = useState(null);     // the lead about to be marked lost
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);
  const [lostOther, setLostOther] = useState('');
  const [insights, setInsights] = useState(null);
  useEffect(() => {
    if (tab !== 'insights') return;
    setInsights(null);
    api.leadInsights().then(setInsights).catch(() => store.toast('Could not load insights'));
  }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const won = leads.filter((l) => l.status === 'won').length;
  const activeLeads = leads.filter((l) => l.status !== 'won' && l.status !== 'lost').length;
  const conversionRate = leads.length ? Math.round((won / leads.length) * 100) : 0;
  const dueToday = leads.filter((l) => l.status !== 'won' && l.status !== 'lost' && isDueToday(l.next_follow_up)).length;
  const overdue = leads.filter((l) => l.status !== 'won' && l.status !== 'lost' && isOverdue(l.next_follow_up) && !isDueToday(l.next_follow_up)).length;

  const isOpen = (l) => l.status !== 'won' && l.status !== 'lost';
  // Quiet for a week with nothing logged on it: the ones that go cold if nobody picks them up.
  const isStale = (l) => isOpen(l) && Date.now() - new Date(l.last_activity_at ?? l.created_at).getTime() > 7 * 86400000;
  const staleCount = leads.filter(isStale).length;
  const pipelineValue = leads.filter(isOpen).reduce((n, l) => n + Number(l.plan_price ?? 0), 0);
  const sources = [...new Set(leads.map((l) => l.source).filter(Boolean))];
  const shown = leads.filter((l) => {
    if (fStage === 'active' ? !isOpen(l) : fStage !== 'all' && l.status !== fStage) return false;
    if (fAssignee === 'none' ? l.assigned_to : fAssignee && l.assigned_to !== fAssignee) return false;
    if (fSource && l.source !== fSource) return false;
    if (fQuick === 'overdue' && !(isOpen(l) && isOverdue(l.next_follow_up) && !isDueToday(l.next_follow_up))) return false;
    if (fQuick === 'today' && !(isOpen(l) && isDueToday(l.next_follow_up))) return false;
    if (fQuick === 'unassigned' && !(isOpen(l) && !l.assigned_to)) return false;
    if (fQuick === 'stale' && !isStale(l)) return false;
    return true;
  });

  /** Another lead, or a customer, already on this number (last nine digits, so 07.. and +2547.. match). */
  const duplicateOf = (phone, ignoreId) => {
    const d = digits9(phone);
    if (d.length < 9) return null;
    const lead = leads.find((l) => l.id !== ignoreId && digits9(l.phone) === d);
    if (lead) return `a lead already: ${lead.name} (${lead.status})`;
    const client = clients.find((c) => digits9(c.phone) === d);
    return client ? `already a customer: ${client.name}` : null;
  };

  /**
   * A lead a customer sends your way often names someone who has never been
   * entered as a referrer on their own — this is the first place that
   * relationship exists anywhere. Rather than sending the operator to the
   * Referrers tab first to create them, every active client is offered
   * directly here too; picking one finds-or-creates their referrer row
   * server-side (see referrerForSubscriber in server.js). Clients already
   * linked to a referrer are left out of this second list — they already
   * have an entry in the one above, and showing the same person twice would
   * just be confusing.
   */
  const referredSubscriberIds = new Set(referrers.map((r) => r.subscriber_id).filter(Boolean));
  const referrableClients = clients.filter((c) => !referredSubscriberIds.has(c.id));
  // "referrer:<id>" for someone already a referrer, "client:<id>" for an
  // active customer who isn't one yet — parsed apart again in saveLead().
  const referredByOptions = [
    { value: '', label: '— none —' },
    ...referrers.map((r) => ({ value: `referrer:${r.id}`, label: r.name })),
    ...referrableClients.map((c) => ({ value: `client:${c.id}`, label: `${c.name} (client)` })),
  ];

  const openAddLead = () => {
    setLeadEdit(null);
    setLf(LEAD_BLANK);
    setLeadOpen(true);
  };
  const openEditLead = (l) => {
    setLeadEdit(l);
    setLf({
      name: l.name, phone: l.phone, source: l.source ?? 'manual',
      referredBy: l.referrer_id ? `referrer:${l.referrer_id}` : '',
      assignedTo: l.assigned_to ?? '', nextFollowUp: toDateInput(l.next_follow_up),
      interestedPlanId: l.interested_plan_id ?? '',
    });
    setLeadOpen(true);
  };

  const saveLead = async () => {
    if (!lf.name.trim() || !lf.phone.trim()) return store.toast('Name and phone are required');
    const dup = duplicateOf(lf.phone, leadEdit?.id);
    if (dup && !window.confirm(`This number is ${dup}.\n\nSave it anyway?`)) return;
    const [kind, refId] = lf.referredBy ? lf.referredBy.split(':') : [null, null];
    setLeadBusy(true);
    try {
      const body = {
        name: lf.name.trim(), phone: lf.phone.trim(), source: lf.source,
        assignedTo: lf.assignedTo || null, nextFollowUp: lf.nextFollowUp || null,
        interestedPlanId: lf.interestedPlanId || null,
      };
      if (leadEdit) {
        const patchBody = {
          name: body.name, phone: body.phone, source: body.source,
          assigned_to: body.assignedTo, next_follow_up: body.nextFollowUp,
          interested_plan_id: body.interestedPlanId,
          referrer_id: kind === 'referrer' ? refId : null,
        };
        if (kind === 'client') patchBody.referred_by_client_id = refId;
        const updated = await api.updateLead(leadEdit.id, patchBody);
        store.setCollection('leads', (ls) => ls.map((x) => (x.id === leadEdit.id ? { ...x, ...updated } : x)));
        store.toast(`${updated.name} updated`);
        if (kind === 'client') store.reload({ quiet: true }); // picks up the referrer row just created
      } else {
        const createBody = { ...body };
        if (kind === 'referrer') createBody.referrerId = refId;
        if (kind === 'client') createBody.referredByClientId = refId;
        const created = await api.createLead(createBody);
        store.setCollection('leads', (ls) => [created, ...ls]);
        store.toast(`${created.name} added`);
        if (kind === 'client') store.reload({ quiet: true });
      }
      setLeadOpen(false);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setLeadBusy(false);
    }
  };

  const viewLead = async (l) => {
    setLeadViewing(l);
    setLeadNotes(null);
    setNoteText('');
    try {
      setLeadNotes(await api.leadNotes(l.id));
    } catch (e) {
      store.toast(`Could not load notes: ${e.message}`);
      setLeadNotes([]);
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setNoteBusy(true);
    try {
      const n = await api.addLeadNote(leadViewing.id, noteText.trim());
      setLeadNotes((ns) => [...(ns ?? []), n]);
      setNoteText('');
    } catch (e) {
      store.toast(`Could not save the note: ${e.message}`);
    } finally {
      setNoteBusy(false);
    }
  };

  /**
   * The one step every lead pipeline exists to reach — pre-fills Add Client
   * with what's already known (name, phone, and the referrer, so the
   * commission link made here survives into the real account) rather than
   * asking the operator to retype a lead they're looking straight at.
   */
  const convertToClient = (l) => {
    const params = new URLSearchParams({ name: l.name, phone: l.phone, leadId: l.id });
    if (l.referrer_id) params.set('referredBy', l.referrer_id);
    navigate(`/clients/new?${params.toString()}`);
  };

  const changeStage = (l) => async (e) => {
    const status = e.target.value;
    // A lead being written off is asked why, so the reasons add up to something.
    if (status === 'lost') { setLostReason(LOST_REASONS[0]); setLostOther(''); setLostFor(l); return; }
    const previous = l.status;
    store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? { ...x, status } : x)));
    try {
      const updated = await api.updateLead(l.id, { status });
      store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? updated : x)));
      store.toast(`${l.name} → ${status}`);
    } catch (err) {
      store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? { ...x, status: previous } : x)));
      store.toast(`Could not update: ${err.message}`);
    }
  };

  const confirmLost = async () => {
    const l = lostFor;
    const reason = lostReason === 'Other' ? (lostOther.trim() || 'Other') : lostReason;
    setLostFor(null);
    try {
      const updated = await api.updateLead(l.id, { status: 'lost', lost_reason: reason });
      store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? updated : x)));
      store.toast(`${l.name} → lost (${reason})`);
    } catch (err) {
      store.toast(`Could not update: ${err.message}`);
    }
  };

  /** Move the follow-up date without opening the editor: tomorrow, in three days, next week, or clear it. */
  const setFollowUp = async (l, days) => {
    const next = days == null ? null : new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    try {
      const updated = await api.updateLead(l.id, { next_follow_up: next });
      store.setCollection('leads', (ls) => ls.map((x) => (x.id === l.id ? { ...x, ...updated } : x)));
      setLeadViewing((v) => (v && v.id === l.id ? { ...v, ...updated } : v));
      store.toast(next ? `Follow-up set for ${new Date(next).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}` : 'Follow-up cleared');
    } catch (err) {
      store.toast(`Could not update: ${err.message}`);
    }
  };

  const bulkAssign = async () => {
    const ids = [...selectedLeads];
    if (!ids.length || bulkAssignTo === '') return;
    const to = bulkAssignTo === 'none' ? null : bulkAssignTo;
    try {
      const done = await Promise.all(ids.map((id) => api.updateLead(id, { assigned_to: to })));
      const byId = new Map(done.map((u) => [u.id, u]));
      const name = staff.find((s) => s.id === to)?.name;
      store.setCollection('leads', (ls) => ls.map((x) => (byId.has(x.id)
        ? { ...x, ...byId.get(x.id), assignee_name: name ?? null } : x)));
      store.toast(`${ids.length} lead${ids.length === 1 ? '' : 's'}: ${to ? `${name} will follow up the installation` : 'installer cleared'}`);
      setSelectedLeads(new Set());
      setBulkAssignTo('');
    } catch (err) {
      store.toast(`Could not assign: ${err.message}`);
    }
  };

  const exportLeads = async (format) => {
    const rows = [
      ['Name', 'Phone', 'Stage', 'Channel', 'Package', 'Installer', 'Follow-up', 'Lost reason', 'Added'],
      ...shown.map((l) => [
        l.name, l.phone, l.status, l.source ?? '', l.plan_title ?? '', l.assignee_name ?? '',
        l.next_follow_up ? toDateInput(l.next_follow_up) : '', l.lost_reason ?? '', toDateInput(l.created_at),
      ]),
    ];
    const n = await exportTable(format, 'leads', rows, { title: 'Leads', subtitle: `${shown.length} of ${leads.length}` });
    store.toast(n ? `Exported ${n} lead(s)` : 'Nothing to export');
  };

  const confirmDeleteLead = async () => {
    try {
      await api.deleteLead(leadDeleting.id);
      store.setCollection('leads', (ls) => ls.filter((x) => x.id !== leadDeleting.id));
      store.toast(`${leadDeleting.name} removed`);
      setLeadDeleting(null);
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  // ── referrers ────────────────────────────────────────────────────
  const [refOpen, setRefOpen] = useState(false);
  const [refEdit, setRefEdit] = useState(null);
  const [refViewing, setRefViewing] = useState(null);
  const [commissions, setCommissions] = useState(null);
  const [refDeleting, setRefDeleting] = useState(null);
  const [rf, setRf] = useState(REFERRER_BLANK);
  const [refBusy, setRefBusy] = useState(false);
  const setR = (k) => (e) => setRf((s) => ({ ...s, [k]: e.target.value }));

  const totalOwed = referrers.reduce((sum, r) => sum + Number(r.owed ?? 0), 0);
  const totalPaid = referrers.reduce((sum, r) => sum + Number(r.paid ?? 0), 0);
  const totalReferred = referrers.reduce((sum, r) => sum + Number(r.clients_referred ?? 0), 0);

  const openAddReferrer = () => {
    setRefEdit(null);
    setRf(REFERRER_BLANK);
    setRefOpen(true);
  };
  const openEditReferrer = (r) => {
    setRefEdit(r);
    setRf({
      name: r.name, phone: r.phone ?? '', refType: referrerType(r), staffId: r.staff_id ?? '', subscriberId: r.subscriber_id ?? '',
      commissionType: r.commission_type, commissionRate: String(r.commission_rate), notes: r.notes ?? '',
    });
    setRefOpen(true);
  };

  const saveReferrer = async () => {
    if (!rf.name.trim()) return store.toast('Name is required');
    const rate = Number(rf.commissionRate);
    if (!Number.isFinite(rate) || rate < 0) return store.toast('Enter a valid commission rate');
    setRefBusy(true);
    try {
      const body = {
        name: rf.name.trim(), phone: rf.phone.trim() || null,
        commissionType: rf.commissionType, commissionRate: rate, notes: rf.notes.trim() || null,
      };
      if (refEdit) {
        const updated = await api.updateReferrer(refEdit.id, body);
        store.setCollection('referrers', (rs) => rs.map((x) => (x.id === refEdit.id ? { ...x, ...updated } : x)));
        store.toast(`${updated.name} updated`);
      } else {
        const created = await api.createReferrer({
          ...body,
          staffId: rf.refType === 'staff' ? rf.staffId || null : null,
          subscriberId: rf.refType === 'customer' ? rf.subscriberId || null : null,
        });
        store.setCollection('referrers', (rs) => [created, ...rs]);
        store.toast(`${created.name} added as a referrer`);
      }
      setRefOpen(false);
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setRefBusy(false);
    }
  };

  const viewReferrer = async (r) => {
    setRefViewing(r);
    setCommissions(null);
    try {
      setCommissions(await api.referrerCommissions(r.id));
    } catch (e) {
      store.toast(`Could not load commission history: ${e.message}`);
      setCommissions([]);
    }
  };

  const markPaid = async (c) => {
    try {
      const updated = await api.markCommissionPaid(c.id);
      setCommissions((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...updated } : x)));
      store.setCollection('referrers', (rs) => rs.map((x) => (x.id === refViewing.id
        ? { ...x, owed: Number(x.owed) - Number(c.amount), paid: Number(x.paid) + Number(c.amount) }
        : x)));
      store.toast(`Marked ${kes(c.amount)} paid to ${refViewing.name}`);
    } catch (e) {
      store.toast(`Could not mark as paid: ${e.message}`);
    }
  };

  const confirmDeleteReferrer = async () => {
    try {
      await api.deleteReferrer(refDeleting.id);
      store.setCollection('referrers', (rs) => rs.filter((x) => x.id !== refDeleting.id));
      store.toast(`${refDeleting.name} removed`);
      setRefDeleting(null);
    } catch (e) {
      store.toast(`Could not remove: ${e.message}`);
    }
  };

  return (
    <Screen
      title="Leads"
      subtitle="Prospective subscribers, and whoever brings them in."
      actions={
        tab === 'pipeline' ? (
          <>
            <ExportMenu onExport={exportLeads} disabled={!shown.length} />
            <Button variant="primary" onClick={openAddLead}>+ Add lead</Button>
          </>
        ) : tab === 'referrers' ? (
          <Button variant="primary" onClick={openAddReferrer}>+ Add referrer</Button>
        ) : null
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'pipeline', label: 'Pipeline' },
          { id: 'referrers', label: 'Referrers' },
          { id: 'insights', label: 'Insights' },
          { id: 'performance', label: 'Performance' },
        ]}
      />

      {tab === 'pipeline' && (
        <>
          <Grid min={200} gap={14}>
            <Stat label="Active" value={activeLeads} hint="still in play" />
            <Stat label="Due today" value={dueToday} tone={dueToday ? color.amberInk : undefined} hint="follow up today" />
            <Stat label="Overdue" value={overdue} tone={overdue ? color.rust : undefined} hint="past their follow-up date" />
            <Stat label="Won" value={won} tone={won ? color.green : undefined} hint="converted to clients" />
            <Stat label="Conversion" value={`${conversionRate}%`} hint="won / total" />
            <Stat label="Open pipeline" value={kes(pipelineValue)} hint="a month, for leads with a package" />
            <Stat label="Gone quiet" value={staleCount} tone={staleCount ? color.rust : undefined} hint="open, nothing for 7+ days" />
          </Grid>

          <Card>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Stage">
                <Select value={fStage} onChange={(e) => setFStage(e.target.value)} options={[
                  { value: 'active', label: 'Still in play' }, { value: 'all', label: 'Everything' },
                  ...STAGES.map((s) => ({ value: s, label: s })),
                ]} />
              </Field>
              <Field label="Installer">
                <Select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} options={[
                  { value: '', label: 'Anyone' }, { value: 'none', label: 'None yet' },
                  ...installersOf(staff).map((s) => ({ value: s.id, label: s.name })),
                ]} />
              </Field>
              <Field label="Channel">
                <Select value={fSource} onChange={(e) => setFSource(e.target.value)} options={[{ value: '', label: 'Any' }, ...sources]} />
              </Field>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 2 }}>
                {[['overdue', 'Overdue'], ['today', 'Due today'], ['unassigned', 'No installer'], ['stale', 'Gone quiet']].map(([k, label]) => (
                  <Button key={k} variant={fQuick === k ? 'primary' : undefined} onClick={() => setFQuick(fQuick === k ? '' : k)}>{label}</Button>
                ))}
              </div>
            </div>
            {selectedLeads.size > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <span style={{ fontSize: 13 }}>{selectedLeads.size} selected</span>
                <Select value={bulkAssignTo} onChange={(e) => setBulkAssignTo(e.target.value)} options={[
                  { value: '', label: 'Set installer…' }, { value: 'none', label: 'No installer' },
                  ...installersOf(staff).map((s) => ({ value: s.id, label: s.name })),
                ]} />
                <Button variant="primary" onClick={bulkAssign} disabled={bulkAssignTo === ''}>Apply</Button>
                <Button onClick={() => setSelectedLeads(new Set())}>Clear</Button>
              </div>
            )}
          </Card>

          <Card title="Pipeline" subtitle={`${shown.length} of ${leads.length}`}>
            <Table
              rowKey={(l) => l.id}
              empty="No leads match"
              rows={shown}
              select={{ id: (l) => l.id, selected: selectedLeads, setSelected: setSelectedLeads }}
              columns={[
                { key: 'name', label: 'Name', render: (l) => <span style={{ fontWeight: 600 }}>{l.name}</span> },
                {
                  key: 'phone',
                  label: 'Phone',
                  render: (l) => (
                    <div>
                      <span style={{ fontFamily: font.mono, fontSize: 12 }}>{l.phone}</span>
                      <div style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
                        <a href={`tel:${l.phone}`} style={{ color: color.green, fontWeight: 600 }}>Call</a>
                        <a href={waLink(l.phone)} target="_blank" rel="noreferrer" style={{ color: color.green, fontWeight: 600 }}>WhatsApp</a>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'plan',
                  label: 'Package',
                  render: (l) => (l.plan_title ? <span>{l.plan_title}</span> : <span style={{ color: color.muted }}>—</span>),
                },
                {
                  key: 'source',
                  label: 'Channel',
                  render: (l) => (
                    <div>
                      <div>{l.source ?? '—'}</div>
                      {l.referrer_name && (
                        <div style={{ fontSize: 11.5, color: color.muted }}>
                          via {l.referrer_staff_id
                            ? <span onClick={() => navigate(`/staff?open=${l.referrer_staff_id}`)} style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>{l.referrer_name}</span>
                            : l.referrer_name}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'status',
                  label: 'Stage',
                  width: 140,
                  render: (l) => (
                    <select
                      value={l.status}
                      onChange={changeStage(l)}
                      style={{ padding: '4px 8px', border: `1px solid ${color.line}`, borderRadius: radius.sm, background: '#fff', fontSize: 12.5 }}
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ),
                },
                { key: 'badge', label: '', render: (l) => <Badge tone={stageTone(l.status)}>{l.status}</Badge> },
                {
                  key: 'assignee',
                  label: 'Installer',
                  render: (l) => (
                    <div>
                      {l.assignee_name
                        ? <span onClick={() => navigate(`/staff?open=${l.assigned_to}`)} style={{ color: color.ink, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline dotted' }}>{l.assignee_name}</span>
                        : <span style={{ color: color.muted }}>none yet</span>}
                      {l.created_by_name && (
                        <div style={{ fontSize: 11.5, color: color.muted }}>
                          added by{' '}
                          <span onClick={() => navigate(`/staff?open=${l.created_by}`)} style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>{l.created_by_name}</span>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'next_follow_up',
                  label: 'Follow up',
                  render: (l) => {
                    if (!l.next_follow_up) return <span style={{ color: color.muted }}>—</span>;
                    const overdueRow = l.status !== 'won' && l.status !== 'lost' && isOverdue(l.next_follow_up);
                    return (
                      <span style={{ color: overdueRow ? color.rust : color.ink, fontWeight: overdueRow ? 600 : 400 }}>
                        {new Date(l.next_follow_up).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}
                      </span>
                    );
                  },
                },
                {
                  key: 'actions',
                  label: '',
                  align: 'right',
                  render: (l) => (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {l.status === 'won' && (
                        l.subscriber_id
                          ? <Button onClick={() => navigate(`/clients/${l.subscriber_id}`)}>View client</Button>
                          : <Button variant="primary" onClick={() => convertToClient(l)}>Convert</Button>
                      )}
                      <Button onClick={() => viewLead(l)}>View</Button>
                      <Button onClick={() => openEditLead(l)}>Edit</Button>
                      <Button onClick={() => setLeadDeleting(l)}>Delete</Button>
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          {/* Add / edit lead */}
          <Modal
            open={leadOpen}
            title={leadEdit ? `Edit ${leadEdit.name}` : 'Add lead'}
            onClose={() => setLeadOpen(false)}
            footer={
              <>
                <Button onClick={() => setLeadOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={saveLead} disabled={leadBusy}>
                  {leadBusy ? 'Saving…' : leadEdit ? 'Save changes' : 'Add lead'}
                </Button>
              </>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Name">
                <Input value={lf.name} onChange={setL('name')} />
              </Field>
              <Field label="Phone">
                <Input value={lf.phone} onChange={setL('phone')} placeholder="07xx xxx xxx" />
              </Field>
              <Field label="Package they asked about" hint="Optional — sizes the pipeline in money">
                <Select
                  value={lf.interestedPlanId}
                  onChange={setL('interestedPlanId')}
                  options={[{ value: '', label: '— not sure yet —' }, ...(store.plans ?? []).map((p) => ({ value: p.id, label: `${p.title} · ${kes(p.price)}` }))]}
                />
              </Field>
              <Field label="Channel" hint="How this lead reached you">
                <Select value={lf.source} onChange={setL('source')} options={CHANNELS} />
              </Field>
              {/* Meaningful mainly when the channel above is "referral", but
                  not locked to it — a walk-in can still mention who sent them. */}
              <Field label="Referred by (channel)" hint="Who brought this lead in — they earn the commission and the sales credit">
                <Select value={lf.referredBy} onChange={setL('referredBy')} options={referredByOptions} />
              </Field>
              <Field label="Installer" hint="The technician who follows up the installation. Not who earns the commission — that is the referrer above.">
                <Select
                  value={lf.assignedTo}
                  onChange={setL('assignedTo')}
                  options={[{ value: '', label: '— none yet —' }, ...installersOf(staff).map((s) => ({ value: s.id, label: s.name }))]}
                />
              </Field>
              <Field label="Next follow-up" hint="Optional">
                <Input type="date" value={lf.nextFollowUp} onChange={setL('nextFollowUp')} />
              </Field>
            </div>
          </Modal>

          {/* View lead */}
          <Drawer
            open={!!leadViewing}
            title={leadViewing?.name}
            actions={leadViewing?.status === 'won' ? <Button variant="primary" onClick={() => convertToClient(leadViewing)}>Convert to client</Button> : undefined}
            onClose={() => setLeadViewing(null)}
          >
            {leadViewing && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                <KV k="Phone" v={leadViewing.phone} />
                <KV k="Channel" v={leadViewing.source ?? '—'} />
                <KV k="Package" v={leadViewing.plan_title ? `${leadViewing.plan_title} · ${kes(leadViewing.plan_price)}` : '—'} />
                <KV k="Referred by" v={leadViewing.referrer_name ?? '—'} />
                <KV k="Installer" v={leadViewing.assignee_name ?? '—'} />
                <KV
                  k="Next follow-up"
                  v={
                    leadViewing.next_follow_up
                      ? <span style={{ color: isOverdue(leadViewing.next_follow_up) ? color.rust : color.ink }}>
                          {new Date(leadViewing.next_follow_up).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      : '—'
                  }
                />
                <KV k="Stage" v={<Badge tone={stageTone(leadViewing.status)}>{leadViewing.status}</Badge>} />
                {leadViewing.status === 'lost' && <KV k="Lost because" v={leadViewing.lost_reason ?? 'No reason given'} />}
                <KV k="First reached" v={leadViewing.first_contacted_at ? new Date(leadViewing.first_contacted_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Not yet'} />
                <KV k="Last activity" v={new Date(leadViewing.last_activity_at ?? leadViewing.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })} />
                <KV
                  k="Added"
                  v={leadViewing.created_at ? new Date(leadViewing.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a href={`tel:${leadViewing.phone}`} style={{ textDecoration: 'none' }}><Button>Call</Button></a>
                    <a href={waLink(leadViewing.phone)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><Button>WhatsApp</Button></a>
                  </div>
                  {isOpen(leadViewing) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: color.muted }}>Follow up:</span>
                      <Button onClick={() => setFollowUp(leadViewing, 1)}>Tomorrow</Button>
                      <Button onClick={() => setFollowUp(leadViewing, 3)}>In 3 days</Button>
                      <Button onClick={() => setFollowUp(leadViewing, 7)}>Next week</Button>
                      {leadViewing.next_follow_up && <Button onClick={() => setFollowUp(leadViewing, null)}>Clear</Button>}
                    </div>
                  )}
                </div>

                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: color.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 8px' }}>
                    Notes
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                    {leadNotes === null ? (
                      <p style={{ fontSize: 13, color: color.muted, margin: 0 }}>Loading…</p>
                    ) : !leadNotes.length ? (
                      <p style={{ fontSize: 13, color: color.muted, margin: 0 }}>No notes yet.</p>
                    ) : (
                      leadNotes.map((n) => (
                        <div key={n.id} style={{ padding: '8px 10px', background: color.tileBg, borderRadius: radius.md, fontSize: 13 }}>
                          <div>{n.body}</div>
                          <div style={{ fontSize: 11, color: color.muted, marginTop: 4 }}>
                            {n.author ?? 'system'} · {new Date(n.at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note…" />
                    <Button onClick={addNote} disabled={noteBusy || !noteText.trim()}>{noteBusy ? '…' : 'Add'}</Button>
                  </div>
                </div>
              </div>
            )}
          </Drawer>

          {/* Why a lead was lost */}
          <Modal
            open={!!lostFor}
            title={`Why was ${lostFor?.name ?? 'this lead'} lost?`}
            onClose={() => setLostFor(null)}
            footer={
              <>
                <Button onClick={() => setLostFor(null)}>Cancel</Button>
                <Button variant="primary" onClick={confirmLost}>Mark as lost</Button>
              </>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Reason" hint="Kept so you can see, over time, what is costing you customers">
                <Select value={lostReason} onChange={(e) => setLostReason(e.target.value)} options={LOST_REASONS} />
              </Field>
              {lostReason === 'Other' && (
                <Field label="Tell us more">
                  <Input value={lostOther} onChange={(e) => setLostOther(e.target.value)} />
                </Field>
              )}
            </div>
          </Modal>

          {/* Delete lead */}
          <Modal
            open={!!leadDeleting}
            title={`Remove ${leadDeleting?.name ?? ''}?`}
            onClose={() => setLeadDeleting(null)}
            footer={
              <>
                <Button onClick={() => setLeadDeleting(null)}>Cancel</Button>
                <Button variant="danger" onClick={confirmDeleteLead}>Remove lead</Button>
              </>
            }
          >
            <p style={{ fontSize: 13.5, color: color.muted, margin: 0 }}>
              This removes the lead from the pipeline. It has no effect on any client account already created from it.
            </p>
          </Modal>
        </>
      )}

      {tab === 'insights' && (
        !insights ? (
          <p style={{ color: color.muted, fontSize: 13.5 }}>Working it out…</p>
        ) : (
          <>
            <Grid min={200} gap={14}>
              <Stat
                label="Time to first contact"
                value={insights.hoursToContact == null ? '—' : insights.hoursToContact < 1 ? `${Math.round(insights.hoursToContact * 60)} min` : insights.hoursToContact < 48 ? `${insights.hoursToContact.toFixed(1)} h` : `${(insights.hoursToContact / 24).toFixed(1)} days`}
                hint="average, last 90 days — the faster, the more win"
              />
              <Stat label="Time to win" value={insights.daysToWin == null ? '—' : `${insights.daysToWin.toFixed(1)} days`} hint="from added to won" />
              <Stat label="Gone quiet" value={insights.stale} tone={insights.stale ? color.rust : undefined} hint="open, nothing for 7+ days" />
              <Stat label="Open pipeline" value={kes(insights.pipelineValue.monthly)} hint={`a month, ${insights.pipelineValue.leadsWithPlan} lead${insights.pipelineValue.leadsWithPlan === 1 ? '' : 's'} with a package`} />
            </Grid>

            <Card title="Where leads come from" subtitle="Per channel: how many, how many became customers">
              <Table
                rowKey={(r) => r.source}
                toolbar="never"
                empty="No leads yet"
                rows={insights.bySource}
                columns={[
                  { key: 'source', label: 'Channel', render: (r) => <span style={{ fontWeight: 600 }}>{r.source}</span> },
                  { key: 'total', label: 'Leads', align: 'right', render: (r) => r.total },
                  { key: 'won', label: 'Won', align: 'right', render: (r) => <span style={{ color: color.green }}>{r.won}</span> },
                  { key: 'lost', label: 'Lost', align: 'right', render: (r) => <span style={{ color: r.lost ? color.rust : color.muted }}>{r.lost}</span> },
                  { key: 'rate', label: 'Won %', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>{r.rate}%</span> },
                ]}
              />
            </Card>

            <Card title="Why leads are lost" subtitle="Asked each time a lead is marked lost">
              <Table
                rowKey={(r) => r.reason}
                toolbar="never"
                empty="No lost leads yet"
                rows={insights.lostReasons}
                columns={[
                  { key: 'reason', label: 'Reason', render: (r) => r.reason },
                  { key: 'n', label: 'Leads', align: 'right', render: (r) => <span style={{ fontFamily: font.mono }}>{r.n}</span> },
                ]}
              />
            </Card>
          </>
        )
      )}

      {tab === 'referrers' && (
        <>
          <Grid min={190} gap={14}>
            <Stat label="Referrers" value={referrers.length} />
            <Stat label="Clients referred" value={totalReferred} />
            <Stat label="Owed" value={kes(totalOwed)} tone={totalOwed ? color.amberInk : undefined} hint="not yet paid out" />
            <Stat label="Paid out" value={kes(totalPaid)} tone={color.green} />
          </Grid>

          <Card title="Referrers">
            <Table
              rowKey={(r) => r.id}
              empty="No referrers yet — add whoever sends you clients"
              rows={referrers}
              columns={[
                {
                  key: 'name',
                  label: 'Name',
                  render: (r) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      {r.phone && <div style={{ fontSize: 12, color: color.muted, fontFamily: font.mono }}>{r.phone}</div>}
                    </div>
                  ),
                },
                {
                  key: 'type',
                  label: 'Type',
                  render: (r) => <Badge tone={referrerTypeTone(referrerType(r))}>{referrerType(r)}</Badge>,
                },
                { key: 'commission', label: 'Commission', render: (r) => commissionText(r) },
                { key: 'clients_referred', label: 'Clients', align: 'right', render: (r) => r.clients_referred ?? 0 },
                {
                  key: 'owed',
                  label: 'Owed',
                  align: 'right',
                  render: (r) => <span style={{ color: Number(r.owed) ? color.amberInk : color.muted, fontWeight: Number(r.owed) ? 600 : 400 }}>{kes(r.owed)}</span>,
                },
                { key: 'paid', label: 'Paid', align: 'right', render: (r) => kes(r.paid) },
                {
                  key: 'actions',
                  label: '',
                  align: 'right',
                  render: (r) => (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button onClick={() => viewReferrer(r)}>View</Button>
                      <Button onClick={() => openEditReferrer(r)}>Edit</Button>
                      <Button onClick={() => setRefDeleting(r)}>Delete</Button>
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          {/* Add / edit referrer */}
          <Modal
            open={refOpen}
            title={refEdit ? `Edit ${refEdit.name}` : 'Add referrer'}
            onClose={() => setRefOpen(false)}
            footer={
              <>
                <Button onClick={() => setRefOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={saveReferrer} disabled={refBusy}>
                  {refBusy ? 'Saving…' : refEdit ? 'Save changes' : 'Add referrer'}
                </Button>
              </>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Name">
                <Input value={rf.name} onChange={setR('name')} placeholder="Full name" />
              </Field>
              <Field label="Phone" hint="Optional — for paying out or reaching them">
                <Input value={rf.phone} onChange={setR('phone')} placeholder="07xx xxx xxx" />
              </Field>
              {!refEdit && (
                <>
                  <Field label="Who is this?">
                    <Select
                      value={rf.refType}
                      onChange={setR('refType')}
                      options={[
                        { value: 'external', label: 'Someone outside your team' },
                        { value: 'staff', label: 'A staff member' },
                        { value: 'customer', label: 'An existing client' },
                      ]}
                    />
                  </Field>
                  {rf.refType === 'staff' && (
                    <Field label="Staff member">
                      <Select
                        value={rf.staffId}
                        onChange={setR('staffId')}
                        options={[{ value: '', label: '— choose —' }, ...staff.map((s) => ({ value: s.id, label: `${s.name} (${s.role})` }))]}
                      />
                    </Field>
                  )}
                  {rf.refType === 'customer' && (
                    <Field label="Client" hint="An active or past client referring their own friends and neighbours">
                      <Select
                        value={rf.subscriberId}
                        onChange={setR('subscriberId')}
                        options={[{ value: '', label: '— choose —' }, ...clients.map((c) => ({ value: c.id, label: `${c.name} (${c.account_code})` }))]}
                      />
                    </Field>
                  )}
                </>
              )}
              <Field label="Commission type">
                <Select
                  value={rf.commissionType}
                  onChange={setR('commissionType')}
                  options={[
                    { value: 'percent', label: '% of first payment' },
                    { value: 'fixed', label: 'Flat amount (KES)' },
                  ]}
                />
              </Field>
              <Field label={rf.commissionType === 'fixed' ? 'Amount (KES)' : 'Percentage'}>
                <Input
                  type="number"
                  min="0"
                  max={rf.commissionType === 'percent' ? '100' : undefined}
                  value={rf.commissionRate}
                  onChange={setR('commissionRate')}
                  placeholder={rf.commissionType === 'fixed' ? '500' : '10'}
                />
              </Field>
              <Field label="Notes" hint="Optional">
                <Textarea value={rf.notes} onChange={setR('notes')} rows={2} />
              </Field>
            </div>
          </Modal>

          {/* View referrer: commission history */}
          <Drawer open={!!refViewing} title={refViewing?.name} subtitle={refViewing ? commissionText(refViewing) : ''} onClose={() => setRefViewing(null)}>
            {refViewing && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <KV k="Type" v={{ staff: 'Staff member', customer: 'Existing client', external: 'External' }[referrerType(refViewing)]} />
                  {refViewing.subscriber_account && <KV k="Account" v={refViewing.subscriber_account} />}
                  <KV k="Phone" v={refViewing.phone ?? '—'} />
                  <KV k="Clients referred" v={refViewing.clients_referred ?? 0} />
                  <KV k="Owed" v={kes(refViewing.owed)} />
                  <KV k="Paid out" v={kes(refViewing.paid)} />
                  {refViewing.notes && <KV k="Notes" v={refViewing.notes} />}
                </div>

                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: color.muted, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 8px' }}>
                    Commission history
                  </p>
                  {commissions === null ? (
                    <p style={{ fontSize: 13, color: color.muted }}>Loading…</p>
                  ) : !commissions.length ? (
                    <p style={{ fontSize: 13, color: color.muted }}>No clients referred yet.</p>
                  ) : (
                    <Table
                      rowKey={(c) => c.id}
                      rows={commissions}
                      columns={[
                        {
                          key: 'client',
                          label: 'Client',
                          render: (c) => (
                            <div>
                              <div style={{ fontWeight: 600 }}>{c.subscriber_name}</div>
                              <div style={{ fontSize: 11.5, color: color.muted, fontFamily: font.mono }}>{c.account_code}</div>
                            </div>
                          ),
                        },
                        { key: 'basis_amount', label: 'On payment of', align: 'right', render: (c) => kes(c.basis_amount) },
                        { key: 'amount', label: 'Commission', align: 'right', render: (c) => kes(c.amount) },
                        {
                          key: 'status',
                          label: '',
                          align: 'right',
                          render: (c) =>
                            c.status === 'paid' ? (
                              <Badge tone={{ bg: '#e2ebe5', fg: color.green }}>paid</Badge>
                            ) : (
                              <Button onClick={() => markPaid(c)}>Mark paid</Button>
                            ),
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            )}
          </Drawer>

          {/* Delete referrer */}
          <Modal
            open={!!refDeleting}
            title={`Remove ${refDeleting?.name ?? ''}?`}
            onClose={() => setRefDeleting(null)}
            footer={
              <>
                <Button onClick={() => setRefDeleting(null)}>Cancel</Button>
                <Button variant="danger" onClick={confirmDeleteReferrer}>Remove referrer</Button>
              </>
            }
          >
            <p style={{ fontSize: 13.5, color: color.muted, margin: 0 }}>
              Clients they already referred keep their history, and any commission already recorded stays exactly
              as it is. This only stops them from being offered for new referrals going forward.
            </p>
          </Modal>
        </>
      )}

      {tab === 'performance' && (
        perfLoading ? (
          <Card title="Performance"><span style={{ fontSize: 13, color: color.muted }}>Loading…</span></Card>
        ) : perf.length === 0 ? (
          <Card title="Performance"><span style={{ fontSize: 13, color: color.muted }}>No staff to show yet.</span></Card>
        ) : (
          <>
            {/* Who is actually finishing the work (jobs assigned and resolved) competes as "Employee of the month"
                on Team jobs, not here — this is about the money leads have brought in, and who earns commission
                for it, which is a different question with a different, deliberately chosen answer (see the
                comment on PATCH /api/leads/:id). */}
            <Card title="Sales leaderboard" subtitle="Ranked by what the leads they brought in (as the channel) have actually paid this month">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(() => {
                  const max = Math.max(1, ...perf.map((p) => Number(p.brought_this_month)));
                  return perf.map((p, i) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 18, fontSize: 12.5, color: color.muted, fontFamily: font.mono }}>{i + 1}</span>
                      <span style={{ width: 130, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name}
                      </span>
                      <div style={{ flex: 1, height: 20, background: color.tileBg, borderRadius: radius.pill, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${(Number(p.brought_this_month) / max) * 100}%`, height: '100%',
                            background: i === 0 ? color.green : color.neutralInk, borderRadius: radius.pill,
                            transition: 'width .3s',
                          }}
                        />
                      </div>
                      <span style={{ width: 90, textAlign: 'right', fontSize: 13, fontFamily: font.mono, fontWeight: 600 }}>
                        {kes(p.brought_this_month)}
                      </span>
                      <span style={{ width: 70, textAlign: 'right', fontSize: 12, color: color.muted }}>
                        {p.won_this_month}/{p.leads_assigned} won
                      </span>
                    </div>
                  ));
                })()}
              </div>
            </Card>

            <Card title="All-time" subtitle="Lifetime leads, what they have brought in, and commission earned as a named referrer">
              <Table
                rowKey={(p) => p.id}
                rows={perf}
                columns={[
                  { key: 'name', label: 'Name', render: (p) => <span style={{ fontWeight: 600 }}>{p.name}</span> },
                  { key: 'leads_assigned', label: 'Brought in', align: 'right' },
                  { key: 'leads_won', label: 'Won', align: 'right' },
                  {
                    key: 'rate', label: 'Conversion', align: 'right',
                    render: (p) => `${p.leads_assigned > 0 ? Math.round((p.leads_won / p.leads_assigned) * 100) : 0}%`,
                  },
                  {
                    key: 'brought_total', label: 'Brought to the company', align: 'right',
                    render: (p) => kes(p.brought_total),
                  },
                  {
                    key: 'earned_total', label: 'Commission (as referrer)', align: 'right',
                    render: (p) => kes(p.earned_total),
                  },
                ]}
              />
            </Card>
          </>
        )
      )}
    </Screen>
  );
}
