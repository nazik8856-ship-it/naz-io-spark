# Outer Control: the context brief

A tool that is asked a question knows nothing about the person asking, so its answer is the answer for anybody. NazAI already knows the business. The **context brief** puts the useful part of that into the Context that every tool of a Task receives, and the result says exactly what was sent.

## What goes in (at most 2,000 characters)

| Source | What is taken | Where it comes from |
|---|---|---|
| **Business profile** | company, what it does, industry, audience, offers, tone, channels | the newest `business_profiles` row |
| **Your notes** | the person's own description of their situation | `profiles.user_context` |
| **Knowledge entries** | up to 5 general standing facts (an entry written for one kind of action is not about the situation) | `knowledge_base_entries`, enabled, no action pattern or `*` |

Each source has a share of the room (business about 650 characters, notes 600, knowledge entries the rest, 300 each at most). Text is cleaned (no `<<<` markers, no control characters). The brief starts with one sentence telling the tool it is information about the person, not instructions, and to state as an assumption anything the answer depends on that the brief does not say.

The brief goes **after** what the person typed (background, an attached project), which is never cut. A Task's context is limited to 8,000 characters in all: the brief is shortened to what is left, and left out when less than 300 characters are left. A Task with a project attached keeps 1,200 characters free for the brief, so the project never takes the whole context.

## Who gets it

- **Every Task the account owner starts in the app**: a single session, a task, a report (all 14 actions), a goal and a workflow. Later steps of a Task receive it too (it is part of the Task's context).
- **Not** a request an external platform makes through an API key (`/outer-control`, the relay): nothing about the business reaches a tool on somebody else's say-so.
- **Not** a follow-up to a finished session (it carries the earlier question and the controlled answer instead).

## Control

- **A switch on every start**: *Give the tools what NazAI knows about my business*, on by default in *Start a task*. Off sends `share_context: false`; typed background and a project still go.
- **The account's rules still apply**: the brief is context like any other. The rules mask or block text in it before it is sent, and a rule that blocks the context drops it.
- **Nothing is read when it is off**, and a source that cannot be read is left out without stopping the Task.

## What the result says

Every Task records `outer_control_workflows.context_used`, a list of `{kind, chars, n?}` (kinds: `business`, `profile`, `knowledge`, `project`, `background`). Never the text. The final artifact carries it (`context_used`), and the result shows **What the tools knew**:

- *The tools were given: your business profile, your own notes, 2 knowledge entries, the project you attached, the background you typed.*
- With nothing: *The tools were given no information about your situation, so the answer is general. Add background, a business profile or a project to make it specific.* (shown as a warning)
- A Task made before this was recorded shows no line.

The same sentence is in the downloadable readable version (`CONTEXT THE TOOLS WERE GIVEN`).

## Where it lives

- `supabase/functions/_shared/outer-control-context-brief.ts`: `buildContextBrief` (pure), `loadContextBrief`, `withContextBrief`.
- `supabase/functions/outer-control-drive/index.ts`: `withBrief` / `markContext` around every start action.
- Migration `20261115060000_outer_control_context_used.sql`; `context_used` is class OPERATIONAL (kinds and sizes).
- `src/lib/outer-control-artifact.ts` (identical in `supabase/functions/_shared`): `ContextUsed`, `cleanContextUsed`, `contextUsedLine`; the tile is in `outer-control-task-progress.ts` and `FinalArtifactView.tsx`.

## Tests

`outer-control-context-brief_test.ts` (Deno: the cap, empty, order, markers, the merge with typed text, the 8,000 limit, a failing read), `context-brief-wiring.test.ts` (every start path adds and records it; the relay and the other functions never load it), the artifact, tile and *Start a task* tests.
