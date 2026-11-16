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
- Migration `20261115032535_outer_control_context_used.sql`; `context_used` is class OPERATIONAL (kinds and sizes).
- `src/lib/outer-control-artifact.ts` (identical in `supabase/functions/_shared`): `ContextUsed`, `cleanContextUsed`, `contextUsedLine`; the tile is in `outer-control-task-progress.ts` and `FinalArtifactView.tsx`.

## Tests

`outer-control-context-brief_test.ts` (Deno: the cap, empty, order, markers, the merge with typed text, the 8,000 limit, a failing read), `context-brief-wiring.test.ts` (every start path adds and records it; the relay and the other functions never load it), the artifact, tile and *Start a task* tests.

## What each tool is asked (requirements, and how long an answer is)

An account's rules say what a tool must **not** do (block, needs approval, remove text). The analysis actions also say what a useful answer **must** do, in the request every tool receives (`stepInstructionFor`, `opinionInstruction` in `outer-control-report.ts`):

1. **Be specific to the situation** in the context given; where something the answer depends on is not stated, write it as `Assumption: …` instead of guessing silently.
2. **A basis for every number, date or claim of fact**: where it comes from, or that it is an estimate.
3. **No generic advice** (decisions): every recommendation says what to do, for whom, and what it would change.

| Action | Answer asked for (before) | Shape |
|---|---|---|
| Research | **500 to 800 words** (250) | specific findings with how sure; *What this means for you*; *Assumptions*; *Next steps* (3 to 5, in order) |
| Decision | **450 to 700 words** (300) | options with pros, cons and cost; a recommendation for this situation; risks; what would change the answer |
| Opinions | **350 to 600 words** (250) | the opinion, the reasoning, where unsure, and what the tool would do in the asker's situation |
| Compare | **350 to 600 words** (250) | direct, specific and complete |
| Fact-check | **300 to 500 words** (250) | each part correct, partly correct or wrong, with a correction and a basis |

Rewrite, alternatives, explain, key points, roles, adapt, draft and the multi-step and delegation actions are unchanged. The range is a range on purpose: a question that can be answered fully in fewer words should not be padded.

Two limits moved with it: a tool's answer is kept whole up to **9,000 characters** (it was 4,000, which cut a 700-word answer mid-sentence), and an Anthropic-format tool may use **2,048 tokens** (it was 1,024).

Tests: `outer-control-report-instructions_test.ts`.

## One source is said plainly

Opinions, research, fact-check and decision are meant to compare tools. Asked of one tool, they used to look like a multi-source report ("where they agree", "where they differ") with nothing to compare. Now:

- **Before the start**: with one tool chosen for one of these actions, *Start a task* says *One tool gives one point of view, so nothing can be cross-checked; the result will say so. Pick a second tool to compare.* It does not stop the Task (a person may have only one tool).
- **The writer** is told there is one source and returns no agreements or differences.
- **The result** says at the top: *Single source: only ChatGPT answered, so nothing here was cross-checked. Ask a second tool to compare before relying on it.* This appears on the page, in every look and every file, and in the *Tools used* tile (shown as a warning). The empty *Where they agree / differ* sections are left out.
- **The stored text** says it too, for a report made from now on (`ReportDoc.single_source`). A report stored earlier keeps exactly the text it was stored with; its page, looks and files still show the warning (`isSingleSource`).

Compare still needs two tools. The one-tool actions (rewrite, explain, key points, draft, alternatives, roles, adapt) are not marked.

Tests: `single-source.test.tsx`, the single-source part of `outer-control-report-instructions_test.ts`, *Start a task* and the proof tile.

## What this means for you (the report writer applies your situation)

When a Task has a background (what you typed, a project, or what NazAI knows about the business), NazAI's AI is asked for 2 to 5
next steps under **What this means for you**. This is the one place where it may use facts from your situation; it still adds no new
fact about the world, and the sources stay word for word.

Each step must say what it rests on, and the code checks it (`parseImplications` in `outer-control-report.ts`):

- **From your situation**: the AI's "because" is checked against the words of your background (at least half of its meaningful
  words must be there). Only then is it shown as from your situation.
- **Assumption**: what the AI had to assume. A "because" that your background does not contain is shown as an assumption, never as
  something you said.
- A step with no basis at all, a step that cites a source that does not exist, or an empty step is left out. A bad step never fails
  the result. At most 5 steps.

Without a background nothing is asked and the section is absent. It is shown right under the header on the screen, near the top of
every look (`foryou` in the section order), in every file, and the result's "How this was made" note says how it was made.

Tests: `supabase/functions/_shared/outer-control-for-you_test.ts`, `src/test/report-for-you.test.tsx`, and the engine test
"what this means for you" in `tests/outer-control-engine/session-test.mts`.
