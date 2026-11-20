// Run with: deno test --no-check supabase/functions/_shared/inner-chat-task_test.ts
// Inner Control chat runs tasks (Day 1, #159): which actions, which built-in tools, and what it costs before anything starts.
import { INNER_TASK_KINDS, isInnerTaskKind, requestProblem, taskOffer, toolsForKind, workRequestKind, pastedTextToCheck } from "./inner-chat-task.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const STARTER = [{ id: "w", name: "NazAI Writer" }, { id: "a", name: "NazAI Analyst" }, { id: "r", name: "NazAI Reviewer" }];

Deno.test("only actions that need no styles, roles or audiences and fit three tools", () => {
  for (const k of ["rewrite", "roles", "adapt", "multistep", "delegate", "alternatives"]) assert(!isInnerTaskKind(k), k);
  for (const k of INNER_TASK_KINDS) assert(toolsForKind(k, STARTER).length >= 1, k);
  assert(!isInnerTaskKind("anything") && !isInnerTaskKind(undefined), "unknown kinds are refused");
});

Deno.test("as many built-in tools as the action takes: three for opinions, two for a draft, one to explain", () => {
  assert(toolsForKind("opinions", STARTER).map((t) => t.id).join() === "w,a,r", "opinions");
  assert(toolsForKind("draft", STARTER).length === 2, "draft");
  assert(toolsForKind("explain", STARTER).length === 1, "explain");
  assert(toolsForKind("compare", STARTER.slice(0, 1)).length === 0, "compare needs two: none when only one exists");
});

Deno.test("the request: at least a sentence, at most the action's limit", () => {
  assert(requestProblem("opinions", "hi") !== null, "too short");
  assert(requestProblem("opinions", "x".repeat(601))!.includes("600"), "too long");
  assert(requestProblem("opinions", "Should we open on Sundays?") === null, "fine");
});

Deno.test("the offer says what runs, with which tools, and what it costs: free first, then the action's credits", () => {
  const free = taskOffer({ kind: "opinions", request: " Should we open on Sundays? ", tools: STARTER, freeUsed: 1, freeTasks: 2 });
  assert(free.credits === 0 && free.free_left === 1 && free.request === "Should we open on Sundays?", JSON.stringify(free));
  assert(free.line === "Get multiple opinions with NazAI Writer, NazAI Analyst and NazAI Reviewer, every answer checked against your rules. Free (1 of 2 free NazAI tasks left).", free.line);
  const paid = taskOffer({ kind: "explain", request: "What is churn?", tools: STARTER.slice(0, 1), freeUsed: 2, freeTasks: 2 });
  assert(paid.credits === 1 && paid.free_left === 0 && /Uses 1 credit, given back if no result comes\.$/.test(paid.line), paid.line);
});

Deno.test("a plain request for work is recognised (the chat's safety net); rules, agent actions and questions are not", () => {
  const cases: [string, string | null][] = [
    ["Draft a polite reply to a customer asking for a refund", "draft"],
    ["Can you write a short welcome email for new clients?", "draft"],
    ["please research the best CRM for a 5-person team", "research"],
    ["Compare Stripe and Paddle for a small SaaS", "compare"],
    ["Summarize this: our Q3 sales rose 12%...", "keypoints"],
    ["Fact-check: the Eiffel Tower is 330 m tall", "factcheck"],
    ["Write a rule that blocks emails on Sunday", null],          // a rule: draft_rule
    ["My agent wants to post to #general", null],                  // an action review
    ["Explain my rule \"Bulk product price changes\"", null],      // a question about the Control System
    ["What did my AI do yesterday?", null],
    ["", null],
  ];
  for (const [m, want] of cases) assert(workRequestKind(m) === want, `${m} -> ${workRequestKind(m)}, want ${want}`);
});

Deno.test("text pasted on its own is text to check (the core loop), and other messages are not", () => {
  const checked: [string, string | null][] = [
    ["Your order will arrive by Friday, guaranteed.", "Your order will arrive by Friday, guaranteed."],
    ["\"We can refund you in full, no questions asked.\"", "We can refund you in full, no questions asked."],
    ["Check this: Our price is $49 and it ships tomorrow.", "Our price is $49 and it ships tomorrow."],
    ["Is this ok?\nHi Sam, your account key is below. Let me know if anything breaks!", "Hi Sam, your account key is below. Let me know if anything breaks!"],
    ["Thanks for waiting. Can I help with anything else?", "Thanks for waiting. Can I help with anything else?"],
  ];
  for (const [m, want] of checked) assert(pastedTextToCheck(m) === want, `${m} -> ${pastedTextToCheck(m)}`);
  for (const m of [
    "What rules do I have?", "How does shadow mode work?", "hello there friend", "Thanks a lot for that",
    "Draft a polite reply to a customer asking for a refund", "Never let my AI mention prices", "my agent wants to email all customers",
    "Show me today's decisions", "ok", "The capital of France?", "Add a rule about refunds please",
  ]) assert(pastedTextToCheck(m) === null, `${m} should not be checked, got ${pastedTextToCheck(m)}`);
});
