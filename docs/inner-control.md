# Inner Control

Inner Control is where an account keeps its rules and talks to NazAI about them. This page covers what the page does and which
server paths it relies on.

## Rule actions (add, edit, switch off, switch on, delete)

Every action writes the rule's row directly. The account's own row rules (RLS) decide who may write it, and the database triggers
still apply: two-person approval when dual control is on (see below), and the change log.

A write that the row rules refuse returns no error and changes 0 rows. So every write asks for the changed row back
(`.select("id")`), and `writeOutcome` in `src/lib/inner-rule-edit.ts` turns "0 rows" into a message on screen. A refused change is
never shown as done.

Edit (`RuleEditDialog`) changes only the columns the server reads:

- **Hard rules:** the text, which actions it applies to, block or hold for approval, and the number of approvals.
- **Safety rules:** the name, the pattern (checked by `findPatternProblem`), and block, hold or remove.

**Dual control covers every way to weaken a rule.** With `require_dual_control_for_policy` on, promoting, deleting, switching off
and editing a rule are requests (`request_policy_change`: `promote_*`, `delete_*`, `disable_*`, `edit_*`). A second, different owner
approves them, and only then are they applied. The rule keeps working as it is until then. The database enforces this, not only the
page: `guard_rule_weakening` refuses a direct switch-off, or a change to what a rule matches or does, from a signed-in person
(migration `20261118010000`). An edit request keeps only the columns an edit may change (`rule_edit_columns`). Switching a rule back
on strengthens it, so it stays direct.

## The chat runs a task (`control-system-decide`)

1. The AI calls `run_task`. The server answers `task_offer`: what will run, with which built-in tools (Writer, Analyst, Reviewer,
   at most 3), and what it costs. Nothing starts yet.
2. The person presses Run. The page calls `control-system-decide` with `action: "run_task"`. The server checks the request and
   starts an Outer Control Task (`outer-control-drive`, `start_report`) with `paid_starter: true`.
3. Pricing: the first `STARTER_TASKS` (2) Tasks with built-in tools are free. Each one after that costs one credit.
   `starterAllowed` lets a paid Task use the built-in tools.
4. The card follows the Task. It then shows the one controlled result, how many answers the rules changed or held, and a link to
   Outer Control.

Chat tasks use only NazAI's built-in tools, never the person's own API keys, so a chat request never spends their money elsewhere.

## The chat drafts a rule (`draft_rule`)

The AI never stores a rule, and it never writes a pattern. It returns a draft (mode `rule_draft`) of one of two kinds:

- **Action rule** (`hard_rules`): what to stop or hold, and for which actions.
- **Text rule** (`safety_rules`): the words to look for, and whether to block, hold or remove them. NazAI builds the pattern from
  the words (`phrasesPattern`): each word escaped, matched as a whole word, longest first, and case-insensitive, as the scanner
  matches.

The page saves the draft with the same table write the Add forms use, and it starts in shadow mode unless the person turns that off.

## One rule set everywhere

There is one set of rules per account: the rows in `hard_rules` and `safety_rules`. Rules added by hand, edited, switched off,
switched on, deleted or made in the chat all land in it. Every server path reads that set with the same filters: switched-on rows
only, shadow rules never enforced, and rules scoped to one agent or one API key apply only there.

| Path | Action rules (`hard_rules`) | Text rules (`safety_rules`) |
|---|---|---|
| Agents (`control-engine`, `agent-runtime`, through `_shared/control-gate.ts`) | `matchHardRule`, reading the active policy snapshot | `loadSafetyRules` |
| Outer Control answers, including chat Tasks (`_shared/outer-control-text-review.ts`) | `matchHardRule` as `outer_control_text_review` | `loadSafetyRules`, plus the project's rules |
| Outer Control connection test (`contactRuleStopping`) | live table, as `outer_control_contact` | none |
| What a tool is told (`loadRuleLines`) | live table | `loadSafetyRules` |
| Chat text review (`control-system-decide`) | through `evaluateExternalText` | through `evaluateExternalText` |
| Control API (`control-api`) | live table | `loadSafetyRules` |

**An edit reaches agents at once.** Agents read a policy snapshot (`get_active_policy_version`). Every rule write lands in
`config_changes` (the `log_config_change` trigger). If a change is newer than the snapshot, the snapshot is rebuilt on the next call.
So an edit made on this page applies to the very next action, not to a later published version.

**What a chat Task is checked against.** The task card says "Checked against N rules". N counts only the rules that check a Task's
answers (`checksTaskAnswers` in `src/lib/inner-control-ui.ts`): switched on, not in shadow mode, for the whole account, and, for an
action rule, any provider with an action pattern that covers `outer_control_text_review`. An action rule for "Sending email"
applies to sending email, so it is not counted.

`src/test/one-rule-set.test.ts` holds the page's count to the server's choice and guards the server filters above.

## Rules in plain words for the whole account (Day 3)

A rule in plain words ("Never promise a delivery date") is a `meaning_rules` row with no `project_id`. The Inner page adds,
edits, switches off, deletes and makes it live directly (row rules: the owner, or a team owner with the `policy` permission, and
only account-wide rows). It has the same protections as hard and safety rules (migration `20261120010000_account_meaning_rules`):
- shadow mode (`shadow_mode`, `promoted_at`): a shadow rule's finding is only a shadow match;
- at most 10 per account (`cap_account_meaning_rules`);
- dual control: switching off, editing, deleting and going live are `disable/edit/delete/promote_meaning_rule` requests;
- every change logged (`config_changes`).

**Where they apply.** The AI judge (`_shared/meaning-judge.ts`) runs inside the one shared reply review,
`evaluateExternalText({ meaning })`. Every path that checks a real reply passes `meaning`: the Outer Control API, the relay, an
agent's `http_post`, the chat's "check this text", a Task's replies and a person's edited reply. The dashboard's fixed key
self-test does not. A live rule can only make the decision stricter, and it needs a quote of the words that break it. A reply
already blocked is not judged. When the judge can not run and a live rule was left unchecked, a person decides.

**Cost.** One judge call reads a reply against all of its rules, and at most 10 are read (the account's first, then the
project's, oldest first). `meaning: { ai: "gateway" }` meters every call into the account's daily AI spend and its cap
(`meteredGatewayJudge`). Each reply check records `meaning_rules_checked`, `meaning_rules_skipped` and `meaning_cost_usd`, which
feed the line under the rules list.

## What happened, under the rules (Day 3)

- **Suggested rules** (`src/lib/rule-suggestions.ts`): an action blocked, changed or held 3 or more times in 7 days with no rule
  of the account behind it (`hard_rule_id` null) and no rule covering it is offered as a drafted rule. Nothing is saved until Save.
- **What each rule did** (`src/lib/rule-activity.ts`): over 90 days, from `agent_decisions.hard_rule_id`,
  `hard_rule_shadow_hits` and the reply checks' `matches` / `shadow_matches`, which are read through the server because they are
  encrypted.
- **Control pages pruned by usage**: the 11 pages nobody opened and no job needs are out of the All pages menu
  (`HIDDEN_FROM_MENU`). Every one keeps its route.

**Deploy order.** Apply the migration before the server functions: they write the new evaluation columns and read `shadow_mode`.
