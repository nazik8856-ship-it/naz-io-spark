# Outer Control: when a run is "Completed"

A session is Completed only when all of these hold (`outer-control-completion.ts`, stored on the session as `completion`, logged in `outer_control_completion_checks`): the tool said it was done; every step has a recorded exchange; nothing is waiting for a person; a result exists; the result is usable (not empty, a placeholder like "Done.", a refusal, an error text or an echo of the request); it keeps every blocking rule; it answers the goal; it was stored and read back identically. Then a final artifact (the official result, with its proof) is built and stored. What the person sees is `honestStatus()` (`outer-control-status.ts`): **Completed** needs the checklist *and* a valid artifact, anything else is shown for what it is.

| What came back | What happens | What the person sees |
|---|---|---|
| a real, complete answer | checklist passes, artifact stored | Completed (result opens with its proof) |
| empty, a placeholder, a refusal, an error text, an echo | sent back once with what is missing | then **Waiting for human** with the reason |
| a reply that breaks a blocking rule | not released | Stopped, naming the rule |
| the tool says it is not finished, or the result was not stored and read back | cannot complete | Failed / still running, never Completed |
| a Task where some steps finished, then it stopped | the finished steps keep their results | Partially completed (n of m steps) |

## Database guards (only the move into "completed" is checked)

- Session (`guard_outer_control_completed`): a passing checklist with outcome completed, a final result, a matching artifact.
- Task (`guard_outer_control_task_completed`), **tightened 2026-11-13** (migration `20261113071940`): additionally no step may still be queued, running or waiting, and at least one step must have finished with a passing checklist. Before, the encrypted branch only checked that a result and an artifact existed.

## Changed on 2026-11-13

- "Done.", "OK!", "Success." and similar (with punctuation) are placeholders, not results. A contract test found that they passed as usable.
- The Task guard above. Tested live in a transaction that was rolled back: all 32 real completed Tasks with artifacts can still be moved into completed; a Task with an open step is refused; a Task whose steps all failed is refused.

## Quality floor (2026-11-14)

"Usable" now also means "worth keeping". `assessOutput` (in `outer-control-completion.ts`) checks, with no model call, and sends a result back once with the exact finding (then a person decides, like any unusable result):

| Finding | When it fires | What the tool is told |
|---|---|---|
| only pleasantries | something like "Certainly! I hope this helps." is all there is | give the content itself, without opening or closing pleasantries |
| repeats itself | 6 or more sentences and under half of them are different | say each thing once and add what is missing |
| too thin | the goal asks for a report, plan, analysis, proposal, strategy, comparison, article, memo, checklist, outline, roadmap or guide with a verb ("write a report on…"), the reply is under 40 words and is not a list of 3 or more items. A stated word limit, "brief" or "short" turns this off | write it out in full |
| generic | 80 or more words, three or more stock phrases ("it is important to note", "plays a crucial role", "in today's fast-paced world"…) and almost no concrete detail (numbers, names, quoted text, links, list items) | give specific facts, numbers, names or steps |
| one block | 300 or more words with no line break | short paragraphs, headings or a list |

A short direct answer ("Yes", "42", "Thirty days.") is never judged by these.

**Pleasantries are removed from the stored result.** `tidyOutput` takes off at most two opening and two closing sentences that are pleasantries ("Certainly!", "Sure! Here's the report:", "I hope this helps!", "Let me know if you have any questions."), only at the very start and end, and only when at least 20 words of content remain. A sentence in the middle, or one that starts with "Sure," and then says something, is never touched. The rules, the goal check, the hash and the artifact all see the tidied text, so the stored result is exactly what was checked; the raw reply stays in its step (Control Diff shows both). The session's reason says how many lines were removed. A person's own text and the report writer's report are never changed.

Tools are also told up front (every multi-tool action, `HONEST_TOOL`): give concrete facts, numbers, names or steps, and no pleasantries.

The report writer's own analysis (summary, conclusion, recommendation, result) is rejected when it is a stub of fewer than 3 words once [n] references are removed.

Limits, said plainly: these are surface checks. A reply can be well-formed and still wrong; they stop the empty, padded and vague ones. Replies longer than 60,000 characters were already not read as structured replies; that is unchanged.

## History

14 to 17 October runs (33 sessions, 6 Tasks) were completed before the checklist and the artifact existed. They have no proof, so the app shows them as **Failed ("Recorded as completed, but it is not accepted")** rather than Completed. Nothing completed since 18 October is missing its proof.

## Checks

`src/test/outer-control-completion-contract.test.ts` (each kind of reply to its final status), `supabase/functions/_shared/outer-control-completion_test.ts`, `outer-control-task_test.ts`, `src/test/outer-control-artifact.test.ts`, and the engine tests "quality: …" in `tests/outer-control-engine/session-test.mts`.

## Specific to the request (context used, every part answered, concrete)

The eight criteria prove the process: the tool finished, the rules held, the result was stored. They do not prove the result is
useful to *this* person. Three more checks do (`assessSpecific` in `outer-control-completion.ts`), deterministic, no model call:

| Check | Passes when | Applies when |
|---|---|---|
| Uses your context | the result contains distinctive words of the Task's context (names, numbers, words of 6+ letters; not the brief's labels, not words already in the request): 1 of 3–5 such words, 2 of 6 or more | the Task has such a context and the result is 80+ words |
| Answers every part of the request | each numbered or bulleted line, each separate question, and each item of an "A, B and C" list is answered (enough of its subject words appear) | the request has 2 to 8 such parts |
| Gives concrete detail | numbers, names, list items, quotes and links: at least 3, and 1 per 100 words | the result is 150+ words |

Which checks a step gets depends on its action (`QUALITY_BY_KIND`): opinions, research, compare, decision and plain Tasks get all
three; a fact-check only concrete detail; a step of a multi-step or delegated Task context and concrete detail (it does one part on
purpose). Rewrite, explain, key points, roles, adapt, alternatives and draft are told to add nothing, so none applies. Goal Tasks have
their own judge; a person's own result and NazAI's report writer are never judged.

What happens:

1. **Not specific, a retry left**: the result is not stored; it is sent back once through the same path as a result that misses the
   goal, and the tool is told the exact gap ("this part of the request was not answered: 2 ("Shipping to Austria")").
2. **Still not specific after that**: the hard criteria hold, so it completes, but with `quality.warning` = "Partly generic: …". The
   summary says "Completion check passed with a warning", never "all 8 criteria met"; the result's proof, the session's headline,
   the activity line and the Checks tile all show the warning; a Task's proof names the step it came from. The artifact validator
   refuses a proof that says `ok` while a check failed, or a failed check without a warning.
3. **Specific**: the headline is "Completion check passed: specific to the request (…)" instead of "8/8".

Results stored before this keep their exact text: the new headline only appears in a proof that carries the checks.

Tests: `supabase/functions/_shared/outer-control-specific_test.ts`, `src/test/completion-specific.test.ts`, and the "specific:"
engine tests in `tests/outer-control-engine/session-test.mts`.
