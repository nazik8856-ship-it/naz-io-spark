import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen } from "lucide-react";
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/client";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-zinc-300">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-cyan-400">{title}</h2>
      <div className="mt-2 text-sm text-zinc-300">{children}</div>
    </section>
  );
}

const EXAMPLE_CURL = `curl -X POST "${SUPABASE_FUNCTIONS_URL}/control-api/v1" \\
  -H "Authorization: Bearer nazai_sk_<your key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action_type": "send_email",
    "provider": "Gmail",
    "description": "Reply to a customer refund request.",
    "params": { "to": "customer@example.com" },
    "mode": "fast"
  }'`;

const EXAMPLE_RESPONSE = `{
  "api_version": "v1",
  "verdict": "allow",
  "reason": "No hard rule, safety match, spend cap, or circuit breaker stopped this action.",
  "decision_id": null,
  "gate_source": null,
  "mode": "fast"
}`;

const EXAMPLE_BATCH_CURL = `curl -X POST "${SUPABASE_FUNCTIONS_URL}/control-api/v1" \\
  -H "Authorization: Bearer nazai_sk_<your key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "actions": [
      { "action_type": "send_email", "provider": "Gmail", "description": "Reply to a refund request." },
      { "action_type": "post_public_content", "provider": "Slack", "description": "Post the weekly update." }
    ]
  }'`;

const EXAMPLE_SDK = `import { ControlApiClient } from "@nazai/control-api-client";

const client = new ControlApiClient({
  apiKey: process.env.NAZAI_API_KEY!, // nazai_sk_...
  baseUrl: "${SUPABASE_FUNCTIONS_URL}",
});

const verdict = await client.check({
  actionType: "send_email",
  provider: "Gmail",
  description: "Reply to a customer refund request.",
});

// Pull new decisions on your own schedule:
const page = await client.listDecisions({ since: "2026-08-01T00:00:00Z" });
for (const d of page.decisions) console.log(d.actionType, d.decision);`;

const EXAMPLE_EXPORT_RESPONSE = `{
  "api_version": "v1",
  "decisions": [
    { "id": "...", "decision": "ALLOW send_email (Gmail)", "reasoning": "...", "confidence_score": 91,
      "escalated": false, "source": "model", "agent_id": null, "action_type": "send_email",
      "provider": "Gmail", "policy_version": 3, "created_at": "2026-08-27T10:00:00Z" }
  ],
  "has_more": true,
  "next_cursor": "dxc1:MjAyNi0wOC0yN1QxMDowMDowMFp8YWJjLTEyMw=="
}`;

const EXAMPLE_BATCH_RESPONSE = `{
  "api_version": "v1",
  "batch": true,
  "count": 2,
  "results": [
    { "index": 0, "verdict": "allow", "reason": "...", "decision_id": null, "gate_source": null, "mode": "fast" },
    { "index": 1, "verdict": "block", "reason": "...", "decision_id": "...", "gate_source": "hard_rule", "mode": "fast" }
  ]
}`;

const EXAMPLE_CONTEXT_CURL = `curl -X POST "${SUPABASE_FUNCTIONS_URL}/api-keys/<key id>/context" \\
  -H "Authorization: Bearer <your NazAI login session>" \\
  -H "Content-Type: application/json" \\
  -d '{ "entry_text": "Refunds are processed within 5-7 business days. Support hours are 9am-5pm ET, Mon-Fri." }'`;

const EXAMPLE_PERSONA_CURL = `curl -X POST "${SUPABASE_FUNCTIONS_URL}/api-keys/<key id>/policy" \\
  -H "Authorization: Bearer <your NazAI login session>" \\
  -H "Content-Type: application/json" \\
  -d '{ "response_persona": "Warm, concise, first names, no corporate jargon." }'`;

const EXAMPLE_RESPOND_CURL = `curl -X POST "${SUPABASE_FUNCTIONS_URL}/control-api/v1/respond" \\
  -H "Authorization: Bearer nazai_sk_<your key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "How long do refunds take?",
    "conversation_history": [
      { "role": "user", "content": "Hi, I returned an item last week." },
      { "role": "assistant", "content": "Thanks for letting me know — happy to help with that." }
    ]
  }'`;

