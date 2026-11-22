# Clean it (Context Days 1 and 2)

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

`context_checked` (status, changed, rewrite, source, with_context, found, edits), `result_copied`, `context_added` (chars,
structured, edited), `starter_rules_added`, `email_opened` (client: gmail, outlook or mail_app; never the addresses).

## Deploy

Apply the migration, then redeploy `control-system-decide`. The shared reply review gained an opt-in `personPresent` and the metered
judge an optional spend label; both default to the old behaviour, so the other functions need no redeploy. The website deploys on merge.

## Details (Context Day 1.5)

- **Control pulse**: "Outer Control is active" (on Clean it, and the status dot in the Tasks section) pulses softly in cyan; it
  pulses stronger for about 1.5 s when Clean it is pressed and again when the rules have been applied.
- **Rule application trail** under every result: `N rules applied → N fixes made → N items blocked`. Rules applied: what the first
  check read (text rules, built-in protection, rules in plain words; `rulesChecked` from the reply review). Fixes: words the rewrite
  replaced. Blocked: words removed, or the whole text when the rules blocked or held it. Each step is a button (it brings the matching
  list into view with a short ring) with a marker highlight on hover: rules cyan, fixes green, blocked amber (red when blocked).
- **Controlled result seal**: "Controlled by NazAI" with a thin cyan line, top right of a result that passed (clean or changed);
  its tooltip gives the time the clean took.
- **Quiet confidence**: a fully clean result (nothing found, nothing changed) dims the input and lifts the result, until the text is
  edited.
- **Context weight**: five thin marks next to the context, filled by how much of it a clean reads (up to 6,000 characters;
  `context_weight` gives the lengths only, never the text); the exact numbers are in the tooltip.
- **Clean, in motion**: the button shows "Applying your rules" with a timer to a tenth of a second (no spinner), a thin line moves
  across the paste box, and the result comes in with a short reveal.
- **Trust signature** under a result that passed: `Verified against your rules • Not shared • Controlled output`. "Not shared"
  explains itself on hover: the text is never shown to anyone else; it goes only to the AI NazAI uses to check and fix it, and is
  saved encrypted. Never shown on a result that did not pass.
- Also: Ctrl/⌘ + Enter cleans; Copy turns into Copied; hovering a change marks its new words in the result.
- All motion stops for reduced-motion.

## Context Day 2: structured context, result formats, email, homepage

**Structured context** (`supabase/functions/_shared/context-structure.ts`; action `structure_context`). "Sort it" in the context
dialog sends the pasted text (secrets hidden first) to the AI, which sorts it into Facts, Policies, Tone and Never say. Only what the
text says is kept: an item whose words are mostly not in the text is dropped as invented, and the dialog says how many lines were
left out. Each part is an editable list (one item per line). It is saved as one encrypted project with a heading per part
(`## Facts` and `- item`), so a context saved as plain text keeps working. The website and the server build the same text (a test
compares them). Edit (pencil next to the chosen context) reads the saved text, opens it in its four parts, and Save changes saves a
new version and archives the old one (kept in Projects). Sorting is metered (`context-structure`) and does not count as a clean.

How the parts are used: the context check compares a reply with Facts and Policies, and anything listed under Never say counts as a
conflict; the rewrite keeps to Tone and never writes what is under Never say.

**Result formats** (`supabase/functions/_shared/context-format.ts`): As pasted, Email, Short message, Bullet points (`format` on
`clean_text`; remembered on this device as `nazai_clean_format`). The reshape happens only after the clean, and only for a result
that passed. It uses the text and the Tone, adds no facts, and is checked again against the rules and the context (an email's
subject with its body). If the reshaped version does not pass, or cannot be made, the cleaned text is shown with a note saying why.
Copy gives plain text (an email with its `Subject:` line); Copy formatted also puts HTML on the clipboard, so paragraphs, lists and
bold paste formatted into Gmail, Docs, Notion or Slack. Bold is rendered as React elements, never as HTML from the AI.

**Email view and Send**: an email result is shown as an email (From, To, Subject, body) marked "Email · ready to send". Send asks for
From and To (checked as email addresses; several recipients allowed) and a Subject, then opens the person's own Gmail (the account
named in From, via `authuser`), Outlook (outlook.live.com for Outlook, Hotmail, Live and MSN addresses, otherwise
outlook.office.com) or mail app (`mailto:`), with everything filled in. The person presses Send there: NazAI never sends as them,
and the addresses are not sent to NazAI or saved.

**Homepage**: "AI Control Layer: Control the AI you already use. Your rules. Your context. One clean result." A before/after demo of
three illustrative cleans (ChatGPT, Claude, Gemini) replaces the typing console. "Clean it — free" (also in the header) goes to
`/control-system/outer`, after sign-in when signed out. The task flow is still there ("or describe any business task"). The page
title and descriptions say the same.

Deploy: redeploy `control-system-decide`. There is no database change. The website deploys on merge.
