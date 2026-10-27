// Run with: deno test --allow-env supabase/functions/_shared/integration-disconnect_test.ts
// Secrets handling, front 3: Disconnect cancels the token at the provider, records the outcome, and deletes the integration even
// when the provider refuses.
import { disconnectIntegration } from "./integration-disconnect.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, vault: Record<string, unknown>) {
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      let op: "select" | "insert" | "delete" = "select";
      let payload: Row = {};
      const filters: ((r: Row) => boolean)[] = [];
      const q = {
        select() { op = "select"; return q; },
        insert(p: Row) { op = "insert"; payload = p; return q; },
        delete() { op = "delete"; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
        // deno-lint-ignore no-explicit-any
        then(res: any) {
          if (op === "insert") { rows.push(payload); return Promise.resolve({ data: null, error: null }).then(res); }
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "delete") { tables[table] = rows.filter((r) => !hit.includes(r)); return Promise.resolve({ data: null, error: null }).then(res); }
          return Promise.resolve({ data: hit, error: null }).then(res);
        },
      };
      return q;
    },
    rpc(name: string, args: { sid: string }) { return Promise.resolve({ data: name === "read_integration_secret" ? vault[args.sid] ?? null : null, error: null }); },
  };
  return client;
}

Deno.test("disconnect: the token is revoked at the provider, the outcome recorded, the integration deleted", async () => {
  const tables: Record<string, Row[]> = {
    agent_integrations: [
      { id: "i1", user_id: "u", provider: "Slack", agent_id: null, credentials_secret_id: "s1" },
      { id: "i2", user_id: "u", provider: "Slack", agent_id: "agent-x", credentials_secret_id: "s2" },
      { id: "i3", user_id: "other", provider: "Slack", agent_id: null, credentials_secret_id: "s3" },
    ],
  };
  const db = fakeDb(tables, { s1: { access_token: "xoxb-mine" } });
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push(`${url} ${new Headers(init.headers).get("authorization")}`); return new Response('{"ok":true,"revoked":true}', { status: 200 }); }) as unknown as typeof fetch;
  const r = await disconnectIntegration(db, db, { userId: "u", provider: "Slack", agentId: null }, { fetchImpl, env: () => undefined });
  assertEquals(r, { ok: true, revocations: [{ outcome: "revoked", detail: null }] });
  assertEquals(calls, ["https://slack.com/api/auth.revoke Bearer xoxb-mine"], "only this user's account-wide Slack token");
  assertEquals(tables.agent_integrations.map((x) => x.id), ["i2", "i3"], "the agent's own connection and other users' stay");
  assertEquals(tables.secret_events, [{ user_id: "u", kind: "provider_revocation", provider: "Slack", outcome: "revoked", detail: null }]);
});

Deno.test("disconnect: a provider that is down does not keep the integration alive; the failure is recorded", async () => {
  const tables: Record<string, Row[]> = { agent_integrations: [{ id: "i1", user_id: "u", provider: "Gmail", agent_id: null, credentials_secret_id: "s1" }] };
  const db = fakeDb(tables, { s1: { refresh_token: "1//r" } });
  const fetchImpl = (async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
  const r = await disconnectIntegration(db, db, { userId: "u", provider: "Gmail", agentId: null }, { fetchImpl, env: () => undefined });
  assertEquals(r.ok, true);
  assertEquals(tables.agent_integrations, []);
  assertEquals(tables.secret_events[0].outcome, "failed");
});
