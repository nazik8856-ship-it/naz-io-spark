
# What's actually blocking successful agent execution

I checked the runtime, scheduler, cron, gateway logs, `agent_runs`, `agent_events`, `agent_integrations`, and `integration_snapshots`. Here's the truth on the ground.

## What already works

- pg_cron `nazai-agent-scheduler` is active, firing every minute.
- `agent-runtime` boots fine, the AI gateway calls are all HTTP 200 (Gemini flash / pro).
- Recent `agent_runs` are `status = completed` with rich "Delivered:" summaries.
- Migrations for `agent_reports`, `webhook_secret`, `agent_memory`, `business_profiles`, scheduled runs — all in place.
- Widgets `execution_flow` / `artifacts_panel` render.

So the pipeline runs end-to-end. The problem is that "completed" here means "the LLM narrated a completion", not "real work happened in the real world."

## The real blockers (ranked)

### 1. Integrations are fake — this is the #1 blocker
`agent_integrations.metadata` for every "connected" row literally says:
`"note": "Stored. Live verification not available for this provider yet."`
`integration_snapshots` are AI-hallucinated (`mailbox: "@plums"`, `unread: 3`) — never fetched from Gmail/Stripe/Shopify. Result: the agent reasons over fabricated numbers, so any "insight" or action is baseless. Stripe row is `status: error`.

Until at least one provider returns real data, no run is truly "successful" no matter what the summary says.

### 2. Approval queue is write-only
`agent_events` has **44 `pending_approval` rows and 0 `approval_granted`/`approval_rejected`**. `send_email`, `http_post`, and `request_approval` all queue by design, but nothing consumes the queue: no approve/reject UI, no runtime handler that, on approval, actually calls `send-transactional-email` or fires the webhook. So every external action the agent "delivers" is stuck forever.

### 3. `send_email` guardrail defaults to approval-required
For every agent the compiler emits at least one guardrail matching `email|send|external`, so `send_email` never sends on the first pass. Combined with #2 → zero emails ever leave.

### 4. `http_post` allow-list is empty by default
As previously flagged, `WEBHOOK_DOMAIN_ALLOWLIST` env var is unset. `http_post` only works to the agent's own `webhook_url`. Every other target 403s.

### 5. `send-transactional-email` sender / domain not confirmed
Resend needs a verified `from` domain. If it's not set for the current project, `send_email` will fail with a Resend 4xx even after approval is wired.

### 6. Clarification loop can strand a run
`agent_runs.status = 'paused'` rows exist (e.g. `39891e33…`). If the operator never answers, the agent never runs again on that schedule because the next tick sees an unresolved `clarification_request` and skips.

## Fix plan (minimum path to a real end-to-end run)

Do in this order. Steps 1–3 unblock 90% of "real execution".

### Step 1 — Wire the approval queue (backend + minimal UI)
- New edge function `agent-approval` with actions `approve` / `reject`, JWT-verified, scoped by `user_id`.
- On `approve`, look up the original `pending_approval` event's `payload.action` and dispatch:
  - `send_email` → call `send-transactional-email` with the queued `to/subject/body`.
  - `http_post` → run the existing `validateHttpPostUrl` + fetch (bypass the "queue by default" branch since this IS the approval).
  - generic `request_approval` → just log `approval_granted` so the agent can resume.
- Emit `approval_granted` / `approval_rejected` events with `result_ref` (email id / http status / snapshot).
- Add a tiny "Approvals" list to `AgentEmployeePanel` (already has the approvals section stub) with Approve / Reject buttons calling the new function. No design changes.

### Step 2 — Make at least one integration return real data
Two options, pick one this pass (I recommend A, cheapest, most useful):
- **A.** Real Gmail via the existing Google OAuth: `integration-sync` reads `access_token` from `agent_integrations` and calls `gmail.users.messages.list?q=is:unread` to fill the snapshot with actual `unread` / `awaiting_reply`. Kill the placeholder synth path when a token exists.
- **B.** Add a raw "API key" connector for Stripe (`sk_...`) and hit `/v1/balance` + `/v1/charges?limit=10`. Real numbers, no OAuth.

Either way: remove the "Live verification not available for this provider yet." fallback — if we can't verify, mark `status = error` instead of `connected`, so agents stop trusting phantom data.

### Step 3 — Auto-approve low-risk sends per agent
Add an `auto_approve_low_risk boolean default false` column to `agents`. When true, `send_email` and `http_post` skip the queue if `risk != "high"` and the guardrail doesn't literally say `[REQUIRES APPROVAL]`. Expose a toggle in `AgentEmployeePanel` under "Autonomy". This lets a user opt an agent into truly autonomous send once they trust it, without loosening safety globally.

### Step 4 — Verify Resend `from` identity
Confirm the project's Resend account has a verified domain and `send-transactional-email` uses it (or a Resend-provided `onboarding@resend.dev` fallback for dev). If not verified, tell the user which domain to verify in Resend — no code change until then.

### Step 5 — Set `WEBHOOK_DOMAIN_ALLOWLIST`
Ask the user for the comma-separated domains they actually want to POST to (Zapier/Make/n8n hooks, their app's ingest URL). Save via `add_secret`. `http_post` currently already reads this — just needs values.

### Step 6 — Rescue stranded `paused` runs
- In `agent-scheduler`, if the most recent event on an agent is a `clarification_request` older than 24h, log `clarification_expired` and let the next scheduled tick proceed with the last known state instead of skipping forever.
- Optional: surface unanswered clarifications as a badge on `AgentCockpit` so the operator sees them.

## Manual items you'll need to do (no code)
- Verify a sending domain in Resend (Step 4).
- Provide the webhook domain allow-list value (Step 5).
- Reconnect Gmail if you want Step 2A — the current row has no usable token (metadata note = "Live verification not available"), meaning OAuth never completed.

## What I'd tackle first
If you want the fastest "the agent did a real thing" moment: Step 1 + Step 3 in one pass. That alone converts the 44 stuck approvals into either real emails or explicit rejects, and lets you flip a switch per agent for hands-off sending. Step 2 makes the *reasoning* real; Steps 1+3 make the *actions* real.

Say the word and I'll implement Steps 1 and 3 (plus the small scheduler safety net in Step 6) in a single build pass. Steps 2, 4, 5 depend on choices/secrets from you.
