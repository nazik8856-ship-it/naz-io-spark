import { describe, it, expect, vi } from "vitest";
import { ControlApiClient, ControlApiError } from "../../sdk/control-api-client/src/index";

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("ControlApiClient", () => {
  it("throws without an apiKey or baseUrl", () => {
    expect(() => new ControlApiClient({ apiKey: "", baseUrl: "https://x" })).toThrow(/apiKey/);
    expect(() => new ControlApiClient({ apiKey: "nazai_sk_x", baseUrl: "" })).toThrow(/baseUrl/);
  });

  it("check() posts to /control-api/v1 with the bearer header and maps a fast verdict", async () => {
    const fetchImpl = fakeFetch(200, {
      api_version: "v1",
      verdict: "allow",
      reason: "clean",
      decision_id: null,
      gate_source: null,
      mode: "fast",
    });
    const client = new ControlApiClient({ apiKey: "nazai_sk_test", baseUrl: "https://proj.supabase.co/functions/v1", fetchImpl });

    const result = await client.check({ actionType: "send_email", description: "Reply to a customer." });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://proj.supabase.co/functions/v1/control-api/v1",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer nazai_sk_test" }),
      }),
    );
    expect(result).toEqual({
      verdict: "allow",
      reason: "clean",
      decisionId: null,
      gateSource: null,
      confidenceScore: null,
      modification: null,
      policyVersion: null,
      mode: "fast",
    });
  });

  it("check() maps a full-mode verdict's extra fields", async () => {
    const fetchImpl = fakeFetch(200, {
      verdict: "modify",
      reason: "risky",
      decision_id: "d1",
      confidence_score: 0.42,
      modification: { note: "narrower" },
      policy_version: "v3",
      mode: "full",
    });
    const client = new ControlApiClient({ apiKey: "nazai_sk_test", baseUrl: "https://proj.supabase.co/functions/v1", fetchImpl });

    const result = await client.check({ actionType: "post_public_content", description: "Post something.", mode: "full" });
    expect(result.confidenceScore).toBe(0.42);
    expect(result.modification).toEqual({ note: "narrower" });
    expect(result.policyVersion).toBe("v3");
  });

  it("checkBatch() sends an actions array and maps indexed results", async () => {
    const fetchImpl = fakeFetch(200, {
      batch: true,
      count: 2,
      results: [
        { index: 0, verdict: "allow", reason: "ok", decision_id: null, gate_source: null, mode: "fast" },
        { index: 1, verdict: "block", reason: "no", decision_id: "d2", gate_source: "hard_rule", mode: "fast" },
      ],
    });
    const client = new ControlApiClient({ apiKey: "nazai_sk_test", baseUrl: "https://proj.supabase.co/functions/v1", fetchImpl });

    const result = await client.checkBatch([
      { actionType: "a", description: "b" },
      { actionType: "c", description: "d" },
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ actions: [
        { action_type: "a", provider: undefined, description: "b", params: undefined, mode: undefined },
        { action_type: "c", provider: undefined, description: "d", params: undefined, mode: undefined },
      ] }) }),
    );
    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toMatchObject({ index: 1, verdict: "block", gateSource: "hard_rule" });
  });

  it("listDecisions() GETs /decisions with query params and maps rows to camelCase", async () => {
    const fetchImpl = fakeFetch(200, {
      decisions: [{
        id: "d1", decision: "ALLOW send_email (Gmail)", reasoning: "clean", confidence_score: 91,
        escalated: false, source: "model", agent_id: null, action_type: "send_email", provider: "Gmail",
        policy_version: 3, created_at: "2026-08-27T00:00:00Z",
      }],
      has_more: true,
      next_cursor: "dxc1:abc",
    });
    const client = new ControlApiClient({ apiKey: "nazai_sk_test", baseUrl: "https://proj.supabase.co/functions/v1", fetchImpl });

    const page = await client.listDecisions({ since: "2026-08-01T00:00:00Z", limit: 50 });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://proj.supabase.co/functions/v1/control-api/v1/decisions?")).toBe(true);
    const params = new URLSearchParams(calledUrl.split("?")[1]);
    expect(params.get("since")).toBe("2026-08-01T00:00:00Z");
    expect(params.get("limit")).toBe("50");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer nazai_sk_test" }) }),
    );
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("dxc1:abc");
    expect(page.decisions).toHaveLength(1);
    expect(page.decisions[0]).toEqual({
      id: "d1", decision: "ALLOW send_email (Gmail)", reasoning: "clean", confidenceScore: 91,
      escalated: false, source: "model", agentId: null, actionType: "send_email", provider: "Gmail",
      policyVersion: 3, createdAt: "2026-08-27T00:00:00Z",
    });
  });

  it("listDecisions() with no options omits the query string entirely", async () => {
    const fetchImpl = fakeFetch(200, { decisions: [], has_more: false, next_cursor: null });
    const client = new ControlApiClient({ apiKey: "nazai_sk_test", baseUrl: "https://proj.supabase.co/functions/v1", fetchImpl });
    await client.listDecisions();
    expect(fetchImpl).toHaveBeenCalledWith("https://proj.supabase.co/functions/v1/control-api/v1/decisions", expect.anything());
  });

  it("throws ControlApiError with status and body on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(429, { error: "rate_limited", message: "Too many requests" });
    const client = new ControlApiClient({ apiKey: "nazai_sk_test", baseUrl: "https://proj.supabase.co/functions/v1", fetchImpl });

    await expect(client.check({ actionType: "x", description: "y" })).rejects.toMatchObject({
      name: "ControlApiError",
      status: 429,
      message: "Too many requests",
    });
    await expect(client.check({ actionType: "x", description: "y" })).rejects.toBeInstanceOf(ControlApiError);
  });
});
