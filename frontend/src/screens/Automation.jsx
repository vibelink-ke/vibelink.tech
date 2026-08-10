import React, { useEffect, useState } from 'react';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Badge, Button, Card, Grid, Screen, Stat, Toggle } from '../ui/primitives';

/**
 * The live jobs come from GET /api/automation, which reports each cron in
 * backend/src/jobs.js together with whether this tenant has switched it off.
 * Turning one off writes to automation_jobs, and every job's query excludes
 * tenants that disabled it — so the switch really does stop the work.
 */

/** Transcribed verbatim from `state.suggestedList`. */
const SUGGESTED = [
  { id: 's1', title: 'Predict churn before it happens', detail: 'Flags accounts whose usage drops 60%+ for a week — the strongest signal a client is about to leave. Sales rep gets the list every Monday.', impact: 'Typically saves 4–6 accounts a month' },
  { id: 's2', title: 'Smart payment-day nudges', detail: 'Learns when each client usually pays and sends the reminder that morning instead of a fixed schedule.', impact: 'Fewer reminders, faster payment' },
  { id: 's3', title: 'Auto-compensate on outages', detail: 'When a router is down more than 2 hours, every affected account gets pro-rated days back plus an apology SMS — no tickets raised.', impact: 'Cuts complaint tickets sharply' },
  { id: 's4', title: 'Bandwidth boost at off-peak', detail: 'Doubles speeds between 01:00 and 06:00 when upstream is idle. Costs nothing and clients notice.', impact: 'Cheap goodwill' },
  { id: 's5', title: 'Referral auto-invite', detail: 'After 3 months of on-time payment, the client gets an SMS with their own referral code and commission rate.', impact: 'Turns good payers into a sales channel' },
  { id: 's6', title: 'Duplicate-payment guard', detail: 'If the same M-Pesa amount lands twice from one number within 10 minutes, hold the second and alert the cashier instead of double-crediting.', impact: 'Stops refund disputes' },
  { id: 's7', title: 'Installation follow-up', detail: '48 hours after a new install, ask for a 1–5 rating by SMS. Anything under 4 opens a ticket automatically.', impact: 'Catches bad installs early' },
  { id: 's8', title: 'Capacity early warning', detail: 'Alerts you when a router passes 80% of its session or IP-pool limit, with the recommended next step.', impact: 'Avoids surprise outages' },
  { id: 's9', title: 'Idle-voucher recovery', detail: 'Vouchers bought but never used for 7 days get an SMS nudge with the code repeated.', impact: 'Recovers forgotten purchases' },
  { id: 's10', title: 'Auto-escalate silent tickets', detail: 'Any ticket untouched for 4 hours moves up a priority level and pings the owner on WhatsApp.', impact: 'Keeps SLA honest' },
];

export default function Automation() {
  const store = useStore();
  const [enabled, setEnabled] = useState({});     // suggestions, local only
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    api
      .automation()
      .then(setJobs)
      .catch((e) => store.toast(`Could not load automation: ${e.message}`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleJob = async (j) => {
    const next = !j.enabled;
    setPending(j.job);
    setJobs((xs) => xs.map((x) => (x.job === j.job ? { ...x, enabled: next } : x)));
    try {
      await api.setAutomation(j.job, next);
      store.toast(`${j.name} ${next ? 'resumed' : 'stopped'}`);
    } catch (e) {
      setJobs((xs) => xs.map((x) => (x.job === j.job ? { ...x, enabled: !next } : x)));
      store.toast(`Could not change it: ${e.message}`);
    } finally {
      setPending(null);
    }
  };

  const running = jobs.filter((j) => j.enabled).length;
  const stopped = jobs.length - running;

  return (
    <Screen
      title="Automation"
      subtitle="What the system does without being asked. The jobs below are live in the backend; the suggestions are not built yet."
    >
      <Grid min={200} gap={14}>
        <Stat label="Running" value={running} tone={running ? color.green : undefined} hint="scheduled and active" />
        <Stat label="Stopped" value={stopped} tone={stopped ? color.amberInk : undefined} hint="switched off here" />
        <Stat label="Suggested" value={SUGGESTED.length} hint="not implemented" />
        <Stat label="Ran in 24h" value={0} hint="no run log yet" />
      </Grid>

      <Card
        title="Running now"
        subtitle="Turning one off stops it for this tenant — every job's query skips tenants that disabled it"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <span style={{ fontSize: 12.5, color: color.muted }}>Loading…</span>}
          {jobs.map((j) => (
            <div
              key={j.job}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '11px 13px',
                border: `1px solid ${j.enabled ? color.line : '#e6d8c4'}`,
                borderRadius: radius.md,
                background: j.enabled ? '#fff' : '#fffdf7',
                opacity: pending === j.job ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}>
                  {j.name}
                  <Badge tone={j.enabled ? 'active' : 'unused'}>{j.enabled ? 'live' : 'stopped'}</Badge>
                </span>
                <span style={{ fontSize: 12, color: color.neutralInk }}>{j.detail}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <code style={{ fontSize: 11.5, color: color.muted }}>{j.cron}</code>
                <Toggle
                  checked={j.enabled}
                  onChange={() => toggleJob(j)}
                  label=""
                  detail=""
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Suggested rules" subtitle="Ideas the design shipped with — none are wired to the backend">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {SUGGESTED.map((s) => {
            const on = !!enabled[s.id];
            return (
              <div
                key={s.id}
                style={{
                  border: `1px solid ${on ? color.green : color.line}`,
                  borderRadius: radius.lg,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  background: on ? '#f4faf7' : '#fff',
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.title}</span>
                <span style={{ fontSize: 12.5, color: color.neutralInk, lineHeight: 1.5 }}>{s.detail}</span>
                <span style={{ fontSize: 11.5, color: color.green, fontWeight: 600 }}>{s.impact}</span>
                <Button
                  size="sm"
                  variant={on ? 'default' : 'primary'}
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => {
                    setEnabled((e) => ({ ...e, [s.id]: !e[s.id] }));
                    store.toast(on ? `${s.title} turned off` : `${s.title} queued — needs a backend rule to run`);
                  }}
                >
                  {on ? 'Turn off' : 'Enable'}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </Screen>
  );
}