const EXAMPLE_RESPOND_RESPONSE = `{
  "api_version": "v1",
  "ok": true,
  "answer": "Refunds are processed within 5-7 business days once we receive the return.",
  "cost_usd": 0.000842,
  "confidence": "high"
}`;

/**
 * The "Outer NazAI" Control API's developer reference — how an external
 * platform submits one of its own proposed actions to NazAI's
 * decision-gating engine and gets back a verdict. Verdict-only: nothing
 * here lets a caller create, edit, or delete this account's own hard
 * rules, safety rules, spend caps, or approvals — policy management stays
 * exclusively inside the NazAI app.
 */
export default function ControlApiDocs() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-8 pb-16">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <BookOpen className="h-5 w-5 text-cyan-400" /> Control API
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Let an external platform or your own backend submit one of its own proposed actions and get back a
          real verdict from NazAI's decision-gating engine — the same hard rules, safety scanner, spend caps,
          kill switches, and (optionally) LLM-scored risk assessment your own agents already pass through.
          Verdict-only: a key can never create, edit, or delete your policy from outside — it only judges an
          action you tell it about.
        </p>
        <p className="mt-3 text-sm">
          Need a key first?{" "}
          <button onClick={() => navigate("/control-system/api-keys")} className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">
            Generate one on the API Keys page
          </button>
          .
        </p>

        <Section title="Authentication">
          <p>Send your key as a bearer token on every request:</p>
          <CodeBlock>{`Authorization: Bearer nazai_sk_<your key>`}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            Keys are shown once, at creation. If you lose one, revoke it and generate a new one — there is no
            way to retrieve a lost key.
          </p>
        </Section>

        <Section title="Endpoint">
          <CodeBlock>{`POST ${SUPABASE_FUNCTIONS_URL}/control-api/v1`}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            The unversioned <span className="font-mono">{`${SUPABASE_FUNCTIONS_URL}/control-api`}</span> URL
            still works today too — it's an alias for v1, the only version that exists right now. Use the
            versioned URL above for anything you're building for the long term.
          </p>
        </Section>

        <Section title="Versioning">
          <p>
            Every response includes an <span className="font-mono text-cyan-300">api_version</span> field so
            you always know which version answered. If NazAI ever needs to change this API in a way that would
            break existing integrations, that change ships as a new version (e.g. v2) at its own URL —{" "}
            <span className="font-mono">v1</span> keeps working exactly as documented here, unchanged. We won't
            silently change what v1 does out from under you.
          </p>
        </Section>

        <Section title="Request body">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 text-left text-zinc-500">
                <th className="py-1.5 pr-3 font-mono uppercase">Field</th>
                <th className="py-1.5 pr-3 font-mono uppercase">Type</th>
                <th className="py-1.5 font-mono uppercase">Description</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">action_type</td>
                <td className="py-1.5 pr-3 font-mono text-zinc-500">string (required)</td>
                <td className="py-1.5">What you're about to do, e.g. "send_email", "post_public_content".</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">provider</td>
                <td className="py-1.5 pr-3 font-mono text-zinc-500">string</td>
                <td className="py-1.5">Which system it targets, e.g. "Gmail". Defaults to "unknown".</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">description</td>
                <td className="py-1.5 pr-3 font-mono text-zinc-500">string (required)</td>
                <td className="py-1.5">Plain-language description of what this action does.</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">params</td>
                <td className="py-1.5 pr-3 font-mono text-zinc-500">object</td>
                <td className="py-1.5">The actual payload of the action — whatever it needs to run.</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-cyan-300">mode</td>
                <td className="py-1.5 pr-3 font-mono text-zinc-500">"fast" | "full"</td>
                <td className="py-1.5">See below. Defaults to "fast".</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="mode: fast vs full">
          <p>
            <span className="font-mono text-cyan-300">fast</span> (default) checks only the deterministic
            layer — hard rules, the safety scanner, your spend cap, kill switch, and circuit breakers. No LLM
            call, so it's cheap and fast. A clean pass returns <span className="font-mono">"allow"</span> with
            no further detail.
          </p>
          <p className="mt-2">
            <span className="font-mono text-cyan-300">full</span> also runs NazAI's LLM-scored intent, risk,
            and business-fit assessment — the same judgment your own agents get — and returns a confidence
            score and, when relevant, a suggested narrower modification. Costs more and takes longer; counts
            against your account's own daily AI spend cap.
          </p>
        </Section>

        <Section title="Response">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 text-left text-zinc-500">
                <th className="py-1.5 pr-3 font-mono uppercase">Field</th>
                <th className="py-1.5 font-mono uppercase">Meaning</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">api_version</td>
                <td className="py-1.5">Which version of this API answered — <span className="font-mono">"v1"</span> today, on every response.</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">verdict</td>
                <td className="py-1.5">
                  <span className="text-emerald-400">allow</span> — go ahead. <span className="text-amber-400">modify</span> — safer
                  as narrowed (see <span className="font-mono">modification</span> in full mode).{" "}
                  <span className="text-amber-400">deferred</span> — parked, doesn't fit right now.{" "}
                  <span className="text-rose-400">block</span> — don't do this.
                </td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">reason</td>
                <td className="py-1.5">Plain-language explanation of the verdict.</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-3 font-mono text-cyan-300">decision_id</td>
                <td className="py-1.5">Reference id for this decision in your NazAI account's audit trail, when one was logged.</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-mono text-cyan-300">confidence_score / modification</td>
                <td className="py-1.5">Only present in full mode.</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="Example">
          <CodeBlock>{EXAMPLE_CURL}</CodeBlock>
          <p className="mt-3">Response:</p>
          <CodeBlock>{EXAMPLE_RESPONSE}</CodeBlock>
        </Section>

        <Section title="Batch requests">
          <p>
            Have a lot of actions to check at once? Send an <span className="font-mono text-cyan-300">actions</span> array
            instead of a single action, and get back one verdict per action, in the same order — up to 50 actions per
            request, using the exact same checks and rate limit as calling this endpoint once per action.
          </p>
          <CodeBlock>{EXAMPLE_BATCH_CURL}</CodeBlock>
          <p className="mt-3">Response:</p>
          <CodeBlock>{EXAMPLE_BATCH_RESPONSE}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            If a batch runs into the rate limit partway through, the remaining actions come back marked
            <span className="font-mono"> "error": "rate_limited"</span> instead of each one spending its own request
            finding that out — just retry those from where the batch stopped.
          </p>
        </Section>

        <Section title="Exporting your decision history">
          <p>
            For your own reporting or monitoring tools to pull new decisions automatically — instead of a
            person re-downloading a file — use the same key against:
          </p>
          <CodeBlock>{`GET ${SUPABASE_FUNCTIONS_URL}/control-api/v1/decisions?since=2026-08-01T00:00:00Z&limit=100`}</CodeBlock>
          <p className="mt-2">
            Response comes back as a page of up to 500 decisions plus a <span className="font-mono text-cyan-300">next_cursor</span>.
            Keep calling with <span className="font-mono">?cursor=&lt;next_cursor&gt;</span> until{" "}
            <span className="font-mono">has_more</span> is <span className="font-mono">false</span>, then save the last cursor
            you got and resume from there next time — new decisions can't be skipped or double-counted between polls,
            even if more land while you're mid-page.
          </p>
          <CodeBlock>{EXAMPLE_EXPORT_RESPONSE}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            20 requests per minute per key — a separate budget from the verdict endpoint above, since export polling
            and per-action checks are different traffic shapes.
          </p>
        </Section>

        <Section title="Respond: a white-labeled answer for your own end users">
          <p>
            Everything above is for judging YOUR OWN proposed actions. This endpoint is different: hand it one
            of your end user's messages and NazAI drafts a grounded, on-tone answer for you to relay straight
            back to them — as if it were your own AI speaking. The response never mentions NazAI, an AI model,
            or any underlying vendor in any way — it's built to sit invisibly behind your own product.
          </p>
          <CodeBlock>{`POST ${SUPABASE_FUNCTIONS_URL}/control-api/v1/respond`}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">1. Give it the facts it should answer from</p>
          <p className="mt-1">
            NazAI never invents facts about your business — it only answers from context you provide, scoped to
            this one key so it can never leak into a different key's answers. Add as many entries as you need:
          </p>
          <CodeBlock>{EXAMPLE_CONTEXT_CURL}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">2. (Optional) Set a tone</p>
          <p className="mt-1">Tell it once how your assistant should sound — applied to every answer this key generates:</p>
          <CodeBlock>{EXAMPLE_PERSONA_CURL}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">3. Send the message</p>
          <CodeBlock>{EXAMPLE_RESPOND_CURL}</CodeBlock>
          <p className="mt-3">Response:</p>
          <CodeBlock>{EXAMPLE_RESPOND_RESPONSE}</CodeBlock>

          <p className="mt-3 text-xs text-zinc-500">
            If the context you've given doesn't cover the question, you get an honest{" "}
            <span className="font-mono">"I don't have enough information to answer that."</span> instead of a
            guess — every drafted answer is checked against your context in a second pass before it's ever
            returned. 20 requests per minute per key (this does real generation work, not a cheap read), and
            counts against your key's own daily AI spend cap, same budget as everything else on this API.
          </p>

          <p className="mt-4 font-semibold text-zinc-200">4. (Optional) Stream the answer</p>
          <p className="mt-1">
            Add <span className="font-mono text-cyan-300">"stream": true</span> to get the answer back as{" "}
            <span className="font-mono">text/event-stream</span> instead of one JSON object — useful for a chat
            UI that types the answer out. Note this streams the final, already fact-checked answer in small
            chunks for a typing effect; it doesn't reduce how long the full answer takes to compute, since the
            fact-check still needs the complete drafted answer before any of it is safe to send.
          </p>
          <CodeBlock>{`curl -N -X POST "${SUPABASE_FUNCTIONS_URL}/control-api/v1/respond" \\
  -H "Authorization: Bearer nazai_sk_<your key>" \\
  -H "Content-Type: application/json" \\
  -d '{ "message": "How long do refunds take?", "stream": true }'`}</CodeBlock>
          <p className="mt-2">Each event is a small JSON payload; the last one carries <span className="font-mono">done: true</span>:</p>
          <CodeBlock>{`data: {"delta":"Refunds are "}\n\ndata: {"delta":"processed within"}\n\n...\n\ndata: {"api_version":"v1","done":true}`}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">5. See which context entries backed the answer</p>
          <p className="mt-1">
            Whenever the answer is genuinely grounded in the context you provided, the response includes a{" "}
            <span className="font-mono text-cyan-300">sources</span> array — the id and a short excerpt of each
            context entry that was used. It's omitted (not sent as an empty array) whenever the fact-check
            replaced the draft with the honest "I don't have enough information" fallback, since nothing was
            actually used to produce that text.
          </p>
          <CodeBlock>{`{
  "api_version": "v1",
  "ok": true,
  "answer": "Refunds are processed within 5-7 business days once we receive the return.",
  "sources": [
    { "id": "3f9b...", "excerpt": "Refunds take 5-7 business days once the item is received." }
  ],
  "cost_usd": 0.000842,
  "confidence": "high"
}`}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">6. Cost and confidence, per call</p>
          <p className="mt-1">
            Every response also carries <span className="font-mono text-cyan-300">cost_usd</span> — the real,
            measured cost of the model calls this one request made (generation plus the fact-check pass) — and{" "}
            <span className="font-mono text-cyan-300">confidence</span>, either{" "}
            <span className="font-mono">"high"</span> (the fact-check passed) or{" "}
            <span className="font-mono">"low"</span> (it didn't, and you got the honest fallback instead). Both
            are reported even on a sandbox key, as an estimate of what a real call would have cost — a sandbox
            key never actually bills it against your spend cap.
          </p>
        </Section>

        <Section title="Drop-in chat widget">
          <p>
            Don't want to build a chat UI yourself? Add one script tag and you get a floating chat bubble that
            talks to your own key's configured context and persona — zero dependencies, no build step, and it
            never mentions NazAI or any underlying model in anything it renders.
          </p>
          <CodeBlock>{`<script src="${window.location.origin}/respond-widget.js"
  data-api-key="nazai_sk_<your key>"
  data-base-url="${SUPABASE_FUNCTIONS_URL}"
  data-title="Chat with us"
  data-greeting="Hi! How can I help?"
  async></script>`}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            Optional attributes: <span className="font-mono">data-position</span> ("right", default, or "left"),{" "}
            <span className="font-mono">data-accent-color</span> (any CSS color). It streams the answer (item 4
            above) into the bubble for a typing effect. Treat your API key the same way you would in any other
            client-side script — anyone who can view your page source can read it, so use a key scoped to this
            one integration and keep its rate limit and spend cap sized for public traffic.
          </p>
        </Section>

        <Section title="Content gaps: see what your context doesn't cover yet">
          <p>
            Every real <span className="font-mono">/respond</span> call where the fact-check declined to answer
            (an honest "I don't have enough information" rather than a guess) is, by definition, a question your
            configured context doesn't cover. This endpoint lists those questions so you know exactly what to add
            via <span className="font-mono">POST /api-keys/:id/context</span> — no guessing.
          </p>
          <CodeBlock>{`GET ${SUPABASE_FUNCTIONS_URL}/control-api/v1/content-gaps`}</CodeBlock>
          <CodeBlock>{`curl "${SUPABASE_FUNCTIONS_URL}/control-api/v1/content-gaps" \\
  -H "Authorization: Bearer nazai_sk_<your key>"`}</CodeBlock>
          <CodeBlock>{`{
  "api_version": "v1",
  "gaps": [
    { "id": "8a1c...", "message": "Do you ship to Canada?", "created_at": "2026-09-05T10:00:00Z" }
  ],
  "has_more": false,
  "next_cursor": null
}`}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            Keyset-paginated with <span className="font-mono">limit</span> (default 100, max 500) and{" "}
            <span className="font-mono">cursor</span> query params — pass the previous page's{" "}
            <span className="font-mono">next_cursor</span> to fetch the next one. Sandbox (test-mode) traffic is
            never included, since it isn't a real gap in your live product.
          </p>
        </Section>

        <Section title="Response caching">
          <p>
            A genuinely grounded answer is cached for 24 hours, scoped to this one key. Ask the exact same
            question again (or a near-verbatim rephrasing) within that window and you get the cached answer
            back instantly — no model call, no cost, and <span className="font-mono">cost_usd</span> reports{" "}
            <span className="font-mono">0</span>. The response includes{" "}
            <span className="font-mono text-cyan-300">"cached": true</span> so you can tell the difference.
            An honest "I don't have enough information" fallback is never cached — every real occurrence of an
            unanswered question still shows up in content gaps and fires the escalation webhook above, exactly
            as if caching didn't exist.
          </p>
        </Section>

        <Section title="TypeScript SDK">
          <p>
            Prefer not to hand-write the HTTP request? A small, hand-crafted{" "}
            <span className="font-mono text-cyan-300">@nazai/control-api-client</span> package (in this
            repository's <span className="font-mono">sdk/control-api-client</span> directory) handles the
            authorization header and both verdict modes for you:
          </p>
          <CodeBlock>{EXAMPLE_SDK}</CodeBlock>
        </Section>

        <Section title="Rate limits">
          <p>Up to 30 requests per minute per key. Requests from an unrecognized key are throttled per source IP before authentication is even checked.</p>
        </Section>

        <Section title="What this API can't do">
          <p>
            A key only ever gets a verdict back. It cannot create, edit, or delete your hard rules, safety
            rules, spend caps, or approvals — every policy change happens inside the NazAI app itself, by a
            signed-in human.
          </p>
        </Section>
      </main>
    </div>
  );
}
