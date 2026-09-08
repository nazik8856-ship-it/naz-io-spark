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

const EXAMPLE_RESPONSE_RULE_CURL = `curl -X POST "${SUPABASE_FUNCTIONS_URL}/api-keys/<key id>/response-rules" \\
  -H "Authorization: Bearer <your NazAI login session>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "trigger_phrase": "cancel",
    "match_type": "contains_phrase",
    "answer_text": "You can cancel any time from Settings > Billing. Youll keep access until the end of your current period."
  }'`;

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
  "cost_usd": 0,
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
            of your end user's messages and NazAI answers it from the facts you've configured, for you to relay
            straight back to them — as if it were your own AI speaking. There's no generative model in this
            path at all: the answer is assembled directly from the context entries you wrote yourself, so it's
            structurally incapable of inventing a fact, and it never mentions NazAI, an AI model, or any
            underlying vendor in any way — it's built to sit invisibly behind your own product.
          </p>
          <CodeBlock>{`POST ${SUPABASE_FUNCTIONS_URL}/control-api/v1/respond`}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">1. Give it the facts it should answer from</p>
          <p className="mt-1">
            NazAI never invents facts about your business — it only answers from context you provide, scoped to
            this one key so it can never leak into a different key's answers. Add as many entries as you need.
            Each answer is built directly from the entry (or entries) that best match the incoming question, so
            write them the way you'd want the answer to actually read:
          </p>
          <CodeBlock>{EXAMPLE_CONTEXT_CURL}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">1b. (Optional) Guarantee an exact answer with a rule</p>
          <p className="mt-1">
            Context entries are matched by similarity — the best available match wins, but which entry that is
            can shift as you add more. For a question you want answered with the SAME exact wording every time
            (cancellation policy, a legal disclaimer, a specific escalation path), add a rule instead. Rules are
            checked first, before context — a match returns its answer exactly as written, never stitched with
            anything else, and always wins even over a cached answer from before the rule existed.
          </p>
          <CodeBlock>{EXAMPLE_RESPONSE_RULE_CURL}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            <span className="font-mono">match_type</span> is either <span className="font-mono">"contains_phrase"</span> (fires
            whenever the phrase appears anywhere in the message — the default) or{" "}
            <span className="font-mono">"exact_phrase"</span> (the entire message must equal the phrase, for one specific
            known question). Both are matched case- and whitespace-insensitively. When several rules would
            match, the oldest one you added wins — order them from most to least specific if that matters.
            Adding a rule (or a context entry) whose text overlaps one already on the key gets back an extra{" "}
            <span className="font-mono">possible_conflicts</span> array in the response — a heads-up that the two
            might disagree, worth a glance, never a block on creating either one.
          </p>

          <p className="mt-4 font-semibold text-zinc-200">2. (Optional) Customize the "I don't know" message</p>
          <p className="mt-1">
            By default, a question your context doesn't cover gets back{" "}
            <span className="font-mono">"I don't have enough information to answer that."</span> Override it with
            your own wording — e.g. pointing to a support inbox — using the same endpoint:
          </p>
          <CodeBlock>{`curl -X POST "${SUPABASE_FUNCTIONS_URL}/api-keys/<key id>/policy" \\
  -H "Authorization: Bearer <your NazAI login session>" \\
  -H "Content-Type: application/json" \\
  -d '{ "fallback_message": "Sorry, I cant help with that -- please email support@acme.com." }'`}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">3. Send the message</p>
          <CodeBlock>{EXAMPLE_RESPOND_CURL}</CodeBlock>
          <p className="mt-3">Response:</p>
          <CodeBlock>{EXAMPLE_RESPOND_RESPONSE}</CodeBlock>

          <p className="mt-3 text-xs text-zinc-500">
            If no rule matches and none of your context entries do either, you get an honest{" "}
            <span className="font-mono">"I don't have enough information to answer that."</span> instead of a
            guess — with no generative model in the path, there's nothing left that could produce a plausible-
            sounding wrong answer. 20 requests per minute per key. There's no model call to meter, so this never
            counts against your key's AI spend cap — <span className="font-mono">cost_usd</span> is always{" "}
            <span className="font-mono">0</span>.
          </p>

          <p className="mt-4 font-semibold text-zinc-200">4. (Optional) Stream the answer</p>
          <p className="mt-1">
            Add <span className="font-mono text-cyan-300">"stream": true</span> to get the answer back as{" "}
            <span className="font-mono">text/event-stream</span> instead of one JSON object — useful for a chat
            UI that types the answer out. This streams the final assembled answer in small chunks purely for a
            typing effect; the underlying lookup is fast enough already that streaming buys presentation, not speed.
          </p>
          <CodeBlock>{`curl -N -X POST "${SUPABASE_FUNCTIONS_URL}/control-api/v1/respond" \\
  -H "Authorization: Bearer nazai_sk_<your key>" \\
  -H "Content-Type: application/json" \\
  -d '{ "message": "How long do refunds take?", "stream": true }'`}</CodeBlock>
          <p className="mt-2">Each event is a small JSON payload; the last one carries <span className="font-mono">done: true</span>:</p>
          <CodeBlock>{`data: {"delta":"Refunds are "}\n\ndata: {"delta":"processed within"}\n\n...\n\ndata: {"api_version":"v1","done":true}`}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">5. See which context entries backed the answer</p>
          <p className="mt-1">
            Whenever the answer is genuinely built from context you provided, the response includes a{" "}
            <span className="font-mono text-cyan-300">sources</span> array — the id and a short excerpt of each
            context entry that was actually used. It's omitted (not sent as an empty array) both when no entry
            matched (the honest "I don't have enough information" fallback) and when a rule answered instead —
            a rule's answer is your own fixed text, not something built from context, so there's nothing to cite.
          </p>
          <CodeBlock>{`{
  "api_version": "v1",
  "ok": true,
  "answer": "Refunds are processed within 5-7 business days once we receive the return.",
  "sources": [
    { "id": "3f9b...", "excerpt": "Refunds take 5-7 business days once the item is received." }
  ],
  "cost_usd": 0,
  "confidence": "high"
}`}</CodeBlock>

          <p className="mt-4 font-semibold text-zinc-200">6. Cost and confidence, per call</p>
          <p className="mt-1">
            Every response also carries <span className="font-mono text-cyan-300">cost_usd</span> — always{" "}
            <span className="font-mono">0</span>, since there's no model call left to meter — and{" "}
            <span className="font-mono text-cyan-300">confidence</span>, either{" "}
            <span className="font-mono">"high"</span> (a context entry matched the question) or{" "}
            <span className="font-mono">"low"</span> (nothing did, and you got the honest fallback instead).
          </p>
        </Section>

        <Section title="Drop-in chat widget">
          <p>
            Don't want to build a chat UI yourself? Add one script tag and you get a floating chat bubble that
            talks to your own key's configured context — zero dependencies, no build step, and it never
            mentions NazAI or any underlying model in anything it renders.
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
            Every real <span className="font-mono">/respond</span> call where no rule or context entry matched the
            question (an honest "I don't have enough information" rather than a guess) is, by definition, a
            question your configuration doesn't cover. This endpoint lists those questions so you know exactly
            what to add — a context entry via <span className="font-mono">POST /api-keys/:id/context</span> for a
            general fact, or a rule via <span className="font-mono">POST /api-keys/:id/response-rules</span> for a
            recurring, FAQ-shaped one that deserves a guaranteed exact answer — no guessing.
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
            never included, since it isn't a real gap in your live product. Once you add a context entry or a
            rule that covers a gap, a background sweep notices within about 30 minutes and it drops out of this
            feed automatically — no need to track which ones you've already fixed.
          </p>
        </Section>

        <Section title="Content gap clusters: the same question asked a dozen ways">
          <p>
            The raw feed above lists every OCCURRENCE of an unanswered question — "How long for a refund?",
            "when will I get refunded", "refund timeline?" show up as three separate rows even though they're
            really the same missing fact. This endpoint groups them and ranks the groups by how often the
            underlying question has actually come up, so you see one prioritized to-do item instead of dozens
            of near-duplicate rows.
          </p>
          <CodeBlock>{`GET ${SUPABASE_FUNCTIONS_URL}/control-api/v1/content-gap-clusters`}</CodeBlock>
          <CodeBlock>{`curl "${SUPABASE_FUNCTIONS_URL}/control-api/v1/content-gap-clusters" \\
  -H "Authorization: Bearer nazai_sk_<your key>"`}</CodeBlock>
          <CodeBlock>{`{
  "api_version": "v1",
  "clusters": [
    {
      "id": "c1a2...",
      "representative_message": "How long for a refund?",
      "occurrence_count": 47,
      "first_seen_at": "2026-08-01T09:00:00Z",
      "last_seen_at": "2026-09-06T14:30:00Z"
    }
  ]
}`}</CodeBlock>
          <p className="mt-2 text-xs text-zinc-500">
            <span className="font-mono">representative_message</span> is simply the first question that started
            the group — a label, not something curated. Sorted by{" "}
            <span className="font-mono">occurrence_count</span> descending, so the most-asked unanswered question
            is always first. A cluster stops appearing the moment every one of its occurrences has been
            auto-resolved — nothing to clean up on your end.
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
