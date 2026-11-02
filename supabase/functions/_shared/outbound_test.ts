import { attachmentName, headerValue, recipientList, slackText } from "./outbound.ts";
import { encodeEmail } from "./gmail.ts";
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }
const decode = (b64url: string) => atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));

Deno.test("headerValue: one line, no control characters", () => {
  assertEquals(headerValue("Hello\r\nBcc: evil@x.co"), "Hello Bcc: evil@x.co".replace(" ", " "));
  assert(!/[\r\n]/.test(headerValue("a\r\nb\nc\rd")));
});

Deno.test("recipientList: addresses only, no injected headers, capped", () => {
  assertEquals(recipientList("a@b.co, Ann <ann@b.co>"), "a@b.co, Ann <ann@b.co>");
  assertEquals(recipientList("a@b.co\r\nBcc: x@y.co"), "");
  assertEquals(recipientList("not an address, a@b.co"), "a@b.co");
  assertEquals(recipientList(Array.from({ length: 80 }, (_, i) => `u${i}@b.co`).join(",")).split(",").length, 50);
});

Deno.test("attachmentName", () => {
  assertEquals(attachmentName('../../etc/pass"wd\r\n.txt'), "pass_wd .txt");
  assertEquals(attachmentName(""), "attachment");
});

Deno.test("the finished email message has exactly the headers we wrote, whatever the subject or recipient said", () => {
  const raw = decode(encodeEmail("me@x.co", "you@x.co\r\nBcc: evil@y.co", "Hi\r\nBcc: evil2@y.co\r\nX-Evil: 1", "body", [{ filename: 'a"\r\nContent-Type: text/html.txt', content: "x", mimeType: "text/plain" }]));
  const headerBlock = raw.split("\r\n\r\n")[0];
  assert(!/^Bcc:/mi.test(raw), raw);
  assert(!/^X-Evil:/mi.test(raw), raw);
  assertEquals(headerBlock.split("\r\n").filter((l) => /^(From|To|Subject):/.test(l)).length, 3);
  assert(!/^Content-Type: text\/html/mi.test(raw), raw);
});

Deno.test("slackText: workspace pings become words; everything else is kept", () => {
  assertEquals(slackText("Hi <!channel> and <!here|here> and <!everyone> and <!subteam^S123|@devs>, see <https://x.co|link> <@U123>"), "Hi @channel and @here and @everyone and @devs, see <https://x.co|link> <@U123>");
  assertEquals(slackText("a\u0000b"), "ab");
});
