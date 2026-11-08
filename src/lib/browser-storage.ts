// Data in transit (security task 2): what the website keeps in the browser's storage (localStorage, sessionStorage).
//
// Rule: an account's content (site text, briefs, AI replies, prompts) and any credential never go to localStorage, which outlives the
// tab and the sign-in and is readable by any script on the origin. Only the keys in BROWSER_STORAGE below are written, each with what
// it holds; src/test/browser-storage.test.ts fails the build when the website writes any other key. Content that has to survive a
// page change lives in memory (preview-cache.ts) or, for one tab and a short time, in sessionStorage.
//
// purgeSensitiveBrowserStorage() removes what older versions of the website left behind (cached site content, saved API key values,
// approved AI replies in localStorage) and runs when the website starts; clearAccountBrowserStorage() runs on sign-out.

export type StorageEntry = { storage: "local" | "session"; holds: string; content: boolean };

/** Every key (or key prefix, ending in ":" or "_") the website writes. content: true only for sessionStorage, cleared on sign-out. */
export const BROWSER_STORAGE: Record<string, StorageEntry> = {
  "sb-": { storage: "local", holds: "Supabase sign-in session (access and refresh token), kept by supabase-js so a reload stays signed in; the access token expires within an hour and the refresh token rotates on use", content: false },
  "nazai.commandCenter.checklist.v1": { storage: "local", holds: "which onboarding checklist steps are done (true/false)", content: false },
  "nazai.commandCenter.memory.v1": { storage: "local", holds: "the checklist's domain name and the names (never the values) of API keys the user listed", content: false },
  "nazai:antifragile:": { storage: "local", holds: "a display toggle per project", content: false },
  "nazai:pro-designer:": { storage: "local", holds: "a display toggle per project", content: false },
  "nazai:user-tier": { storage: "local", holds: "the credit tier name shown in the header", content: false },
  "nazai_gen_structure": { storage: "local", holds: "the generator's structure setting", content: false },
  "nazai_gen_strict": { storage: "local", holds: "the generator's strict setting (true/false)", content: false },
  "nazai-aura-profile": { storage: "local", holds: "colour and animation preferences", content: false },
  "last_version": { storage: "local", holds: "the deployment id last seen (to show what is new)", content: false },
  "nazai_spend_nudge_dismissed": { storage: "local", holds: "the account id for which the spend tip was dismissed", content: false },
  "nazai_control_settings_open": { storage: "local", holds: "whether the settings panel was open", content: false },
  "nazai-ground-truth": { storage: "session", holds: "AI replies the user approved in this tab (prompt and excerpt); gone when the tab closes or on sign-out", content: true },
  "nazai_directive": { storage: "session", holds: "the directive typed on the home page, handed to the workspace across the sign-in redirect and removed when read", content: true },
  "nazai_active_account_id": { storage: "session", holds: "the account (own or team) chosen in this tab", content: false },
  "nazai:post-auth-redirect": { storage: "session", holds: "the page to return to after signing in", content: false },
  "nazai_inner_project:": { storage: "session", holds: "the project chosen in this tab", content: false },
  "nazai-intro-played": { storage: "session", holds: "whether the entrance animation already played in this tab", content: false },
  "nazai_dryrun_reveal": { storage: "session", holds: "whether the dry-run toggle is revealed", content: false },
  "nazai_dryrun_on": { storage: "session", holds: "the dry-run toggle state", content: false },
  "nazai_ks_reveal": { storage: "session", holds: "whether the kill switch panel is revealed", content: false },
  "__nazai_chunk_reload__": { storage: "session", holds: "a one-time marker that the page reloaded after a new deployment", content: false },
};

/** Keys older versions wrote to localStorage that hold content: removed when the website starts. */
const LEGACY_CONTENT_PREFIXES = ["nazai_website_preview_", "nazai-ground-truth", "nazai-active-website-code", "nazai-fitness-sample-seeded"];

function keysOf(s: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k !== null) out.push(k); }
  return out;
}

/** Removes content and credential values that older versions of the website left in localStorage. Never throws. */
export function purgeSensitiveBrowserStorage(local: Storage | null = safeStorage("local")): number {
  if (!local) return 0;
  let removed = 0;
  try {
    for (const k of keysOf(local)) {
      if (LEGACY_CONTENT_PREFIXES.some((p) => k.startsWith(p))) { local.removeItem(k); removed++; }
    }
    // The checklist once kept pasted API key values in plain text: keep the names, drop the values.
    const raw = local.getItem("nazai.commandCenter.memory.v1");
    if (raw) {
      const m = JSON.parse(raw) as { apiKey?: unknown; apiKeys?: { value?: unknown }[] };
      const hadValues = m.apiKey !== undefined || (Array.isArray(m.apiKeys) && m.apiKeys.some((k) => k && k.value !== undefined));
      if (hadValues) {
        delete m.apiKey;
        if (Array.isArray(m.apiKeys)) m.apiKeys = m.apiKeys.map((k) => { const { value: _v, ...rest } = k ?? {}; return rest; });
        local.setItem("nazai.commandCenter.memory.v1", JSON.stringify(m));
        removed++;
      }
    }
  } catch { /* storage unavailable or malformed: nothing more to do */ }
  return removed;
}

/** On sign-out: the tab's content (sessionStorage entries marked content) and the account choice go. Never throws. */
export function clearAccountBrowserStorage(session: Storage | null = safeStorage("session")): void {
  if (!session) return;
  try {
    for (const k of keysOf(session)) {
      const entry = Object.entries(BROWSER_STORAGE).find(([key]) => k === key || ((key.endsWith(":") || key.endsWith("_")) && k.startsWith(key)));
      if (!entry || entry[1].content || k === "nazai_active_account_id" || k.startsWith("nazai_inner_project:")) session.removeItem(k);
    }
  } catch { /* storage unavailable */ }
  purgeSensitiveBrowserStorage();
}

function safeStorage(kind: "local" | "session"): Storage | null {
  try { return typeof window === "undefined" ? null : kind === "local" ? window.localStorage : window.sessionStorage; } catch { return null; }
}
