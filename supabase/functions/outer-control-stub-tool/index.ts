// A scripted stand-in for an external AI tool, used only to verify Outer Control's
// active loop end to end. It answers in the shape named by ?format= (openai, anthropic
// or generic) and behaves according to a marker in the request text:
//   [stub:secret]   replies with a fake API key in the answer
//   [stub:block]    first replies with destructive wording, then (once told it was rejected) a clean answer
//   [stub:refund]   replies with refund wording (needs approval)
//   [stub:question] asks a question until a person has answered
//   [stub:steps]    asks for one more round, then finishes
//   [stub:down]     always answers HTTP 503
//   [stub:alwaysblock] always replies with destructive wording, unless a person's note is in the request
//   [stub:empty]    first replies with nothing, then (once told it was empty) a clean answer
//   [stub:codeword] asks which "zzplanzz", then (once a person answered) mentions "zzplanzz" again
//   [stub:quote]    replies with the text "zzquote" (for a rule that needs approval)
//   [stub:offtopic] first replies about the weather, then (once told it missed the goal) about returns for premium customers
//   [stub:alwaysoff] always replies about the weather
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

  if (all.includes("[stub:down]")) return json({ error: "unavailable" }, 503);
  const wasEmpty = all.includes("Your previous reply was empty");

  let reply: { status: "done" | "continue" | "need_info"; answer: string; question?: string } = { status: "done", answer: "Stub tool answer." };
  if (all.includes("[stub:secret]")) reply = { status: "done", answer: "Use sk-" + "q".repeat(24) + " to connect." };
  else if (all.includes("[stub:block]")) reply = rejected ? { status: "done", answer: "Here is a clean answer." } : { status: "done", answer: "I will drop table customers." };
  else if (all.includes("[stub:alwaysblock]")) reply = answered ? { status: "done", answer: "Only the public policy: refunds within 30 days." } : { status: "done", answer: "I will drop table customers." };
  else if (all.includes("[stub:empty]")) reply = wasEmpty ? { status: "done", answer: "Now with content." } : { status: "done", answer: "   " };
  else if (all.includes("[stub:codeword]")) reply = answered ? { status: "done", answer: "Thanks, the zzplanzz is noted." } : { status: "need_info", answer: "", question: "Which zzplanzz is the customer on?" };
  else if (all.includes("[stub:quote]")) reply = { status: "done", answer: "Our zzquote is final today for the customer." };
  else if (all.includes("[stub:offtopic]")) reply = all.includes("does not match the goal")
    ? { status: "done", answer: "Premium customers can return items within thirty days of purchase, no questions asked." }
    : { status: "done", answer: "The weather tomorrow will be sunny with light winds across the whole region, so plan accordingly for the outdoors." };
  else if (all.includes("[stub:alwaysoff]")) reply = { status: "done", answer: "The weather tomorrow will be sunny with light winds across the whole region, so plan accordingly for the outdoors." };
  else if (all.includes("[stub:refund]")) reply = { status: "done", answer: "I will refund the customer." };
  else if (all.includes("[stub:question]")) reply = answered ? { status: "done", answer: "Thanks, here is the final answer." } : { status: "need_info", answer: "", question: "Which plan is the customer on?" };
  else if (all.includes("[stub:steps]")) reply = hasStepOne ? { status: "done", answer: "Final round." } : { status: "continue", answer: "First round." };

  const content = JSON.stringify(reply);
  if (format === "openai") return json({ id: "stub", choices: [{ index: 0, message: { role: "assistant", content } }] });
  if (format === "anthropic") return json({ id: "stub", type: "message", role: "assistant", content: [{ type: "text", text: content }] });
  return json(reply);
});
