# Onboarding and limit windows

What a new person sees after the first two onboarding windows, and what anyone sees when a free usage limit is reached.

## Window set 1: first-time sequence

| # | Window | When | Actions |
|---|---|---|---|
| 1 | Welcome (`FirstValueWelcome`) | first visit of a new account | existing, unchanged |
| 2 | Task completer choice (`FirstTaskChoice`) | Outer Control, `?start=first` | existing, unchanged |
| 3 | First product use | first time in Outer Control (no completed Task yet), or first time in the Generator | Got it · Start a task (Outer Control, if nothing runs) |
| 4 | Connector unlock | after the first completed Task | Connect a tool (opens Connect a tool) · Later |
| 5 | Control unlock | after the second completed Task | Try Generator (primary) · Explore AI Control |

- Windows 3 to 5 are small corner cards (bottom left), never modal, one at a time. A card waits while any modal window is open
  (Welcome, the choice, Start a task, the limit window).
- Each is shown once per account. What was seen is kept in the account's auth metadata (`onboarding`), so it holds on every device.
- Only accounts created after this shipped (2026-11-07), within 30 days of signup, see them. Older accounts never do.
- The rule that picks the window is `nextWindow()` in `src/lib/onboarding-windows.ts`; the host is
  `src/components/onboarding/OnboardingWindows.tsx`, mounted once in `App.tsx`.

## Window set 2: global limit window

A free (Explorer) account may start **3 Control Tasks** and create **2 new websites** per calendar month (UTC).

- **Previous work stays available.** Only the new limited action is refused: opening, editing, publishing and reading results all
  keep working. Editing, refining and rebuilding an existing website are never limited.
- **What counts:**
  - a Control Task is any Task started in Outer Control (one tool, several tools, a report, a goal, a follow-up, a Task from the
    Control API relay);
  - a Task that failed, was cancelled, stopped or rejected does not count.
- **Who is not limited:**
  - paid tiers;
  - the email addresses in `free_limit_exempt_emails` (system only; today the owner's account).
- **Where it is enforced:**
  1. the server checks before it spends anything: outer-control-drive, before any credit, and compile-website-manifest, before the
     outline and before generation;
  2. `startWorkflow` checks again before the insert, which covers every Task path;
  3. insert triggers on `outer_control_workflows` and `websites` refuse a row past the limit. A lock per account makes two
     starts at the same moment unable to share the last free slot.
- **The response** is 402 `{ error: "free_limit", kind, used, limit, resets_at, message }`. In the app, `showLimitIfAny()` opens
  the window from that response. `LimitWindow` is mounted once in `App.tsx` and opened by the `nazai:limit` event. The same window
  also handles an out-of-credits refusal (`no_credits`).
- **Buttons:**
  - "Upgrade to Pro" (primary) opens `/pricing`. This is a placeholder until payments are set up: decide its real destination then.
  - "View usage" shows this month's counts (`my_free_limits()`) and the credits left.

## Window set 3: after the first success

The first success is the first completed Control Task.

- **Staying in Outer Control:** no window is forced. The connector-unlock card is a corner card the person can ignore; nothing
  modal appears.
- **Leaving Outer Control:** one soft discovery card names the other parts of NazAI (Generator, AI Control, Projects).
- **"Was this useful?":** optional, one tap, skippable. It appears right after the unlock card of the moment is handled. While a
  Task is still running ("busy"), it waits until it has finished.
  - "Not really" offers four fixed reasons; no free text is stored.
  - The answer is recorded twice:
    - in the account's `onboarding` metadata, so the card never comes back;
    - as one row per account in `onboarding_feedback` (answer: useful, not_useful or skipped, plus the reason). The person can
      write and read only their own row.
  - **Where to see them:** `/ops/feedback`, for the platform's owners and admins only. It shows the totals, the share that found
    it useful, the "Not really" reasons and the latest 50 answers, never who gave them. It reads
    `onboarding_feedback_summary()` and `onboarding_feedback_recent()`; both refuse everyone else. There is also a link to it
    from Platform incidents.

## Creative system

Every window carries exactly one small creative from `src/components/onboarding/OnboardingArt.tsx`:

- **Tile:** 72×72 (64 in the corner cards), dark (`#030a17`), with a faint cyan border and one soft cyan glow.
- **Strokes:** thin, round caps, cyan `#22d3ee` and its tint `#67e8f9` only.
- **Content:** abstract, product-related. No photos and no lock imagery.

| Window | Creative |
|---|---|
| First product use | `first-step`: a start point, one control gate with a check, the path after it still faint |
| Connector unlock, discovery | `linked-nodes`: three linked tools under one rule-layer bar |
| Control unlock | `shield-check`: a shield with a check |
| Limit | `soft-progress`: a full ring of three soft segments around two stacked saved items |
| Feedback | `feedback-check`: a clean check with two light, optional reaction marks |

## Checks

- `src/test/onboarding-windows.test.ts`:
  - the window order and the "one at a time, wait for modals" rule;
  - no discovery card inside Outer Control;
  - feedback waits while a Task runs;
  - the limit window's wording and wiring;
  - the server checks come before anything is spent.
- `supabase/functions/_shared/free-limits_test.ts`: the refusal body, fail-open on a lookup error, and the calm message.
- **Screens for review:** `/dev/onboarding-windows?w=<id>` renders every window with fixed values. It exists only in `vite dev`,
  never in a production build.
