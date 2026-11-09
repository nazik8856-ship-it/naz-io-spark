// Data in transit (security task 2): what the website may keep in the browser (src/lib/browser-storage.ts). The build fails when the
// website writes a localStorage or sessionStorage key that is not in the register, when a register entry holding content is in
// localStorage, or when site content or a key value would go to localStorage again.
import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_STORAGE, clearAccountBrowserStorage, purgeSensitiveBrowserStorage } from "@/lib/browser-storage";
import { getPreviewCache, setPreviewCache } from "@/lib/preview-cache";

const SRC = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Every literal key (or the literal start of a template key) passed to setItem, with the storage it goes to. */
function writes(src: string): { storage: "local" | "session"; key: string }[] {
  const out: { storage: "local" | "session"; key: string }[] = [];
  const consts = new Map([...src.matchAll(/const (\w+) = ["'`]([^"'`$]+)["'`]/g)].map((m) => [m[1], m[2]]));
  // a key built from a prefix constant: `${PREFIX}${id}` or prefixKey(id) where prefixKey = (…) => `${PREFIX}…`
  const fns = new Map([...src.matchAll(/(?:const|function) (\w+)\s*=?\s*\([^)]*\)[^`\n;{}]*?=>\s*`\$\{(\w+)\}/g)].map((m) => [m[1], consts.get(m[2])]));
  for (const m of src.matchAll(/\b(localStorage|sessionStorage)\.setItem\(\s*(?:`\$\{(\w+)\}|["'`]([^"'`$]*)|(\w+)(?:\(([^)]*)\))?)/g)) {
    let key = m[2] ? consts.get(m[2]) : m[3] ?? (m[4] ? (m[5] !== undefined ? fns.get(m[4]) : consts.get(m[4])) : undefined);
    if (key === undefined) key = `?${m[2] ?? m[4]}`;
    out.push({ storage: m[1] === "localStorage" ? "local" : "session", key: key! });
  }
  return out;
}
const registered = (key: string, storage: "local" | "session") =>
  Object.entries(BROWSER_STORAGE).some(([k, e]) => e.storage === storage && (key === k || ((k.endsWith(":") || k.endsWith("_")) && key.startsWith(k))));

describe("the website writes only registered browser-storage keys", () => {
  const all = files(SRC).flatMap((f) => writes(readFileSync(f, "utf8")).map((w) => ({ ...w, file: f.slice(SRC.length + 1) })));

  it("finds the writes (the guard itself works)", () => {
    expect(all.length).toBeGreaterThan(15);
    expect(writes('const K = "x:y"; localStorage.setItem(K, "1"); sessionStorage.setItem(`a_${id}`, v);')).toEqual([{ storage: "local", key: "x:y" }, { storage: "session", key: "a_" }]);
    expect(writes('const P = "p:"; const k = (id: string) => `${P}${id}`; localStorage.setItem(`${P}${x}`, v); sessionStorage.setItem(k(a), v);').map((w) => w.key)).toEqual(["p:", "p:"]);
    expect(writes("localStorage.setItem(unknownKey, v);").map((w) => w.key)).toEqual(["?unknownKey"]);
  });

  it("every key written is in the register, in the storage the register names", () => {
    const unknown = all.filter((w) => !registered(w.key, w.storage)).map((w) => `${w.file}: ${w.storage}Storage ${w.key}`);
    expect(unknown).toEqual([]);
  });

  it("nothing that holds an account's content is kept in localStorage", () => {
    expect(Object.entries(BROWSER_STORAGE).filter(([, e]) => e.content && e.storage === "local").map(([k]) => k)).toEqual([]);
  });

  it("site content and key values never go to localStorage again", () => {
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/localStorage\.setItem\([^)]*nazai_website_preview_/);
    }
    const checklist = readFileSync(join(SRC, "components/dashboard/CommandCenterChecklist.tsx"), "utf8");
    expect(checklist).toMatch(/const persisted = \{ \.\.\.memory, apiKeys: \(memory\.apiKeys \?\? \[\]\)\.map\(\(\{ value: _value, \.\.\.k \}\) => k\) \};\n\s*localStorage\.setItem\(MEMORY_KEY, JSON\.stringify\(persisted\)\);/);
  });

  it("the website clears old copies when it starts and the tab's content on sign-out", () => {
    const main = readFileSync(join(SRC, "main.tsx"), "utf8");
    expect(main).toMatch(/purgeSensitiveBrowserStorage\(\);/);
    expect(main).toMatch(/watchSession\(supabase\.auth, \(change\) => resetClientState\(/); // signed out / another person: session-reset.ts
  });
});

describe("cleaning up", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it("old site content and approved replies in localStorage are removed; API key values are dropped, names kept", () => {
    localStorage.setItem("nazai_website_preview_w1", JSON.stringify({ website: { prompt: "my brief" }, pages: [] }));
    localStorage.setItem("nazai-ground-truth", "[]");
    localStorage.setItem("nazai.commandCenter.memory.v1", JSON.stringify({ domain: "acme.com", apiKey: "sk-old", apiKeys: [{ id: "1", name: "Stripe", value: "sk_live_x", createdAt: 1 }] }));
    localStorage.setItem("nazai-aura-profile", "{}");
    expect(purgeSensitiveBrowserStorage()).toBe(3);
    expect(localStorage.getItem("nazai_website_preview_w1")).toBeNull();
    expect(localStorage.getItem("nazai-ground-truth")).toBeNull();
    expect(JSON.parse(localStorage.getItem("nazai.commandCenter.memory.v1")!)).toEqual({ domain: "acme.com", apiKeys: [{ id: "1", name: "Stripe", createdAt: 1 }] });
    expect(localStorage.getItem("nazai-aura-profile")).toBe("{}");
    expect(purgeSensitiveBrowserStorage()).toBe(0);
  });

  it("sign-out removes the tab's content and account choice, keeps harmless tab flags", () => {
    sessionStorage.setItem("nazai-ground-truth", "[{}]");
    sessionStorage.setItem("nazai_directive", "Build my shop");
    sessionStorage.setItem("nazai_active_account_id", "a1");
    sessionStorage.setItem("nazai_inner_project:a1", "p1");
    sessionStorage.setItem("nazai-intro-played", "1");
    sessionStorage.setItem("someone-elses-key", "x");
    clearAccountBrowserStorage();
    expect(Object.keys(sessionStorage).sort()).toEqual(["nazai-intro-played"]);
  });

  it("the preview cache lives in memory, not in the browser's storage", () => {
    setPreviewCache("w9", { id: "w9", prompt: "brief" }, [{ slug: "home" }]);
    expect(getPreviewCache("w9")?.pages).toEqual([{ slug: "home" }]);
    expect(Object.keys(localStorage).length + Object.keys(sessionStorage).length).toBe(0);
  });
});
