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
    expect(r).toEqual({ data: [{ id: "s1", objective: "Write the plan" }], error: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/functions/v1/outer-control-read");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-jwt");
    expect(JSON.parse(String(init.body))).toEqual({ table: "outer_control_sessions", ops: [
      { m: "select", a: ["id, objective"] }, { m: "eq", a: ["user_id", "u1"] }, { m: "order", a: ["started_at", { ascending: false }] }, { m: "limit", a: [10] },
    ] });
  });

  it("an error or an unreachable server comes back as an error, never as empty data that looks real", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 400, json: async () => ({ data: null, error: { message: "unknown table" } }) })));
    expect(await ocRead("outer_control_sessions").select("id")).toEqual({ data: null, error: { message: "unknown table" } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await ocRead("outer_control_sessions").select("id")).error?.message).toMatch(/Could not reach/);
  });
});
