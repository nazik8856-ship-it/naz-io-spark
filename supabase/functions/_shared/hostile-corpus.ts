// Safe input & output handling, front 6: one set of hostile requests, used two ways.
//   - by tests: every case goes through the shared request reader (input.ts) and must be refused or harmlessly cleaned
//   - by hostile-probe-sweep: every case is sent to every public and API-key function on the LIVE project once a day, and anything other
//     than a calm refusal (a 500, a time-out, a 2xx for a request that must be refused, a stack trace or a secret in the answer) opens
//     a platform incident
// The cases are built so that none of them can start paid work: each is malformed, oversized or of the wrong type, so a function refuses
// it before it calls a model, sends an email or writes a row.

export type HostileCase = {
  name: string;
  /** The exact body sent (string, so NUL bytes and broken JSON can be sent as-is). */
  body: string;
  /** True when every function must refuse it (any 4xx); false when a harmless 2xx is acceptable (the reader cleans it). */
  mustRefuse: boolean;
  /** The status a function that reads the body itself must answer (413 / 400); auth and rate-limit refusals are also accepted. */
  readerStatus: 400 | 413 | null;
};

const big = (n: number) => "x".repeat(n);

export const HOSTILE_CASES: HostileCase[] = [
  { name: "not json", body: "{nope", mustRefuse: true, readerStatus: 400 },
  { name: "json list", body: "[1,2,3]", mustRefuse: true, readerStatus: 400 },
  { name: "json string", body: '"text"', mustRefuse: true, readerStatus: 400 },
  { name: "cut off", body: '{"prompt":', mustRefuse: true, readerStatus: 400 },
  { name: "deep nesting", body: `{"a":${"[".repeat(5000)}${"]".repeat(5000)}}`, mustRefuse: true, readerStatus: 400 },
  { name: "oversize", body: JSON.stringify({ prompt: big(300 * 1024) }), mustRefuse: true, readerStatus: 413 },
  { name: "10,000-item list", body: JSON.stringify({ items: new Array(10_000).fill(0) }), mustRefuse: true, readerStatus: 400 },
  { name: "5,000 keys", body: JSON.stringify(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, 0]))), mustRefuse: true, readerStatus: 400 },
  { name: "wrong types", body: JSON.stringify({ prompt: 5, messages: "x", email: 7, websiteId: true, fields: "x", token: [], templateName: {}, agent_id: 9 }), mustRefuse: false, readerStatus: null },
  { name: "NUL and control characters", body: '{"prompt":5,"name":"a\\u0000b\\u202Ec","email":"x\\u0000@y","token":"\\u0000"}', mustRefuse: false, readerStatus: null },
  { name: "prototype keys", body: '{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}},"prompt":5}', mustRefuse: false, readerStatus: null },
  { name: "header injection", body: JSON.stringify({ email: "a@b.co\r\nBcc: probe@example.invalid", recipientEmail: "a@b.co\r\nBcc: probe@example.invalid", templateName: "x\r\nX-Probe: 1", name: "x" }), mustRefuse: false, readerStatus: null },
  { name: "filter injection", body: JSON.stringify({ agent_id: "x,user_id.neq.0", account_id: "x,user_id.neq.0", websiteId: "x,user_id.neq.0", sectionKind: "contact", fields: { a: "b" } }), mustRefuse: false, readerStatus: null },
];

export type ProbeResult = { fn: string; case: string; status: number | null; ms: number; problem: string | null };

// A stack trace or a secret in an answer is a leak whatever the status.
const STACK = /\n\s+at\s+\S+\s*\(?(?:file:|https?:|\/)[^\n]*:\d+:\d+|\bat\s+\S+\s+\(file:\/\//;
const SECRET = /(sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|service_role|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

/** What was wrong with one answer, or null when it was a calm refusal (or a harmless answer to a case that allows one). */
export function judge(c: HostileCase, status: number | null, body: string, ms: number, timeoutMs: number): string | null {
  if (status === null) return ms >= timeoutMs ? "no answer within the time limit" : "the request failed (network)";
  if (status >= 500) return `answered ${status}`;
  if (STACK.test(body)) return "the answer contains a stack trace";
  if (SECRET.test(body)) return "the answer contains something that looks like a key or token";
  if (c.mustRefuse && status >= 200 && status < 300) return `accepted a request it must refuse (${status})`;
  return null;
}

/** The 95th percentile of a list of durations. */
export function p95(ms: number[]): number {
  if (!ms.length) return 0;
  const s = [...ms].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}
