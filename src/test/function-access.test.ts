// User & data isolation, front 1: every edge function is registered with how it decides who is calling
// (supabase/functions/_shared/function-access.ts), and its code matches that entry. Front 3 tightens these checks; the known
// gaps are listed in the register, so a fixed gap that is still listed, or a new gap, fails here.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FUNCTION_ACCESS } from "../../supabase/functions/_shared/function-access";

const FUNCTIONS = join(__dirname, "../../supabase/functions");
const fns = readdirSync(FUNCTIONS).filter((d) => !d.startsWith("_") && existsSync(join(FUNCTIONS, d, "index.ts")));
const src = (fn: string) => readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8");

/** The caller is checked: a sign-in token is verified, or the query runs as the caller (their Authorization on the client). */
const checksUser = (s: string) =>
  /auth\.getUser\(|getClaims\(/.test(s)
  || (/from "\.\.\/_shared\/caller\.ts"/.test(s) && /requireCaller\(/.test(s)) // the shared helper verifies the token (_shared/caller.ts)
  || /global:\s*\{\s*headers:\s*\{\s*Authorization:\s*(authHeader|`Bearer \$\{ctx\.getToken\(\)\}`)/.test(s);
/** The request must carry the server key (compared with the incoming Authorization header). */
const checksServerKey = (s: string) =>
  /(authHeader|req\.headers\.get\("Authorization"\)[^)]*\)|token|callerToken)\s*!==?\s*(`Bearer \$\{serviceKey\}`|serviceKey|supabaseServiceKey)/.test(s)
  || /timingSafeEqual\(token, serviceKey\)/.test(s);
const checksApiKey = (s: string) => /from "\.\.\/_shared\/(api-key-auth|control-api-auth)\.ts"/.test(s);

describe("every edge function says how it decides who is calling", () => {
  it("lists every function, and only existing ones", () => {
    expect(Object.keys(FUNCTION_ACCESS).filter((f) => !fns.includes(f))).toEqual([]);
    expect(fns.filter((f) => !FUNCTION_ACCESS[f])).toEqual([]);
  });

  it("every public function and every exception says why", () => {
    const bad = Object.entries(FUNCTION_ACCESS).filter(([, a]) => a.access === "public" && !(a.reason && a.reason.length >= 20)).map(([f]) => f);
    expect(bad).toEqual([]);
  });

  it("the checks find what they look for (the guard itself works)", () => {
    expect(checksUser(src("delete-project"))).toBe(true);
    expect(checksUser(src("outer-control-read"))).toBe(true);
    expect(checksServerKey(src("retention-sweep"))).toBe(true);
    expect(checksServerKey(src("agent-scheduler"))).toBe(true); // sends the key on its own calls and now also checks incoming ones
    expect(checksServerKey('const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); await fetch(url, { headers: { Authorization: `Bearer ${key}` } });')).toBe(false); // sending the key is not checking it
    expect(checksApiKey(src("control-api"))).toBe(true);
  });

  const failing = (fn: string): boolean => {
    const a = FUNCTION_ACCESS[fn], s = src(fn);
    if (a.access === "user" && a.checkedBy) {
      return !(/Authorization:\s*authHeader/.test(s) && FUNCTION_ACCESS[a.checkedBy]?.access === "user" && checksUser(src(a.checkedBy)));
    }
    if (a.access === "user") return !checksUser(s);
    if (a.access === "system") return !checksServerKey(s);
    if (a.access === "api_key") return !checksApiKey(s);
    return false;
  };

  it.each(fns.filter((f) => FUNCTION_ACCESS[f] && !FUNCTION_ACCESS[f].gap))("%s checks its caller the way its entry says", (fn) => {
    expect(failing(fn)).toBe(false);
  });

  it("a listed gap is still a gap (remove the entry's gap once fixed), and none are open", () => {
    const listed = Object.entries(FUNCTION_ACCESS).filter(([, a]) => a.gap).map(([f]) => f).sort();
    expect(listed.filter((f) => !failing(f))).toEqual([]);
    expect(listed).toEqual([]);
  });

  it("the three scheduled jobs that used to answer anyone now need the server key", () => {
    for (const fn of ["agent-scheduler", "calibrate-confidence", "measure-decision-outcomes"]) {
      expect(FUNCTION_ACCESS[fn].access).toBe("system");
      expect(checksServerKey(src(fn)), fn).toBe(true);
      // the check comes before anything is read or written
      const s = src(fn);
      expect(s.indexOf("timingSafeEqual(token, serviceKey)"), fn).toBeGreaterThan(0);
      expect(s.indexOf("timingSafeEqual(token, serviceKey)"), fn).toBeLessThan(s.indexOf(".from("));
    }
  });
});
