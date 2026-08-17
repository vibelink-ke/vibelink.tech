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
export default function Automation() {
  const store = useStore();
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
  // Loaded separately: a run log that fails to read should not stop the
  // switches on this page from working.
  const [runs, setRuns] = useState(null);
  useEffect(() => { api.automationRuns().then(setRuns).catch(() => {}); }, []);

  const stopped = jobs.length - running;

  return (
    <Screen
      title="Automation"
      subtitle="What the system does without being asked, and whether it has been running"
    >
      <Grid min={200} gap={14}>
        <Stat label="Running" value={running} tone={running ? color.green : undefined} hint="scheduled and active" />
        <Stat label="Stopped" value={stopped} tone={stopped ? color.amberInk : undefined} hint="switched off here" />
        {/* Real, from job_runs. This was a hardcoded zero, which said the
            system was idle while it was working. */}
        <Stat
          label="Ran in 24h"
          value={runs?.total ?? '—'}
          tone={runs?.failures ? color.rust : undefined}
          hint={runs ? (runs.failures ? `${runs.failures} failed` : 'all succeeded') : 'loading'}
        />
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

    </Screen>
  );
}
