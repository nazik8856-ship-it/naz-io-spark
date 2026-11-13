import { describeNetworkFailure, networkFailureKind } from "./network-failure.ts";
import { nazaiAddressProblem, NAZAI_ADDRESS_HELP } from "./outer-control-address.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

Deno.test("a failed connection is told apart: dns, certificate, refused, cut off, timeout", () => {
  const e = (m: string, cause?: string) => Object.assign(new TypeError(m), cause ? { cause: new Error(cause) } : {});
  assertEquals(networkFailureKind(e("client error (Connect): dns error: failed to lookup address information")), "dns");
  assertEquals(networkFailureKind(e("error sending request", "invalid peer certificate: UnknownIssuer")), "tls");
  assertEquals(networkFailureKind(e("tcp connect error: Connection refused (os error 111)")), "refused");
  assertEquals(networkFailureKind(Object.assign(new Error("t"), { name: "TimeoutError" })), "timeout");
  assertEquals(describeNetworkFailure("tls").retry, false);
});

Deno.test("NazAI's own address is not an outside tool", () => {
  assertEquals(nazaiAddressProblem("https://x.supabase.co/functions/v1/a", "x.supabase.co"), NAZAI_ADDRESS_HELP);
  assertEquals(nazaiAddressProblem("https://www.nazai.net/a", null), NAZAI_ADDRESS_HELP);
  assertEquals(nazaiAddressProblem("https://api.openai.com/v1", "x.supabase.co"), null);
});
