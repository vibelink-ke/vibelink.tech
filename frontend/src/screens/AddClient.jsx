import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { color, font, radius } from '../theme/tokens';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { Button, Card, Field, Input, Screen, Select } from '../ui/primitives';

/** Field defaults transcribed from `state.newClient` in the mockup. */
const BLANK = {
  account: '',
  login: '',
  password: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  phoneAlt: '',
  category: 'Individual Monthly',
  billing: 'Monthly (prepaid)',
  identification: '',
  location: '',
  lineLabel: '',
  referredBy: '',
  // Blank, not a default. These shipped filled in with one spot in Eldoret, so
  // every client saved without touching the field would have claimed to live
  // there — a map full of confident wrong pins is worse than an empty one.
  lat: '',
  lng: '',
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
  const [params] = useSearchParams();

  // Arrived from Clients → a customer's drawer → "Add another line": the
  // account number is fixed to theirs (a second connection is the same
  // account, a new line tag, not a new customer) and their name/phone come
  // along so this is one field — the tag — rather than the whole form again.
  const linkedAccount = params.get('account') ?? '';
  // Arrived from a won lead instead: no account to link, just a name/phone/
  // referrer already known and not worth retyping. referredBy carries
  // straight through to createSubscriber's referredBy in save() below.
  const fromLeadReferrer = params.get('referredBy') ?? '';
  const [f, setF] = useState(() => {
    if (linkedAccount) {
      const [firstName = '', ...rest] = (params.get('name') ?? '').trim().split(/\s+/);
      return { ...BLANK, account: linkedAccount, firstName, lastName: rest.join(' '), phone: params.get('phone') ?? '' };
    }
    if (params.get('name') || params.get('phone')) {
      const [firstName = '', ...rest] = (params.get('name') ?? '').trim().split(/\s+/);
      return { ...BLANK, firstName, lastName: rest.join(' '), phone: params.get('phone') ?? '', referredBy: fromLeadReferrer };
    }
    return BLANK;
  });
  const [differentCustomer, setDifferentCustomer] = useState(false);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const hasCoords = Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lng))
    && String(f.lat).trim() !== '' && String(f.lng).trim() !== '';

  /**
   * Credentials are digits only — 5 for the account, 7 for the password.
   *
   * Both get read down a phone line and typed into a router by someone who is
   * not looking at a screen, and "is that a lowercase L or a one?" costs a
   * support call every time. The account number comes from the server because it
   * has to be unique within the tenant and only the database knows what is free.
   */
  const genCredentials = async () => {
    try {
      const { account, password } = await api.newSubscriberCredentials();
      // The PPPoE login follows the account number unless it was set by hand:
      // one number to quote for payment and to dial with is one less to lose.
      setF((s) => ({
        ...s,
        account,
        login: !s.login || s.login === s.account ? account : s.login,
        password,
      }));
    } catch (e) {
      store.toast(`Could not generate: ${e.message}`);
    }
  };

  const genLogin = async () => {
    try {
      const { account } = await api.newSubscriberCredentials();
      setF((s) => ({ ...s, login: account }));
    } catch (e) {
      store.toast(`Could not generate: ${e.message}`);
    }
  };

  // Typing is constrained too, so a pasted name cannot get into a numeric field.
  const setDigits = (k, max) => (e) =>
    setF((s) => ({ ...s, [k]: e.target.value.replace(/\D/g, '').slice(0, max) }));

  const [busy, setBusy] = useState(false);
  // Named for what it was always used for (a PPPoE-only client form), but
  // this screen also creates hotspot clients via the Service type selector
  // below — a hotspot client offered PPPoE plans (or the reverse) is not a
  // choice, since neither activateSubscriber nor a hotspot voucher can use
  // the other service's plan at all.
  const pppoePlans = (store.plans ?? []).filter((p) => p.service === f.service);

  /**
   * A real account number from the moment the form opens, not just its
   * placeholder.
   *
   * The account field showed "48213" as grey placeholder text identical in
   * style to a real generated value, and nothing required pressing Generate
   * before Save. Saving with the field still empty put the phone number where
   * a 5-digit paybill account belongs — the server now refuses that shape too,
   * but the honest fix is that there is always a real number in the field, so
   * placeholder text is never mistaken for one.
   */
  useEffect(() => {
    // Arriving with a linked account already has its real number — theirs,
    // not a fresh one — so generating here would silently swap it out from
    // under the "Add another line" flow before the operator even notices.
    if (!linkedAccount) genCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /**
   * Ask the browser where it is.
   *
   * Only works over HTTPS or on localhost, which is what production serves, and
   * needs the installer to allow it. A refusal is reported rather than swallowed
   * so nobody stands there wondering whether the button did anything.
   */
  const [locating, setLocating] = useState(false);
  const useMyLocation = () => {
    if (!navigator.geolocation) return store.toast('This browser cannot report a location');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setF((s) => ({
          ...s,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
        store.toast(`Location set to within about ${Math.round(pos.coords.accuracy)} m`);
      },
      (err) => {
        setLocating(false);
        store.toast(err.code === err.PERMISSION_DENIED
          ? 'Location permission was refused — allow it, or type the coordinates'
          : `Could not get a location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = async () => {
    const name = `${f.firstName} ${f.lastName}`.trim();
    if (!name) return store.toast('Give the client a name first');
    if (!f.phone.trim()) return store.toast('A phone number is required — it is how payments get matched');
    setBusy(true);
    try {
      const created = await api.createSubscriber({
        accountCode: f.account || f.login || f.phone,
        name,
        phone: f.phone,
        phoneAlt: f.phoneAlt,
        service: f.service.toLowerCase() === 'hotspot' ? 'hotspot' : 'pppoe',
        planId: f.planId || null,
        routerId: f.mikrotik || null,
        pppoeUser: f.login || f.account || null,
        pppoePass: f.password || null,
        staticIp: f.assignedIp || null,
        lineLabel: f.lineLabel || null,
        referredBy: f.referredBy || null,
        location: f.location || null,
        lat: f.lat,
        lng: f.lng,
        email: f.email || null,
        category: f.category || null,
        identification: f.identification || null,
        billingType: f.billing || null,
        allowDuplicatePhone: differentCustomer || !!linkedAccount,
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
      title={linkedAccount ? `Add a line for ${params.get('name') ?? 'this customer'}` : 'Add client'}
      subtitle={linkedAccount
        ? `Account ${linkedAccount} — give this line a tag below so it's told apart from their others.`
        : 'A PPPoE line. The RADIUS profile is written when the first payment lands.'}
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
            {!linkedAccount && (
              <Field
                label=" "
                hint="Leave unticked if this is the same person's second line — use Account number above instead"
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={differentCustomer}
                    onChange={(e) => setDifferentCustomer(e.target.checked)}
                  />
                  This phone number belongs to a different customer already on file
                </label>
              </Field>
            )}
            {/* A household shares the line but not the handset — whoever pays is
                often not whoever notices it is down. Both get every message. */}
            <Field label="Second number" hint="Optional. Also receives every notification">
              <Input value={f.phoneAlt} onChange={set('phoneAlt')} placeholder="07xx xxx xxx" />
            </Field>
            <Field label="Email">
              <Input value={f.email} onChange={set('email')} type="email" />
            </Field>
            <Field label="ID number">
              <Input value={f.identification} onChange={set('identification')} />
            </Field>
          </div>
        </Card>

        <Card title="Billing">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field
              label="Account number"
              hint={linkedAccount
                ? 'Fixed to their existing account — a second line bills the same customer, not a new one'
                : '5 digits. What the client types as the paybill account'}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={f.account}
                  onChange={setDigits('account', 5)}
                  inputMode="numeric"
                  placeholder="48213"
                  disabled={!!linkedAccount}
                  style={{ fontFamily: font.mono }}
                />
                {!linkedAccount && <Button onClick={genCredentials}>Generate</Button>}
              </div>
            </Field>
            {/* One customer, several connections: a house and a shop, or a
                landlord's flats. Same account number, one tag each, so the
                person sending a technician knows which line is which. */}
            <Field
              label="Line tag"
              hint="Only for a second or third line on the same account — Shop, Flat 3, Warehouse"
            >
              <Input value={f.lineLabel} onChange={set('lineLabel')} placeholder="Leave blank for their only line" />
            </Field>
            {/* Optional — most signups have no referrer at all. Credits a
                one-time commission automatically on this client's first
                payment; see the Referrals screen for who that goes to. */}
            <Field label="Referred by" hint="Optional">
              <Select
                value={f.referredBy}
                onChange={set('referredBy')}
                options={[
                  { value: '', label: '— none —' },
                  ...(store.referrers ?? []).map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
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
            <Field label="PPPoE username" hint="Defaults to the account number — one number to remember">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={f.login || f.account}
                  onChange={setDigits('login', 5)}
                  inputMode="numeric"
                  placeholder={f.account || '48213'}
                  style={{ fontFamily: font.mono }}
                />
                <Button onClick={genLogin}>Generate</Button>
              </div>
            </Field>
            <Field label="PPPoE password" hint="7 digits">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={f.password}
                  onChange={setDigits('password', 7)}
                  inputMode="numeric"
                  placeholder="4827193"
                  style={{ fontFamily: font.mono }}
                />
                <Button onClick={genCredentials}>Generate</Button>
              </div>
            </Field>
            <Field
              label="Service type"
              hint={linkedAccount ? 'A second line on this account is PPPoE — hotspot vouchers don\'t use an account number' : undefined}
            >
              <Select
                value={f.service}
                onChange={(e) => setF((s) => ({ ...s, service: e.target.value, planId: '' }))}
                options={SERVICES}
                disabled={!!linkedAccount}
              />
            </Field>
            <Field label="Plan" hint="subscribers.plan_id — drives the RADIUS rate limit and billing cycle">
              <Select
                value={f.planId}
                onChange={set('planId')}
                options={[
                  { value: '', label: pppoePlans.length ? 'Select a plan…' : `No ${f.service} plans created yet` },
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
            {/* The installer standing at the house is the only person who can
                record where it is. Asking them to read coordinates off another
                app and retype them is how the field ends up full of the default
                value it ships with. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button onClick={useMyLocation} disabled={locating}>
                {locating ? 'Finding…' : 'Use my location'}
              </Button>
              {hasCoords && (
                <a
                  href={`https://www.google.com/maps?q=${f.lat},${f.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12.5, color: color.green, fontWeight: 600 }}
                >
                  Open in Maps
                </a>
              )}
            </div>
            <span style={{ fontSize: 12.5, color: color.muted }}>
              {hasCoords
                ? 'Saved with the client, so a technician can be sent straight there.'
                : 'Leave blank if you are not at the house — a wrong pin is worse than none.'}
            </span>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
