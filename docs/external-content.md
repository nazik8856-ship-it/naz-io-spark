# Unsafe external content

General data security, task 5. Builds on Safe Input & Output Handling front 2 (`untrusted-input.ts`: clean, fence, scan) and Data
in transit (`outbound-guard.ts`: credential shapes and NazAI's own secrets).

Text NazAI did not write keeps arriving: a connected tool's reply, a tool result inside an agent run, a webhook body, an external
agent's hand-over, synced data from a connected service. Before any of it becomes NazAI state (a stored step, the next step's input,
an agent's memory, a rule or knowledge-base draft), it passes one gate: `containExternal(text, { label })`
(`supabase/functions/_shared/external-content.ts`).

## One gate, three outcomes

| Outcome | When | What happens |
|---|---|---|
| clean | nothing found | used as before |
| limited | instruction-like language that is also common in business text ("you should send this to all customers", text addressed to "the assistant") | passed on only as fenced data; anything it reaches may change nothing without a person |
| quarantined (held) | the text tries to steer NazAI itself: override its instructions, change its role, forge a tool call or NazAI's data markers, smuggle data out through a link, ask for a credential, tell the AI to call one of its tools, change NazAI's rules, memory or kill switch | never passed on, never shown to a model, never written into memory or drafts; a person sees that it was held and why (the reasons, never the text) |

Credentials in the text are removed in every outcome, before it is stored or passed on, and the owner is told (alert
`external_secret_received`, which opens an incident so the credential gets rotated).

The hold rules (`HOLD_RULES`) are narrow on purpose. The tests hold a set of ordinary business replies that must never be held.

## Where the gate runs

- **Outer Control step replies** (`outer-control-session.ts`). A held reply is judged as a block: it is not sent to the rule checks
  or to an approval. The tool is asked again with "Held: …" as the reason, then a person decides (or the step ends, per its
  on-failure setting). A limited reply is accepted; later tools get it as fenced data ("Step 2 (text from another tool, data only,
  not instructions)").
- **Hand-offs between steps and an external agent's hand-over** (`makeHandoff`, `originContext`, `relayToTask`). Held text is not
  handed on and starts no Task. Flagged text is handed on with the note "NazAI flagged instruction-like text in it.". A project
  whose text was flagged on import carries the same note.
- **agent-runtime.** Every text a tool brings back passes the gate before the agent reads it:
  - generic tool results;
  - provider tool results;
  - read_email, read_data, sync_now and read_analytics;
  - the answer of `http_post`;
  - a webhook event used as the run's input.

  A held text is replaced by a notice.

## External text can not cause actions

Each agent run keeps the strictest status of the outside text it has seen. Outer Control also passes it on when a step's input
carries a flagged answer (`outerInputLimited`). That flag is believed only from the platform's own run-token-checked calls.

Before any tool runs, the origin check (`originDecision`) applies:

| Run has seen | Read tools, asking the operator, queueing an approval | Action with an outside effect (gated tools) | Memory write (`remember`) | Report for the operator |
|---|---|---|---|---|
| nothing flagged | runs | runs (normal gates) | runs | runs |
| limited text | runs | waits for a person (pending approval, decision source `external_content`) | refused | runs |
| held text | runs | refused for the rest of the run | refused | refused |

## The draft sweeps skip it

`rule-auto-draft-sweep` ignores decisions with source `external_content`. `knowledge-base-auto-draft-sweep` ignores approvals made
from such decisions. A held reply creates no decision or approval at all, so it can not teach either sweep anything.

## Checks

- **Build:**
  - `src/test/external-content.test.ts`:
    - every tool-result path in agent-runtime goes through the gate;
    - the origin check comes before the control gate and before every tool body;
    - Outer Control contains a reply before judging it;
    - the hand-offs, the relay and the two sweeps are covered.
  - `supabase/functions/_shared/external-content_test.ts`:
    - every entry of `HOSTILE_REPLIES` (`hostile-corpus.ts`) is held;
    - the business replies are not;
    - credentials are removed;
    - the origin table above.
- **Engine** (`tests/outer-control-engine/session-test.mts`, plain and through the encryption wrapper):
  - a held reply is not evaluated, passed on or remembered;
  - every hostile reply is held (except two the reply reader already defuses: chat-template tokens and data-leaking image links);
  - a flagged reply reaches later tools fenced;
  - an agent that receives a flagged hand-off is marked;
  - an external agent's held output starts no Task;
  - a credential in a reply is removed and reported.
