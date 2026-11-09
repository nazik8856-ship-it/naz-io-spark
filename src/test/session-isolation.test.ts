// General data security, task 5: session and access isolation (docs/session-isolation.md).
// What one session left in the page is gone when the next one starts; no server function keeps per-person state between requests;
// live feeds are only the database's per-person filtered ones.
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resetClientState, resetOnAccountSwitch, watchSession, type SessionChange } from "@/lib/session-reset";
import { getPreviewCache, setPreviewCache } from "@/lib/preview-cache";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function fakeAuth() {
  let cb: (e: string, s: { user?: { id?: string } | null } | null) => void = () => {};
  return { onAuthStateChange: (f: typeof cb) => { cb = f; return {}; }, emit: (e: string, id: string | null) => cb(e, id ? { user: { id } } : null) };
}

describe("the page is emptied when the session changes", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  function seed(qc: QueryClient) {
    qc.setQueryData(["websites"], [{ id: "w1", name: "Alice's bakery" }]);
    setPreviewCache("w1", { id: "w1", prompt: "Alice's brief" }, [{ slug: "home" }]);
    sessionStorage.setItem("nazai-ground-truth", "[{\"excerpt\":\"Alice's reply\"}]");
    sessionStorage.setItem("nazai_active_account_id", "alice-team");
  }

  it("signing out clears the data cache, the preview cache, live channels and the tab's storage", () => {
    const qc = new QueryClient(); seed(qc);
    let channels = 0;
    resetClientState({ queryClient: qc, removeAllChannels: () => { channels++; } }, "signed_out");
    expect(qc.getQueryData(["websites"])).toBeUndefined();
    expect(getPreviewCache("w1")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(channels).toBe(1);
  });

  it("another person signing in resets their screens to fetch fresh, and drops the preview cache and tab storage", () => {
    const qc = new QueryClient(); seed(qc);
    resetClientState({ queryClient: qc }, "user_changed");
    expect(qc.getQueryData(["websites"])).toBeUndefined();
    expect(getPreviewCache("w1")).toBeNull();
    expect(sessionStorage.getItem("nazai_active_account_id")).toBeNull();
  });

  it("one cache failing never keeps another from being emptied", () => {
    const qc = new QueryClient(); seed(qc);
    resetClientState({ queryClient: { clear: () => { throw new Error("boom"); }, resetQueries: () => { throw new Error("boom"); } }, removeAllChannels: () => { throw new Error("boom"); } }, "signed_out");
    expect(getPreviewCache("w1")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("switching the active account resets cached data and previews, and leaves the sign-in alone", () => {
    const qc = new QueryClient(); seed(qc); localStorage.setItem("nazai-aura-profile", "{}");
    resetOnAccountSwitch({ queryClient: qc });
    expect(qc.getQueryData(["websites"])).toBeUndefined();
    expect(getPreviewCache("w1")).toBeNull();
    expect(localStorage.getItem("nazai-aura-profile")).toBe("{}");
  });
});

describe("watchSession: when does the page reset", () => {
  const run = (events: [string, string | null][]): SessionChange[] => {
    const auth = fakeAuth(); const seen: SessionChange[] = [];
    watchSession(auth, (c) => seen.push(c));
    for (const [e, id] of events) auth.emit(e, id);
    return seen;
  };
  it("on sign-out", () => expect(run([["INITIAL_SESSION", "a"], ["SIGNED_OUT", null]])).toEqual(["signed_out"]));
  it("when a different person's session takes over, also from another tab", () => expect(run([["INITIAL_SESSION", "a"], ["SIGNED_IN", "b"]])).toEqual(["user_changed"]));
  it("not when the same person's session refreshes or re-announces itself", () => {
    expect(run([["INITIAL_SESSION", "a"], ["SIGNED_IN", "a"], ["TOKEN_REFRESHED", "a"], ["USER_UPDATED", "a"]])).toEqual([]);
  });
  it("not for the first person to sign in on a page that started signed out", () => expect(run([["INITIAL_SESSION", null], ["SIGNED_IN", "a"]])).toEqual([]));
  it("sign-out then another person: both resets happen, in order", () => {
    expect(run([["INITIAL_SESSION", "a"], ["SIGNED_OUT", null], ["SIGNED_IN", "b"], ["SIGNED_IN", "c"]])).toEqual(["signed_out", "user_changed"]);
  });
  it("the page is wired to it, and the account switch resets too", () => {
    expect(read("src/main.tsx")).toMatch(/watchSession\(supabase\.auth, \(change\) => resetClientState\(\{ queryClient, removeAllChannels: \(\) => supabase\.removeAllChannels\(\) \}, change\)\);/);
    expect(read("src/hooks/useActiveAccount.tsx")).toMatch(/if \(id !== accountId\) resetOnAccountSwitch\(\{ queryClient \}\);/);
    expect(read("src/App.tsx")).toContain('import { queryClient } from "@/lib/query-client"');
    expect(read("src/App.tsx")).not.toMatch(/new QueryClient\(/); // one cache, the one the reset empties
  });
});

// ---- the server keeps no per-person state between requests -----------------------------------------------------------------------
// A function instance serves many people's requests one after another. A variable at module level that holds anything about one
// request would be seen by the next. Only the reviewed ones below exist; each says why it holds nothing about a person.
const FUNCTIONS = join(ROOT, "supabase/functions");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "_test-support" ? [] : sources(p);
    return n.endsWith(".ts") && !n.endsWith("_test.ts") ? [p] : [];
  });
}
/** Top-level mutable state: `let x`, or a `const` Map/Set/WeakMap/array/object created empty and filled later. */
export function mutableTopLevel(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/^(?:export )?let (\w+)/gm)) out.push(m[1]);
  for (const m of code.matchAll(/^(?:export )?const (\w+)(?:: [^=]+)? = new (?:Map|WeakMap)(?:<[^>]*>)?\(\s*\)/gm)) out.push(m[1]);
  for (const m of code.matchAll(/^(?:export )?const (\w+)(?:: [^=]+)? = (?:\[\]|\{\})\s*(?:as [^;]+)?;/gm)) out.push(m[1]);
  return out;
}
const REVIEWED_STATE: Record<string, string> = {
  "_shared/outbound-guard.ts:cachedSecrets": "NazAI's own credentials, read once from the environment; the same for every request",
  "_shared/outbound-guard.ts:cachedOwnHost": "the host of NazAI's own project, from the environment",
  "_shared/outbound-guard.ts:cachedOwnHttp": "whether NazAI's own project address is http (local development), from the environment",
  "_shared/encrypted-db.ts:envKeys": "NazAI's own data key, read once from the environment; no per-person value",
  "_shared/local-embeddings.ts:session": "the embedding model loaded once; it keeps no input between calls",
  "_shared/outer-control-tool-request.ts:IMAGE_HOSTS_FOR_TOOLS": "an empty read-only list (no picture host is allowed in a tool's answer); never filled",
  "_shared/ai-gateway.ts:providerBreakers": "failure timestamps per AI provider (not per person): a provider outage pauses calls to that provider for everyone, which affects availability, never whose data is seen",
  "_shared/sentry.ts:initialized": "whether error reporting was started in this instance; the same for every request",
  "_shared/egress.ts:approved": "destination addresses already checked as public (https, public IPs) for five minutes; a property of the address, not of a person, and it grants no access to any data",
};

