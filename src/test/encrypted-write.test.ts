// Data encryption, front 4: ocWrite and approvalSignoff send the write to encrypted-write, as the signed-in user, and return
// { data, error }.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }) } },
  SUPABASE_FUNCTIONS_URL: "https://x.test/functions/v1",
  SUPABASE_ANON: "anon",
}));
const { ocWrite, approvalSignoff } = await vi.importActual<typeof import("@/lib/encrypted-write")>("@/lib/encrypted-write");

describe("ocWrite", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("sends the table and the write steps, with the user's token, and returns the saved row", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ data: { id: "m1", directive: "Build a shop" }, error: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await ocWrite("missions").insert({ user_id: "u1", directive: "Build a shop" }).select("*").single();
    expect(r).toEqual({ data: { id: "m1", directive: "Build a shop" }, error: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test/functions/v1/encrypted-write");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-jwt");
    expect(JSON.parse(String(init.body))).toEqual({ table: "missions", ops: [
      { m: "insert", a: [{ user_id: "u1", directive: "Build a shop" }] }, { m: "select", a: ["*"] }, { m: "single", a: [] },
    ] });
  });

  it("an error or an unreachable server comes back as an error, never as a silent success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 403, json: async () => ({ data: null, error: { message: "not allowed" } }) })));
    expect(await ocWrite("missions").update({ directive: "x" }).eq("id", "m1")).toEqual({ data: null, error: { message: "not allowed" } });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, json: async () => { throw new Error("not json"); } })));
    expect((await ocWrite("missions").delete().eq("id", "m1")).error?.message).toMatch(/HTTP 502/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await ocWrite("missions").delete().eq("id", "m1")).error?.message).toMatch(/Could not reach/);
  });
});

describe("approvalSignoff", () => {
  it("sends the vote and the comment as one sign-off and returns what the database function returned", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ data: { status: "approved" }, error: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await approvalSignoff({ approval_id: "a1", vote: "approve", comment: "Looks right", reason_code: null });
    expect(r).toEqual({ data: { status: "approved" }, error: null });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      table: "pending_approvals", ops: [{ m: "signoff", a: [{ approval_id: "a1", vote: "approve", comment: "Looks right", reason_code: null }] }],
    });
  });
});
