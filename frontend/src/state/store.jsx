import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * The single app store. This is the React equivalent of the DCLogic `state`
 * object in BILLING.SYSTEM.dc.html: same slice names, but every collection is
 * loaded from the backend instead of being a literal.
 */

const StoreContext = createContext(null);

/** Collections fetched once on mount, keyed by the name the screens use. */
const COLLECTIONS = {
  clients: api.subscribers,
  tickets: api.tickets,
  leads: api.leads,
  tariffs: api.tariffs,
  routers: api.routers,
  ipPools: api.ipPools,
  liveQueue: api.liveChats,
  // `plans` backs subscribers.plan_id; `tariffs` is the separate pricing-tier table
  // behind the Internet tariffs screen. They are different tables in schema.sql.
  plans: () => api.plans(),
  hsPlans: api.hotspotPlans,
  invoices: api.invoices,
  mpesaTx: api.payments,
  vouchers: api.vouchers,
  staff: api.staff,
  outages: api.outages,
  slaPolicies: api.slaPolicies,
  fupPolicies: api.fupPolicies,
  articles: api.articles,
  tenants: api.tenants,
  settlements: api.settlements,
  smsHistory: api.smsHistory,
  siteProfiles: api.siteProfiles,
  technicians: api.technicians,
  salesReps: api.salesReps,
  ovpnClients: api.ovpnClients,
};

const EMPTY = Object.fromEntries(Object.keys(COLLECTIONS).map((k) => [k, []]));

export function StoreProvider({ children }) {
  const [data, setData] = useState(EMPTY);
  const [unmatched, setUnmatched] = useState([]);
  const [hotspotSettings, setHotspotSettings] = useState({});
  const [smsGateways, setSmsGateways] = useState({ available: [], configured: [] });
  // null = not read yet. Distinct from a real zero balance, which is worth alarming
  // about — the chip shows "—" until we actually know.
  const [smsCredits, setSmsCredits] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [settings, setSettings] = useState({ org: {}, smtp: {}, prefs: {} });

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  // null = signed out, undefined = not checked yet (avoids flashing the gate).
  const [session, setSession] = useState(undefined);

  // UI-only state, mirroring the mockup's non-data state fields.
  const [dark, setDark] = useState(false);
  const [role, setRole] = useState('owner');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2600);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /** Fetch everything in parallel; a failing slice stays empty and is recorded. */
  const reload = useCallback(async () => {
    setLoading(true);
    const entries = Object.entries(COLLECTIONS);
    const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));
    const next = {};
    const errs = {};
    settled.forEach((r, i) => {
      const key = entries[i][0];
      if (r.status === 'fulfilled') next[key] = Array.isArray(r.value) ? r.value : [];
      else {
        next[key] = [];
        errs[key] = r.reason?.message ?? 'failed';
      }
    });

    const extras = await Promise.allSettled([
      api.unmatchedPayments(),
      api.hotspotSettings(),
      api.smsGateways(),
      api.smsBalance(),
      api.paymentMethods(),
      api.settings(),
    ]);
    const val = (i, fallback) => (extras[i].status === 'fulfilled' ? extras[i].value ?? fallback : fallback);

    setData(next);
    setUnmatched(val(0, []));
    setHotspotSettings(val(1, {}));
    setSmsGateways(val(2, { available: [], configured: [] }));
    setSmsCredits(val(3, null));
    setPaymentMethods(val(4, []));
    setSettings(val(5, { org: {}, smtp: {}, prefs: {} }));
    setErrors(errs);
    setLoading(false);
  }, []);

  // Resolve the session first; only load tenant data once we know who is asking.
  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((s) => !cancelled && setSession(s ?? null))
      .catch(() => !cancelled && setSession(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session) reload();
    else if (session === null) setLoading(false);
  }, [session, reload]);

  const signIn = useCallback(
    (s, message) => {
      setSession(s);
      if (message) toast(message);
    },
    [toast]
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setData(EMPTY);
      setUnmatched([]);
      toast('Signed out');
    }
  }, [toast]);

  /**
   * Live SMS credits. Polls our own API every 3s; the server answers from a cache
   * that `send()` invalidates, so the number moves the moment a message goes out
   * without asking the provider on every tick. Paused while the tab is hidden.
   */
  useEffect(() => {
    if (!session) return undefined;
    let stop = false;

    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await api.smsBalance();
        if (stop) return;
        setSmsCredits((prev) =>
          prev?.credits === next?.credits &&
          prev?.configured === next?.configured &&
          prev?.provider === next?.provider
            ? prev            // unchanged: keep the same object so consumers do not re-render
            : next
        );
      } catch {
        /* transient — the next tick will retry */
      }
    };

    const id = setInterval(tick, 3000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [session]);

  // Dark mode uses the mockup's invert-filter approach; the root class is what
  // paints the page background behind the inverted tree.
  useEffect(() => {
    document.documentElement.classList.toggle('om-dark-root', dark);
  }, [dark]);

  /** Optimistically replace one collection (used after create/delete calls). */
  const setCollection = useCallback((key, updater) => {
    setData((d) => ({ ...d, [key]: typeof updater === 'function' ? updater(d[key] ?? []) : updater }));
  }, []);

  const value = useMemo(
    () => ({
      ...data,
      unmatched,
      hotspotSettings,
      smsGateways,
      smsCredits,
      paymentMethods,
      settings,
      setSettings,
      loading,
      errors,
      session,
      signIn,
      signOut,
      dark,
      setDark,
      role,
      setRole,
      // Platform-owner screens follow the signed-in account, not a UI toggle.
      // The backend enforces this too — see superAdminOnly in server.js.
      isPlatformOwner: !!session?.superAdmin && role === 'owner',
      searchQuery,
      setSearchQuery,
      toastMsg,
      toast,
      reload,
      setCollection,
      setUnmatched,
      setHotspotSettings,
      setSmsCredits,
    }),
    [
      data, unmatched, hotspotSettings, smsGateways, smsCredits, paymentMethods, settings,
      loading, errors, session, signIn, signOut, dark, role, searchQuery, toastMsg, toast,
      reload, setCollection,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
