## Goal

Generated AI Agents become real "digital employees": they understand the business with minimal input, ask the user only what's truly missing, run on a schedule (not just one click), keep a memory of the business, and execute end-to-end workflows across Sales, Support, Marketing, and Ops — plus anything the client described in their original prompt.

## 1. Cold-start: auto-research the business

When the user submits a short prompt:

- NazAI extracts any URL, brand name, or industry hint from the prompt.
- A new edge function `business-context-researcher` runs Firecrawl + web search to build a **Business Profile**:
  - company name, one-line description, industry, tone of voice
  - core offers / products, pricing if public
  - audience, geos, languages
  - inferred KPIs (e.g. "book demos", "reduce reply time", "weekly content cadence")
  - common channels (email, social handles, support inbox)
- Output stored in a new `business_profiles` table, scoped per user, reusable across all agents.
- Every agent compiled afterwards inherits this profile automatically — no need to re-explain the business.

If no URL is given, the researcher uses web search + brand name only; missing pieces become questions in step 2.

## 2. Clarifying intake during generation (only when essential)

Before compiling the agent, NazAI runs a short adaptive intake — the same pattern NazAI uses with the user today:

- Inspects the Business Profile + the user's prompt
- Generates **at most 3 questions**, only for fields the agent literally cannot run without (e.g. "Which inbox should support replies be drafted in?", "What's an acceptable discount ceiling?", "Daily, hourly, or event-triggered?")
- If everything essential is already inferred, intake is skipped silently.

Intake answers are merged into the manifest and into `business_profiles` so future agents reuse them.

## 3. Real "digital employee" agent types

Compiler (`compile-agent-manifest`) gets a library of role blueprints, picked automatically from the user's prompt:

- **Sales / Lead Ops** — prospect research, ICP scoring, outbound draft, follow-up cadence, CRM-style pipeline updates (logged events for now).
- **Customer Support** — inbox triage, draft replies in brand tone, urgency classification, escalation log.
- **Marketing / Content Ops** — content calendar, post drafts, SEO/mention monitoring, weekly brief.
- **Operations / Finance** — KPI digest, anomaly alerts, invoice/renewal reminders, weekly report.
- **Custom** — fallback used when the user's prompt doesn't match a role; the compiler builds a bespoke manifest from the prompt + Business Profile (covers the "anything client asked for before generation" case).

Each blueprint defines: default goal, decision policy, KPIs, tool set, guardrails, schedule, and a domain-tuned dashboard layout (already supported by `GeneratedAgentDashboard`).

## 4. Autonomy + approval (matches the user's answer)

Default policy per agent:

- Internal actions (reasoning, research, drafting, logging, computing KPIs) → fully autonomous.
- External-world actions (sending an email, posting publicly, charging money, messaging customers) → drafted and queued as `pending_approval` events in the cockpit. User one-click approves or rejects.
- Whenever the agent hits a decision it doesn't have enough info for, it does **exactly what NazAI does with the user**: emits a `clarification_request` event with up to 3 concrete options. The cockpit renders these as inline answer chips; the user's answer is fed back into the same run and remembered on the agent for next time.

This means agents never silently stall — they either act, queue an approval, or ask a precise question.

## 5. Scheduled / always-on execution

Today agents only run on manual trigger. To feel like an employee they must work on their own.

- Add `schedule_cron` and `next_run_at` to `agents`.
- New edge function `agent-scheduler` triggered by pg_cron every minute: finds agents whose `next_run_at <= now()` and invokes `agent-runtime` for each.
- Compiler picks a sensible default per role (e.g. Support every 10 min, Sales daily 9am, Marketing Mon 8am, Ops daily 7am). User can change it from the cockpit.
- Cron + webhook + manual triggers all funnel into the same runtime path and the same event stream.

## 6. Persistent agent memory

New `agent_memory` table: append-only key/value facts the agent learns (e.g. "ICP = SaaS founders 10–50 emp", "no discounts above 20%", "primary support inbox = hello@…"). Runtime loads recent memory into the system prompt every run, and a dedicated `remember` tool lets the agent commit new facts. This is what makes the agent actually "synchronized to the business" over time instead of restarting cold every run.

## 7. Reliability + observability upgrades

- Manifest validation: compiler refuses to deploy if required fields are missing, returns the exact gap, cockpit shows a fix-it card.
- Runtime returns structured per-phase errors (already partly there) and the cockpit surfaces them; status no longer flips back to ACTIVE after a failed run (already fixed previously, keep it).
- Every run now logs: trigger, business_profile_version, memory_snapshot_count, tool_calls, approvals_requested, approvals_granted, KPIs touched.

## 8. Integrations

Per user request, only the foundation now — connectors come later:

- Keep current real tools: `web_search`, `http_get`, `calc`, `notify`, plus new `remember` and `request_approval` and `ask_user`.
- Mark email/CRM/Slack/Stripe tools as `needs_connector` placeholders so the UI shows "Connect to activate" without breaking deploy.(about this later)

## Files to add / change

Backend:

- `supabase/functions/business-context-researcher/index.ts` *(new)* — Firecrawl + AI gateway, writes `business_profiles`.
- `supabase/functions/agent-intake/index.ts` *(new)* — generates up to 3 essential questions, merges answers.
- `supabase/functions/agent-scheduler/index.ts` *(new)* — invoked by pg_cron, fans out to `agent-runtime`.
- `supabase/functions/compile-agent-manifest/index.ts` — add role library, inject Business Profile + memory, default schedule, manifest validation, `needs_connector` markers.
- `supabase/functions/agent-runtime/index.ts` — load memory, add `remember`, `request_approval`, `ask_user` tools; emit `clarification_request` and `pending_approval` event kinds; phase-tagged errors.

DB migration (one file):

- `business_profiles` (user-scoped, RLS, GRANTs)
- `agent_memory` (agent-scoped, RLS, GRANTs)
- `agents`: add `schedule_cron text`, `next_run_at timestamptz`, `business_profile_id uuid`, `role text`
- `agent_events`: allow new kinds `clarification_request`, `clarification_answer`, `pending_approval`, `approval_granted`, `approval_rejected`, `memory_write`
- pg_cron job calling `agent-scheduler` every minute

Frontend:

- `GenerationWorkspace.tsx` — show "Researching your business…" phase, then render intake questions (reuse existing question UI), then deploy.
- `AgentCockpit.tsx` / `GeneratedAgentDashboard.tsx` — new widgets: **Business Sync card**, **Schedule control**, **Approvals queue**, **Clarifications inbox**, **Memory log**. Reuse current premium glass styling.
- New `src/components/agents/IntakeQuestions.tsx` — renders the up-to-3 essential questions during generation and on demand in the cockpit.

## Acceptance test

1. Submit "AI agent for acme.com to handle inbound support".
2. UI shows "Researching acme.com…" then a Business Profile preview.
3. Up to 3 essential questions appear (e.g. inbox, tone, escalation rule). If all inferable, skipped.
4. Cockpit opens with role-specific dashboard, a visible schedule ("every 10 min"), and Business Sync card.
5. Agent runs automatically on schedule without the user clicking Run.
6. When the agent lacks info mid-run, an inline clarification chip appears in the cockpit and the agent waits.
7. External actions land in an Approvals queue, not silently sent.
8. Facts the agent learns appear in Memory and are reused in the next run.
9. Errors per phase are visible; status stays ERROR until a clean run succeeds.