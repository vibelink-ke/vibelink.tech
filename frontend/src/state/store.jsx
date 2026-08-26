import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';

/**
 * The single app store. This is the React equivalent of the DCLogic `state`
 * object in BILLING.SYSTEM.dc.html: same slice names, but every collection is
 * loaded from the backend instead of being a literal.
 */

/**
 * Exported so a harness can supply the whole store directly.
 *
 * scripts/check-screens-live.mjs renders every screen against realistic rows,
 * which is the only way to catch the faults that matter here: a screen reading
 * a field the API does not send, or handing React an object. Both look perfect
 * against an empty store, and both have reached production — a blank Hotspot
 * page and a blank Messaging page.
 *
 * The provider below is unchanged and is still the only thing the app uses.
 */
export const StoreContext = createContext(null);

/** Collections fetched once on mount, keyed by the name the screens use. */
const COLLECTIONS = {
  clients: api.subscribers,
  tickets: api.tickets,
  leads: api.leads,
  referrers: api.referrers,
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
  // The mobile nav drawer. Lives here because the Topbar opens it and the
  // Sidebar closes it, and they are siblings.
  const [navOpen, setNavOpen] = useState(false);

  // Remembered across reloads. It was plain useState, so every refresh threw the
  // choice away and snapped back to light.
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('vibelink.dark');
      if (saved !== null) return saved === '1';
      // Never chosen: follow the operating system rather than assuming light.
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;   // private browsing can throw on localStorage
    }
  });
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

  /**
   * Fetch everything in parallel; a failing slice stays empty and is recorded.
   *
   * `quiet` skips the loading flag. The periodic refresh below uses it: without
   * it every screen would drop to its skeleton on a timer, which looks like the
   * app breaking rather than keeping itself current.
   */
  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    // `tenants` is /api/tenants, superAdminOnly on the backend (see
    // server.js) — every tenant's own dashboard fetched it anyway, on every
    // mount, path change and 30-second poll, purely to feed the one screen
    // (Tenants.jsx) that only a platform owner can even reach. For anyone
    // else that was a guaranteed 403 on a timer, forever, for a collection
    // never once read. Same condition as isPlatformOwner below.
    const isPlatformOwner = !!session?.superAdmin && session?.role === 'owner';
    const entries = Object.entries(COLLECTIONS).filter(([key]) => key !== 'tenants' || isPlatformOwner);
    const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));
    // Starts from EMPTY, not {}: a skipped collection (tenants, for anyone
    // but a platform owner) needs to land on its usual [] rather than
    // undefined — every screen already reads its slice as `store.x ?? []`,
    // but there is no reason to make that guard load-bearing for a key that
    // was never actually fetched.
    const next = { ...EMPTY };
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
  }, [session]);

  /**
   * Keep every screen current without anyone pressing anything.
   *
   * Screens read from this one store, so a single refresh updates all of them:
   * a payment that lands, a router that drops, a session that ends. Thirty
   * seconds is frequent enough that a wall display is worth looking at, and
   * slow enough that it costs one request set per screen per minute.
   *
   * Paused while the tab is hidden. A dozen forgotten tabs polling all day is
   * how a small VPS ends up with a load average nobody can explain.
   */
  useEffect(() => {
    if (!session) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') reload({ quiet: true });
    };
    const id = setInterval(tick, 30000);
    // Catch up immediately on returning to the tab rather than waiting out the
    // rest of the interval on stale figures.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [session, reload]);

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

  /**
   * Every collection loaded once when the session resolved and never again
   * on its own — the 30-second poll above eventually catches up, but
   * clicking from one page to the next inside that window kept showing
   * whatever was true up to half a minute ago. A payment applied on
   * Payments was invisible on Clients until either that poll fired or a
   * hard reload forced it, which is what "I have to refresh every page"
   * was: not a bug in any one screen, every screen sharing state that only
   * a background timer ever refreshed.
   *
   * Skips the very first location (the session effect above already
   * covers that load) and re-fires on every path change after, quiet so
   * navigating doesn't flash a loading state over the page that's about
   * to render anyway.
   */
  const location = useLocation();
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (!session) return;
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    reload({ quiet: true });
  }, [location.pathname, session, reload]);

  const signIn = useCallback(
    (s, message) => {
      setSession(s);
      if (message) toast(message);
    },
    [toast]
  );

  const signOut = useCallback(async (reason) => {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setData(EMPTY);
      setUnmatched([]);
      // A string, not the click event a button handler would pass.
      toast(typeof reason === 'string' && reason ? reason : 'Signed out');
    }
  }, [toast]);

  /**
   * Sign out after six minutes with nobody at the keyboard.
   *
   * This screen is usually open on a shared machine at a shop counter, and it
   * shows every customer's phone number and can cut anyone off. Walking away
   * from it should not leave that open to whoever sits down next.
   *
   * Real activity only: a keystroke, a click, a scroll, a touch. The periodic
   * refresh above deliberately does not count — a tab left open on a shelf
   * would otherwise keep itself signed in forever, which is the exact case
   * this is for.
   */
  useEffect(() => {
    if (!session) return undefined;

    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        signOut('Signed out after 6 minutes of inactivity');
      }, 6 * 60 * 1000);
    };

    const events = ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    // passive: these fire constantly during a scroll and must never delay it.
    for (const e of events) window.addEventListener(e, arm, { passive: true });
    arm();

    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, arm);
    };
  }, [session, signOut]);

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
    try { localStorage.setItem('vibelink.dark', dark ? '1' : '0'); } catch { /* ignore */ }
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
      navOpen,
      setNavOpen,
      setDark,
      role,
      setRole,
      // Platform-owner screens follow the signed-in account, not a UI toggle.
      // Both conditions matter: superAdmin alone would show this to any staff
      // role on the one tenant that happens to be flagged super-admin, not
      // just the company owner who holds that account. The backend enforces
      // this too — see superAdminOnly in server.js.
      isPlatformOwner: !!session?.superAdmin && session?.role === 'owner' && role === 'owner',
      // Staff who may take service away from a customer. Suspend is destructive
      // enough that a support agent should not have it to hand.
      isAdmin: ['owner', 'admin'].includes(session?.role ?? role),
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
      loading, errors, session, signIn, signOut, dark, navOpen, role, searchQuery, toastMsg, toast,
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
