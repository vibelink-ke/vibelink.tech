import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { color, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Field, Input, Screen, Select } from '../ui/primitives';

/** Field defaults transcribed from `state.newClient` in the mockup. */
const BLANK = {
  login: '',
  password: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  phoneAlt: '',
  category: 'Individual Monthly',
  billing: 'Monthly (prepaid)',
  birthday: '',
  identification: '',
  location: '',
  lat: '0.5246895745365',
  lng: '35.309421976184',
  service: 'PPPoE',
  mikrotik: '',
  assignedIp: '',
  planId: '',
};

const CATEGORIES = ['Individual Monthly', 'Individual Prepaid', 'Business Monthly', 'Business Contract'];
const BILLING = ['Monthly (prepaid)', 'Monthly (postpaid)', 'Weekly', 'Daily'];
const SERVICES = ['PPPoE', 'Hotspot', 'Static IP'];

export default function AddClient() {
  const store = useStore();
  const navigate = useNavigate();
  const [f, setF] = useState(BLANK);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Was 'ZN-1234' — initials from a mockup that meant nothing to anyone here.
  // The customer's own name reads better on a router's PPPoE secrets list, with
  // digits to keep it unique.
  const genLogin = () =>
    setF((s) => {
      const base = `${s.firstName} ${s.lastName}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
      return { ...s, login: `${base || 'user'}${100 + Math.floor(Math.random() * 900)}` };
    });
  const genPassword = () => setF((s) => ({ ...s, password: Math.random().toString(36).slice(2, 10) }));

  const [busy, setBusy] = useState(false);
  const pppoePlans = (store.plans ?? []).filter((p) => p.service === 'pppoe');

  // Free addresses for the chosen router, refreshed whenever it changes.
  const [freeIps, setFreeIps] = useState({ addresses: [], pools: [], loading: false });
  useEffect(() => {
    if (!f.mikrotik) return setFreeIps({ addresses: [], pools: [], loading: false });
    let live = true;
    setFreeIps((s) => ({ ...s, loading: true }));
    api.routerFreeIps(f.mikrotik)
      .then((r) => live && setFreeIps({ addresses: r.addresses ?? [], pools: r.pools ?? [], loading: false }))
      .catch(() => live && setFreeIps({ addresses: [], pools: [], loading: false }));
    return () => { live = false; };
  }, [f.mikrotik]);

  const save = async () => {
    const name = `${f.firstName} ${f.lastName}`.trim();
    if (!name) return store.toast('Give the client a name first');
    if (!f.phone.trim()) return store.toast('A phone number is required — it is how payments get matched');
    setBusy(true);
    try {
      const created = await api.createSubscriber({
        accountCode: f.login || f.phone,
        name,
        phone: f.phone,
        phoneAlt: f.phoneAlt,
        service: f.service.toLowerCase() === 'hotspot' ? 'hotspot' : 'pppoe',
        planId: f.planId || null,
        routerId: f.mikrotik || null,
        pppoeUser: f.login || null,
        pppoePass: f.password || null,
        staticIp: f.assignedIp || null,
      });
      store.setCollection('clients', (cs) => [created, ...cs]);
      store.toast(`${created.name} added`);
      navigate('/clients');
    } catch (e) {
      store.toast(`Could not save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Add client"
      subtitle="A PPPoE line. The RADIUS profile is written when the first payment lands."
      actions={
        <>
          <Button onClick={() => navigate('/clients')}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save client'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }}>
        <Card title="Identity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="First name">
              <Input value={f.firstName} onChange={set('firstName')} />
            </Field>
            <Field label="Last name">
              <Input value={f.lastName} onChange={set('lastName')} />
            </Field>
            <Field label="Phone" hint="Used for M-Pesa matching">
              <Input value={f.phone} onChange={set('phone')} placeholder="07xx xxx xxx" />
            </Field>
            {/* A household shares the line but not the handset — whoever pays is
                often not whoever notices it is down. Both get every message. */}
            <Field label="Second number" hint="Optional. Also receives every notification">
              <Input value={f.phoneAlt} onChange={set('phoneAlt')} placeholder="07xx xxx xxx" />
            </Field>
            <Field label="Email">
              <Input value={f.email} onChange={set('email')} type="email" />
            </Field>
            <Field label="Birthday">
              <Input value={f.birthday} onChange={set('birthday')} type="date" />
            </Field>
            <Field label="ID number">
              <Input value={f.identification} onChange={set('identification')} />
            </Field>
          </div>
        </Card>

        <Card title="Credentials">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Login" hint="Also the paybill account number the client types">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input value={f.login} onChange={set('login')} />
                <Button onClick={genLogin}>Generate</Button>
              </div>
            </Field>
            <Field label="Password">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input value={f.password} onChange={set('password')} />
                <Button onClick={genPassword}>Generate</Button>
              </div>
            </Field>
            <Field label="Category">
              <Select value={f.category} onChange={set('category')} options={CATEGORIES} />
            </Field>
            <Field label="Billing">
              <Select value={f.billing} onChange={set('billing')} options={BILLING} />
            </Field>
          </div>
        </Card>

        <Card title="Service">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Service type">
              <Select value={f.service} onChange={set('service')} options={SERVICES} />
            </Field>
            <Field label="Plan" hint="subscribers.plan_id — drives the RADIUS rate limit and billing cycle">
              <Select
                value={f.planId}
                onChange={set('planId')}
                options={[
                  { value: '', label: pppoePlans.length ? 'Select a plan…' : 'No PPPoE plans created yet' },
                  ...pppoePlans.map((p) => ({ value: p.id, label: `${p.title} · KES ${p.price}` })),
                ]}
              />
            </Field>
            <Field label="MikroTik router">
              <Select
                value={f.mikrotik}
                onChange={set('mikrotik')}
                options={[{ value: '', label: store.routers.length ? 'Select a router…' : 'No routers onboarded yet' },
                  ...store.routers.map((r) => ({ value: r.id, label: r.name }))]}
              />
            </Field>
            {/* Free addresses from that router's own pools, rather than a text
                box where a typo becomes a customer who cannot get online. */}
            <Field
              label="Assigned IP"
              hint={
                !f.mikrotik ? 'Pick a router first'
                  : freeIps.loading ? 'Reading the pool…'
                  : freeIps.addresses.length ? `${freeIps.addresses.length} free in ${freeIps.pools.join(', ')}`
                  : 'No pool on this router — add one under Networks'
              }
            >
              <Select
                value={f.assignedIp}
                onChange={set('assignedIp')}
                options={[
                  { value: '', label: 'Next free address' },
                  ...freeIps.addresses.map((ip) => ({ value: ip, label: ip })),
                ]}
              />
            </Field>
          </div>
        </Card>

        <Card title="Location">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Description">
              <Input value={f.location} onChange={set('location')} placeholder="Estate, street, house" />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Latitude">
                <Input value={f.lat} onChange={set('lat')} />
              </Field>
              <Field label="Longitude">
                <Input value={f.lng} onChange={set('lng')} />
              </Field>
            </div>
            <div
              style={{
                height: 120,
                borderRadius: radius.md,
                background: color.tileBg,
                border: `1px dashed ${color.line}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12.5,
                color: color.muted,
              }}
            >
              Map preview
            </div>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
