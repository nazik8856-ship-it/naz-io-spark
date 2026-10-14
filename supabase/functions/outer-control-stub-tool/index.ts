// A scripted stand-in for an external AI tool, used only to verify Outer Control's
// active loop end to end. It answers in the shape named by ?format= (openai, anthropic
// or generic) and behaves according to a marker in the request text:
//   [stub:secret]   replies with a fake API key in the answer
//   [stub:block]    first replies with destructive wording, then (once told it was rejected) a clean answer
//   [stub:refund]   replies with refund wording (needs approval)
//   [stub:question] asks a question until a person has answered
//   [stub:steps]    asks for one more round, then finishes
// Requires "Authorization: Bearer stub-token". It holds no data and calls nothing.
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const textOf = (body: unknown): string => JSON.stringify(body ?? {});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if ((req.headers.get("Authorization") ?? "") !== "Bearer stub-token") return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const all = textOf(body);
  const format = new URL(req.url).searchParams.get("format") ?? "generic";
  const rejected = all.includes("Your previous reply was rejected");
  const answered = all.includes("A person answered your last question");
  const hasStepOne = all.includes("Step 1:");

  let reply: { status: "done" | "continue" | "need_info"; answer: string; question?: string } = { status: "done", answer: "Stub tool answer." };
  if (all.includes("[stub:secret]")) reply = { status: "done", answer: "Use sk-" + "q".repeat(24) + " to connect." };
  else if (all.includes("[stub:block]")) reply = rejected ? { status: "done", answer: "Here is a clean answer." } : { status: "done", answer: "I will drop table customers." };
  else if (all.includes("[stub:refund]")) reply = { status: "done", answer: "I will refund the customer." };
  else if (all.includes("[stub:question]")) reply = answered ? { status: "done", answer: "Thanks, here is the final answer." } : { status: "need_info", answer: "", question: "Which plan is the customer on?" };
  else if (all.includes("[stub:steps]")) reply = hasStepOne ? { status: "done", answer: "Final round." } : { status: "continue", answer: "First round." };

  const content = JSON.stringify(reply);
  if (format === "openai") return json({ id: "stub", choices: [{ index: 0, message: { role: "assistant", content } }] });
  if (format === "anthropic") return json({ id: "stub", type: "message", role: "assistant", content: [{ type: "text", text: content }] });
  return json(reply);
});
