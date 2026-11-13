// Data encryption, front 3: ocRead sends the query to outer-control-read, as the signed-in user, and returns { data, error }.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }) } },
  SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1",
  SUPABASE_ANON: "anon",
}));
const { ocRead } = await vi.importActual<typeof import("@/lib/outer-control-read")>("@/lib/outer-control-read");

describe("ocRead", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("sends the table and the query steps, with the user's token, and returns the decrypted rows", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ data: [{ id: "s1", objective: "Write the plan" }], error: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await ocRead("outer_control_sessions").select("id, objective").eq("user_id", "u1").order("started_at", { ascending: false }).limit(10);
    expect(r).toEqual({ data: [{ id: "s1", objective: "Write the plan" }], error: null, count: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/functions/v1/outer-control-read");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-jwt");
    expect(JSON.parse(String(init.body))).toEqual({ table: "outer_control_sessions", ops: [
      { m: "select", a: ["id, objective"] }, { m: "eq", a: ["user_id", "u1"] }, { m: "order", a: ["started_at", { ascending: false }] }, { m: "limit", a: [10] },
    ] });
  });

  it("an error or an unreachable server comes back as an error, never as empty data that looks real", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 400, json: async () => ({ data: null, error: { message: "unknown table" } }) })));
    expect(await ocRead("outer_control_sessions").select("id")).toEqual({ data: null, error: { message: "unknown table" }, count: null });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await ocRead("outer_control_sessions").select("id")).error?.message).toMatch(/Could not reach/);
  });

  it("passes the row count through when the screen asks for one", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ data: [], error: null, count: 7 }) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await ocRead("pending_approvals").select("id, description", { count: "exact" }).or("status.eq.pending,status.eq.approved");
    expect(r.count).toBe(7);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).ops).toEqual([
      { m: "select", a: ["id, description", { count: "exact" }] }, { m: "or", a: ["status.eq.pending,status.eq.approved"] },
    ]);
  });
});

describe("ocRead never waits forever", () => {
  beforeEach(() => vi.unstubAllGlobals());
  it("a server that never answers ends as a timeout error the screen can show", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn((_u: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))));
      const p = Promise.resolve(ocRead("outer_control_sessions").select("id")); // the read starts when awaited
      await vi.advanceTimersByTimeAsync(15_000);
      const r = await p;
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe("timeout");
      expect(r.error?.message).toMatch(/too long/);
    } finally { vi.useRealTimers(); }
  });
});
