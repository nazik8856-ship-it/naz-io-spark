// Onboarding and limit windows (docs/onboarding-windows.md): which window shows when, the limit window's wording and wiring, and
// the server-side free limits (3 Control Tasks and 2 new websites a month for free accounts; the owner's email has none).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextWindow, isOnboardingUser, onboardingState, feedbackRow, type OnboardingContext } from "@/lib/onboarding-windows";
import { limitCopy, limitFromDbError, limitFromResponse, resetLabel, FREE_LIMITS, UPGRADE_PATH } from "@/lib/limit-window";
import { usageRows } from "@/components/onboarding/LimitWindow";
import { feedbackTotals } from "@/pages/OpsFeedback";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ctx = (over: Partial<OnboardingContext> = {}): OnboardingContext =>
  ({ path: "/control-system/outer", done: 0, running: false, dialogOpen: false, leftOuter: false, state: {}, ...over });

describe("first-time windows: one at a time, in order", () => {
  it("first product use, then connector unlock after Task 1, then control unlock after Task 2", () => {
    expect(nextWindow(ctx())).toBe("first_use_control");
    expect(nextWindow(ctx({ done: 1, state: { first_use_control: true } }))).toBe("connector_unlock");
    expect(nextWindow(ctx({ done: 2, state: { first_use_control: true, connector_unlock: true, feedback: "useful" } }))).toBe("control_unlock");
    expect(nextWindow(ctx({ path: "/generator-home" }))).toBe("first_use_generator");
  });
  it("waits while any modal window (Welcome, the task choice, Start a task, the limit window) is open", () => {
    expect(nextWindow(ctx({ dialogOpen: true }))).toBeNull();
  });
  it("a window that was seen never comes back", () => {
    expect(nextWindow(ctx({ state: { first_use_control: true } }))).toBeNull();
  });
  it("in Outer Control after the first success nothing else is pushed: no discovery card there", () => {
    const after = ctx({ done: 1, state: { first_use_control: true, connector_unlock: true, feedback: "skipped" } });
    expect(nextWindow(after)).toBeNull();
    expect(nextWindow({ ...after, leftOuter: true })).toBeNull();
  });
  it("leaving Outer Control after the first success shows the soft discovery card once", () => {
    const left = ctx({ path: "/dashboard", done: 1, leftOuter: true, state: { connector_unlock: true, feedback: "useful" } });
    expect(nextWindow(left)).toBe("discovery");
    expect(nextWindow({ ...left, state: { ...left.state, discovery: true } })).toBeNull();
    expect(nextWindow({ ...left, leftOuter: false })).toBeNull();
  });
  it("feedback is optional and waits until no Task is running", () => {
    const ready = ctx({ done: 1, state: { first_use_control: true, connector_unlock: true } });
    expect(nextWindow(ready)).toBe("feedback");
    expect(nextWindow({ ...ready, running: true })).toBeNull();
  });
  it("only new accounts (created after the windows shipped, within 30 days) see them", () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    expect(isOnboardingUser({ created_at: "2026-11-10T00:00:00Z" }, now)).toBe(true);
    expect(isOnboardingUser({ created_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(isOnboardingUser({ created_at: "2026-11-10T00:00:00Z" }, Date.parse("2027-01-01T00:00:00Z"))).toBe(false);
    expect(onboardingState({ user_metadata: { onboarding: { feedback: "useful" } } })).toEqual({ feedback: "useful" });
  });
  it("the first two existing windows are unchanged and still come first", () => {
    const outer = read("src/components/control/outer/ActiveSessionsCard.tsx");
    expect(outer).toMatch(/if \(start === "first"\) setShowChoice\(true\);/);
    expect(outer).toMatch(/else if \(start === "connect"\) setShowConnect\(true\);/);
  });
  it("the control unlock offers exactly Try Generator (primary) and Explore AI Control", () => {
    const src = read("src/components/onboarding/OnboardingWindows.tsx");
    expect(src).toMatch(/primary=\{\{ label: "Try Generator", onClick: \(\) => go\("\/generator-home"\)/);
    expect(src).toMatch(/secondary=\{\{ label: "Explore AI Control", onClick: \(\) => go\("\/control-system"\)/);
    expect(src).not.toMatch(/Upgrade|Pro\b|pricing/); // no upgrade pressure in the first-time windows
  });
});

describe("the global limit window", () => {
  it("reads a free-limit refusal and a no-credits refusal from any server response", () => {
    expect(limitFromResponse({ error: "free_limit", kind: "control_task", used: 3, limit: 3, resets_at: "2026-12-01T00:00:00Z" }))
      .toEqual({ kind: "control_task", used: 3, limit: 3, resets_at: "2026-12-01T00:00:00Z" });
    expect(limitFromResponse({ error: "no_credits" })).toEqual({ kind: "credits" });
    expect(limitFromResponse({ code: "no_credits" })).toEqual({ kind: "credits" });
    expect(limitFromResponse({ error: "invalid_steps" })).toBeNull();
    expect(limitFromDbError({ message: "free_limit:website" })).toEqual({ kind: "website" });
  });
  it("is calm: says what stays available and when it resets, never talks about locks", () => {
    for (const kind of ["control_task", "website", "credits"] as const) {
      const c = limitCopy({ kind });
      expect(c.available.length).toBeGreaterThan(0);
      expect(JSON.stringify(c)).not.toMatch(/lock|blocked|denied|halted|!/i);
    }
    expect(resetLabel(null, new Date("2026-11-20T00:00:00Z"))).toBe("Resets on 1 December");
    expect(FREE_LIMITS).toEqual({ control_task: 3, website: 2 });
    expect(UPGRADE_PATH).toBe("/pricing");
  });
  it("View usage shows this month's counts, or no limit for an unlimited account", () => {
    expect(usageRows({ control_task: { limited: true, used: 2, limit: 3 }, website: { limited: false } })).toEqual([
      { label: "Control Tasks", used: 2, limit: 3 },
      { label: "New websites", used: null, limit: null, note: "No monthly limit on this account" },
    ]);
  });
  it("is mounted once for the whole app, and every place that starts limited work opens it", () => {
    expect(read("src/App.tsx")).toMatch(/<LimitWindow \/>/);
    expect(read("src/lib/outer-control-drive.ts")).toMatch(/showLimitIfAny\(data\)/);
    expect((read("src/pages/GeneratorHome.tsx").match(/showLimitIfAny\(body\)/g) ?? []).length).toBe(3);
    expect(read("src/pages/GeneratedDashboard.tsx")).toMatch(/limitFromDbError\(error\)/);
  });
});

describe("free limits are enforced on the server", () => {
  const sql = read("supabase/migrations/20261111010000_free_limits.sql");
  it("3 Control Tasks and 2 websites per calendar month (UTC), failed and cancelled Tasks not counted", () => {
    expect(sql).toMatch(/WHEN 'control_task' THEN 3 WHEN 'website' THEN 2/);
    expect(sql).toMatch(/date_trunc\('month', now\(\) AT TIME ZONE 'UTC'\)/);
    expect(sql).toMatch(/status NOT IN \('failed', 'cancelled', 'stopped', 'rejected', 'skipped'\)/);
  });
  it("the owner's email has no limits; paid tiers have none", () => {
    expect(sql).toMatch(/INSERT INTO public\.free_limit_exempt_emails \(email, note\) VALUES \('nazik8856@gmail\.com'/);
    expect(sql).toMatch(/IF exempt OR coalesce\(tier, 'explorer'\) <> 'explorer'/);
    expect(sql).toMatch(/REVOKE ALL ON public\.free_limit_exempt_emails FROM PUBLIC, anon, authenticated;/);
  });
  it("an insert past the limit is refused from any path (the backstop)", () => {
    expect(sql).toMatch(/BEFORE INSERT ON public\.outer_control_workflows\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_free_limit\('control_task'\)/);
    expect(sql).toMatch(/BEFORE INSERT ON public\.websites\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_free_limit\('website'\)/);
  });
  it("the server checks before it spends anything", () => {
    const drive = read("supabase/functions/outer-control-drive/index.ts");
    const pre = drive.indexOf("if (STARTS_A_TASK.has(action))");
    expect(pre).toBeGreaterThan(0);
    for (const a of ["start_session", "follow_up", "start_task", "start_report", "start_goal", "start_workflow"]) {
      expect(drive, a).toContain(`"${a}"`);
      expect(pre, a).toBeLessThan(drive.indexOf(`if (action === "${a}")`));
    }
    const wf = read("supabase/functions/_shared/outer-control-workflow.ts");
    expect(wf.indexOf('checkFreeLimit(admin, userId, "control_task")')).toBeLessThan(wf.indexOf('from("outer_control_workflows")\n    .insert('));
    const site = read("supabase/functions/compile-website-manifest/index.ts");
    expect((site.match(/checkFreeLimit\(admin, user\.id, "website"\)/g) ?? []).length).toBe(3);
    expect(site.indexOf('checkFreeLimit(admin, user.id, "website")')).toBeLessThan(site.indexOf('reportProgress(admin, requestId, user.id, "generating")'));
    expect(site.indexOf("const freeNow = await checkFreeLimit")).toBeLessThan(site.indexOf("const credit = await consumeGenerationCredit(user.id);"));
  });
});

describe("\"Was this useful?\" answers are kept", () => {
  it("each answer becomes one onboarding_feedback row with a fixed reason, never free text", () => {
    expect(feedbackRow("useful")).toEqual({ answer: "useful", reason: null });
    expect(feedbackRow("skipped")).toEqual({ answer: "skipped", reason: null });
    expect(feedbackRow("not_useful")).toEqual({ answer: "not_useful", reason: null });
    expect(feedbackRow("not_useful:too_slow")).toEqual({ answer: "not_useful", reason: "too_slow" });
    expect(feedbackRow("not_useful:anything I typed")).toBeNull();
    expect(feedbackRow("nonsense")).toBeNull();
    expect(read("src/components/onboarding/OnboardingWindows.tsx")).toMatch(/from\("onboarding_feedback"\)\.insert\(row\)/);
  });
  it("one row per account, own row only, totals for the platform only", () => {
    const sql = read("supabase/migrations/20261112010000_onboarding_feedback.sql");
    expect(sql).toMatch(/user_id uuid PRIMARY KEY REFERENCES auth\.users \(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/FOR INSERT TO authenticated WITH CHECK \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/FOR SELECT TO authenticated USING \(user_id = auth\.uid\(\)\)/);
    // The totals and the latest answers: platform owners and admins only (checked inside each function), never the anonymous key.
    for (const fn of ["onboarding_feedback_summary", "onboarding_feedback_recent"]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      expect(body.slice(0, 500), fn).toMatch(/has_role\(auth\.uid\(\), 'admin'\) OR public\.has_role\(auth\.uid\(\), 'owner'\)\) THEN\s+RAISE EXCEPTION 'not authorized'/);
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([a-z]+\\) FROM PUBLIC, anon;`));
    }
    expect(sql).not.toMatch(/SELECT f\.user_id|f\.user_id,/); // who answered is never returned
  });
  it("the operator page shows the totals and the share that found it useful", () => {
    const t = feedbackTotals([
      { answer: "useful", reason: null, accounts: 6 },
      { answer: "not_useful", reason: "too_slow", accounts: 1 },
      { answer: "not_useful", reason: "not_what_i_asked", accounts: 1 },
      { answer: "skipped", reason: null, accounts: 3 },
    ]);
    expect([t.useful, t.notUseful, t.skipped, t.answered, t.usefulPct]).toEqual([6, 2, 3, 8, 75]);
    expect(t.reasons.map((r) => r.label)).toContain("Took too long");
    expect(read("src/App.tsx")).toMatch(/path="\/ops\/feedback"/);
  });
});
