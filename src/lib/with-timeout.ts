// A request that never answers must end in an error the screen can show, never in a spinner that never stops
// (Outer Control, loading reliability). Pure helpers, so they are tested alone.

export class TimeoutError extends Error {
  readonly timedOut = true;
  constructor(label: string, ms: number) {
    super(`${label} took longer than ${Math.round(ms / 1000)} seconds.`);
    this.name = "TimeoutError";
  }
}

export const isTimeout = (e: unknown): boolean => e instanceof TimeoutError || (typeof e === "object" && e !== null && (e as { timedOut?: boolean }).timedOut === true);

/** Resolves with `p`, or rejects with a TimeoutError after `ms`. The timer is always cleared. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number, label = "The request"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** fetch() that is cancelled after `ms` (the connection is closed, not just ignored). */
export async function fetchWithTimeout(fetchImpl: typeof fetch, input: RequestInfo | URL, init: RequestInit, ms: number, label = "The request"): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetchImpl(input, { ...init, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new TimeoutError(label, ms);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
