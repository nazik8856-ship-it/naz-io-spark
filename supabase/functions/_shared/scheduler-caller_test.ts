// Run with: deno test supabase/functions/_shared/scheduler-caller_test.ts
import { resolveSchedulerCaller } from "./scheduler-caller.ts";
function assertEquals<T>(a: T, b: T) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const KEY = "service-role-key-123";
Deno.test("no scheduler header: an ordinary request, handled by the normal login or webhook checks", () => {
  assertEquals(resolveSchedulerCaller("Bearer user-jwt", "", KEY), { kind: "none" });
  assertEquals(resolveSchedulerCaller("", "   ", KEY), { kind: "none" });
});
Deno.test("the platform (service role key) may name the user it runs for", () => {
  assertEquals(resolveSchedulerCaller(`Bearer ${KEY}`, "user-1", KEY), { kind: "platform", userId: "user-1" });
});
Deno.test("anyone else naming a user is a forgery: no key, a user token, the anon key, a near-miss, or an empty server key", () => {
  for (const auth of ["", "Bearer user-jwt", "Bearer anon-key", `Bearer ${KEY}x`, KEY, `bearer ${KEY}`]) {
    assertEquals(resolveSchedulerCaller(auth, "victim-user", KEY), { kind: "forged" });
  }
  assertEquals(resolveSchedulerCaller("Bearer ", "victim-user", ""), { kind: "forged" });
});