describe("no server function keeps per-person state between requests", () => {
  const found = sources(FUNCTIONS).flatMap((f) => mutableTopLevel(readFileSync(f, "utf8")).map((n) => `${f.slice(FUNCTIONS.length + 1)}:${n}`));

  it("finds mutable module state (the guard itself works)", () => {
    expect(mutableTopLevel("let a = 1;\nconst m = new Map();\nconst o = {};\nconst S = new Set([1]);\nconst fine = 3;")).toEqual(["a", "m", "o"]);
    expect(mutableTopLevel("const t = new Map<string, number>();")).toEqual(["t"]);
  });
  it("every one that exists is reviewed, with the reason it holds nothing about a person", () => {
    expect(found.filter((k) => !REVIEWED_STATE[k])).toEqual([]);
  });
  it("every reviewed entry still exists (a stale entry would hide a new one)", () => {
    expect(Object.keys(REVIEWED_STATE).filter((k) => !found.includes(k))).toEqual([]);
  });
});

describe("live feeds are only the database's per-person filtered ones", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
  const src = files(join(ROOT, "src")).map((f) => ({ f: f.slice(ROOT.length + 1), text: readFileSync(f, "utf8") }));

  it("no broadcast or presence channel (those are not filtered per person by the database)", () => {
    expect(src.filter(({ text }) => /\.on\(\s*["'](?:broadcast|presence)["']/.test(text) || /config:\s*\{[^}]*(?:broadcast|presence)/.test(text)).map((x) => x.f)).toEqual([]);
  });
  it("every table-change feed is filtered to one account, user or agent", () => {
    for (const { f, text } of src) {
      for (const m of text.matchAll(/\{\s*event:\s*"[^"]+",\s*schema:\s*"public",\s*table:\s*"[^"]+"(?:,\s*filter:\s*`[^`]*`)?\s*\}/g)) {
        expect(m[0], `${f}: ${m[0]}`).toMatch(/filter:\s*`(?:user_id|agent_id)=eq\.\$\{\w+\}`/);
      }
    }
  });
});
