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
- Task (`guard_outer_control_task_completed`), **tightened 2026-11-13** (migration `20261113120000`): additionally no step may still be queued, running or waiting, and at least one step must have finished with a passing checklist. Before, the encrypted branch only checked that a result and an artifact existed.

## Changed on 2026-11-13

- "Done.", "OK!", "Success." and similar (with punctuation) are placeholders, not results. A contract test found that they passed as usable.
- The Task guard above. Tested live in a transaction that was rolled back: all 32 real completed Tasks with artifacts can still be moved into completed; a Task with an open step is refused; a Task whose steps all failed is refused.

## History

14 to 17 October runs (33 sessions, 6 Tasks) were completed before the checklist and the artifact existed. They have no proof, so the app shows them as **Failed ("Recorded as completed, but it is not accepted")** rather than Completed. Nothing completed since 18 October is missing its proof.

## Checks

`src/test/outer-control-completion-contract.test.ts` (each kind of reply to its final status), `supabase/functions/_shared/outer-control-completion_test.ts`, `outer-control-task_test.ts`, `src/test/outer-control-artifact.test.ts`.
