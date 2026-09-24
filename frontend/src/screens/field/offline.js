import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';

/**
 * Working with no signal.
 *
 * Anything a technician does on a job (start it, add a note, take a photo, record equipment, close it)
 * is tried first; if the phone cannot reach the server it is kept on the phone (IndexedDB) and sent,
 * in order, as soon as the signal returns. Reads (the job list, a job) fall back to the last copy seen.
 *
 * A request the server answers with an error (the job was closed by the office, a photo was refused)
 * is not a network problem: it stays in the list, marked failed with the reason, and holds back that
 * job's later steps until someone retries or discards it.
 */
const DB = 'vibelink-field';
const STORE = 'queue';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
};

export const queueList = async () => (await tx('readonly', (s) => s.getAll())) ?? [];
const queueAdd = (item) => tx('readwrite', (s) => s.add({ ...item, at: Date.now() }));
const queuePut = (item) => tx('readwrite', (s) => s.put(item));
export const queueRemove = (id) => tx('readwrite', (s) => s.delete(id));

/** True when the failure is the network, not an answer from the server. */
export const isNetworkError = (e) => !e || e.name !== 'ApiError';

const RUN = {
  start: (p) => api.fieldStart(p.jobId),
  note: (p) => api.fieldNote(p.jobId, p.body),
  photo: (p) => api.fieldPhoto(p.jobId, p.body),
  equipment: (p) => api.fieldEquipment(p.jobId, p.body),
  close: (p) => api.fieldClose(p.jobId, p.body),
};

/** Do it now, or keep it for later. Resolves { queued: true } when it was kept. */
export async function doOrQueue(type, payload) {
  // Behind an earlier step of the same job that is still waiting: keep the order.
  const waiting = (await queueList()).some((q) => q.payload?.jobId === payload.jobId);
  if (!waiting && navigator.onLine !== false) {
    try { return { queued: false, result: await RUN[type](payload) }; }
    catch (e) { if (!isNetworkError(e)) throw e; }
  }
  await queueAdd({ type, payload });
  notify();
  return { queued: true };
}

let flushing = false;
export async function flushQueue() {
  if (flushing) return { sent: 0 };
  flushing = true;
  let sent = 0;
  try {
    const items = (await queueList()).sort((a, b) => a.id - b.id);
    const blockedJobs = new Set();
    for (const item of items) {
      if (blockedJobs.has(item.payload?.jobId)) continue;
      if (item.error && !item.retry) { blockedJobs.add(item.payload?.jobId); continue; }
      try {
        await RUN[item.type](item.payload);
        await queueRemove(item.id);
        sent += 1;
      } catch (e) {
        if (isNetworkError(e)) break;                        // still no signal: try again later
        await queuePut({ ...item, error: e.message ?? 'Refused', retry: false });
        blockedJobs.add(item.payload?.jobId);
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return { sent };
}

export const retryItem = async (item) => { await queuePut({ ...item, error: null, retry: true }); return flushQueue(); };

// A tiny event so every screen showing the queue updates when it changes.
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

/** The waiting items, kept fresh, with the sync running while the app is open. */
export function useQueue() {
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState(navigator.onLine !== false);
  const refresh = useCallback(() => queueList().then(setItems).catch(() => {}), []);

  useEffect(() => {
    refresh();
    listeners.add(refresh);
    const on = () => { setOnline(true); flushQueue(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    flushQueue();
    const id = setInterval(() => { if (navigator.onLine !== false) flushQueue(); }, 30000);
    return () => {
      listeners.delete(refresh);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(id);
    };
  }, [refresh]);

  return { items, online, refresh, waiting: items.filter((i) => !i.error).length, failed: items.filter((i) => i.error) };
}

// ── last copy seen, for when there is no signal ────────────────────────────
const CACHE = 'vibelink-field-cache:';
export async function cachedGet(key, fetcher) {
  try {
    const value = await fetcher();
    try { localStorage.setItem(CACHE + key, JSON.stringify({ at: Date.now(), value })); } catch { /* storage full or private mode */ }
    return { value, stale: false };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    try {
      const hit = JSON.parse(localStorage.getItem(CACHE + key) ?? 'null');
      if (hit) return { value: hit.value, stale: true, at: hit.at };
    } catch { /* unreadable */ }
    throw e;
  }
}
