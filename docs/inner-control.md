# Inner Control

Inner Control is where an account keeps its rules and talks to NazAI about them. This page covers what the page does and which
server paths it relies on.

## Rule actions (add, edit, switch off, switch on, delete)

Every action writes the rule's row directly. The account's own row rules (RLS) decide who may write it, and the database triggers
still apply: two-person approval for promote and delete when dual control is on, and the change log.

A write that the row rules refuse returns no error and changes 0 rows. So every write asks for the changed row back
(`.select("id")`), and `writeOutcome` in `src/lib/inner-rule-edit.ts` turns "0 rows" into a message on screen. A refused change is
never shown as done.

Edit (`RuleEditDialog`) changes only the columns the server reads:

- **Hard rules:** the text, which actions it applies to, block or hold for approval, and the number of approvals.
- **Safety rules:** the name, the pattern (checked by `findPatternProblem`), and block, hold or remove.

**Known gap.** Dual control covers promote and delete only. `request_policy_change` has no change type for switching a rule off or
editing it, so those two actions do not need a second owner.

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
