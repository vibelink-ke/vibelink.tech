import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api/client';

/**
 * The tenant's licence status, checked when the app opens, whenever the tab is
 * shown again, and every half hour. Shared by the top-bar countdown and the
 * expiry banner so they never disagree and only ask once.
 */
export default function useLicence() {
  const store = useStore();
  const [lic, setLic] = useState(null);

  useEffect(() => {
    if (!store.session) return undefined;
    let live = true;
    const check = () => api.licence().then((l) => { if (live) setLic(l); }).catch(() => {});
    check();
    const id = setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    // The billing page announces a payment so the banner does not wait for the next check.
    window.addEventListener('vibelink:licence-changed', check);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('vibelink:licence-changed', check);
    };
  }, [store.session]);

  return lic;
}
