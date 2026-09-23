// Runs a promise after the response is sent instead of blocking on it.
// Every *-oauth-start function used to `await` a "delete expired rows"
// housekeeping sweep before it could even return the OAuth URL the client
// needs to open the provider's consent popup -- turning a one-row insert
// into a multi-round-trip chain the user felt as "connecting takes forever."
// That cleanup has no reason to block the click: it only ever removes rows
// nobody will read again. Uses Supabase's edge-runtime `EdgeRuntime.waitUntil`
// when available (keeps the isolate alive long enough for the promise to
// settle after the response goes out); falls back to plain fire-and-forget
// with error logging on a runtime that doesn't expose it (e.g. some local
// dev setups), which is still strictly better than blocking every request.
export function runInBackground(promise: Promise<unknown>, label: string): void {
  const settled = promise.catch((err) => {
    console.error(`[background:${label}] failed`, err);
  });
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(settled);
}
