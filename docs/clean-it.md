# Clean it (Context Day 1)

Outer Control's first screen. A person pastes text that ChatGPT, Claude, Gemini or any AI wrote; NazAI applies the account's rules
and the person's own context and returns ONE result: the text to copy, what the checks found and what the rewrite changed.

Tasks, connected tools and the API are one section below it ("Tasks, connected tools and API"), closed until opened. A link to the
Task area (`?start=…` from onboarding, `?project=…` from a project) opens it, and it stays open after the Task area reads the link.

## The steps (server: `control-system-decide`, action `clean_text`; logic: `supabase/functions/_shared/context-clean.ts`)

1. **The account's rules** check the pasted text: the same review every reply gets (`evaluateExternalText`: hard rules, text rules,
   rules in plain words), recorded as `source_model = paste:<source>`. The person is deciding now (`personPresent`): a rule that asks
   for approval is shown to them, never queued as an approval request.
2. **Your context**, when one is chosen: the text is compared with it (`checkAgainstProject`). Only contradictions quoted word for word
   on both sides count; a quote that is not really there is thrown away.
3. **Rewrite** when something is wrong: the AI changes only what the problems need, never adds facts, numbers, dates or promises,
   and uses the context for a contradicted statement. The text is fenced as data; secrets and personal data are hidden first
   (`hideBeforeSaving`), so they never reach the AI.
4. **Checked again**: the rewrite goes through the same rules (`paste-recheck:<source>`, not counted as a clean). Only a rewrite that
   passes is offered. Otherwise: the rules' own cut version, or the block / "a person should decide" with the reason, or, for a
   contradiction with no passing rewrite, the text with the statements marked. A check that did not pass is never claimed; when the
   AI is unavailable the card says the rewrite could not run.

Every AI call is metered into the account's daily AI spend and its cap (`meteredGatewayJudge`, purpose `context-clean`).

## Free allowance

15 cleaned results a day (UTC) for a free account (`FREE_CLEANS_PER_DAY`, `free_limit_of('context_clean')`, migration
`20261121010000_context_clean`); paid use comes later. The same exemptions as every free limit (a paid tier, or an address on
`free_limit_exempt_emails`). A clean is counted by its first check. Past the allowance the server answers 402 with a calm message.

## Your context

Added once from the panel ("Add"): pasted text saved as an imported project (`projects`, `import_paste`), encrypted like every
project, editable or deletable in Projects. The panel remembers the chosen project on this device (`nazai_clean_context:<account>`,
an id only); with nothing chosen it uses the project named "My AI context".

## Starter rules

Three starter rules for AI output (No invented numbers, No promises, No professional advice as fact): the ones the account does
not have yet (by name) are offered, even when it has other rules in plain words. Nothing is saved until "Add these N"; they are
saved live (not shadow) as account-wide rules in plain words.

The reasons on the card are written to the reader ("your context"): the rewrite and the context check are asked for it, and
`toReader` turns any "the person's" / "the project" that is left into "your" / "your context". A Task's project check keeps its own
wording.

## Measurement (PostHog; counts and labels only, never the text)

`context_checked` (status, changed, rewrite, source, with_context, found, edits), `result_copied`, `context_added` (chars),
`starter_rules_added`.

## Deploy

Apply the migration, then redeploy `control-system-decide`. The shared reply review gained an opt-in `personPresent` and the metered
judge an optional spend label; both default to the old behaviour, so the other functions need no redeploy. The website deploys on merge.
