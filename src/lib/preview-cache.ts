// Data in transit (security task 2): the website preview's instant first frame, kept in memory only. Older versions kept the site's
// content and brief in localStorage, where it outlived the tab and the sign-in (browser-storage.ts removes those copies). The preview
// opens in an iframe or a new tab of the same site, so the reader also looks in the parent and the opener window (same origin only).

type Entry = { website: unknown; pages: unknown[]; cachedAt: number };
type Store = { get(k: string): Entry | undefined; set(k: string, v: Entry): unknown; delete(k: string): unknown; keys(): IterableIterator<string>; size: number };
const KEY = "__nazaiPreviewCache";
const MAX = 20;

function storeOf(w: Window | null | undefined): Store | null {
  try {
    const s = w ? (w as unknown as Record<string, unknown>)[KEY] : null;
    return s && typeof (s as Store).get === "function" ? (s as Store) : null;
  } catch {
    return null; // another origin: not readable, and not ours
  }
}

function own(): Store | null {
  if (typeof window === "undefined") return null;
  let s = storeOf(window);
  if (!s) { s = new Map<string, Entry>(); (window as unknown as Record<string, unknown>)[KEY] = s; }
  return s;
}

export function setPreviewCache(websiteId: string, website: unknown, pages: unknown[]): void {
  const s = own();
  if (!s) return;
  s.delete(websiteId);
  s.set(websiteId, { website, pages, cachedAt: Date.now() });
  while (s.size > MAX) { const first = s.keys().next().value; if (first === undefined) break; s.delete(first); }
}

export function getPreviewCache(websiteId: string): Entry | null {
  if (typeof window === "undefined") return null;
  let others: (Window | null)[] = [];
  try { others = [window.parent !== window ? window.parent : null, window.opener as Window | null]; } catch { others = []; }
  for (const w of [window, ...others]) {
    const e = storeOf(w)?.get(websiteId);
    if (e) return e;
  }
  return null;
}
