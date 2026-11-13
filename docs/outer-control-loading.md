# Outer Control: loading always ends

Rule: nothing on the way into Outer Control may wait for ever. Every wait ends with the page, or with a plain error and a way to try again.

## Where it could hang, and what ends it now

| Step | Before | Now |
|---|---|---|
| Opening the page file (Inner → Outer switch, `lazyWithReload` in `App.tsx`) | a file that never arrived left the skeleton for ever | 30 s, then the error screen with **Reload**; the one-time reload marker is cleared after a good load, so a second new deployment in the same tab also recovers |
| Sign-in level check (`AuthGuard`) | waited on the browser's sign-in lock with no limit | 8 s, then the page opens (the database still refuses staff data without the code) |
| Account lookup (`useActiveAccount`) | no `.catch`: a failure left "loading" for ever | falls back to the person's own account |
| Reading Outer Control content (`ocRead`, `src/lib/outer-control-read.ts`) | no timeout on the sign-in read or the request | 8 s for the saved sign-in, 15 s for the request (the connection is cancelled); the result is an error with code `timeout`, never empty data |
| The page's own load (`OuterControlSystem`) | no `try/catch`: any thrown error left "Loading…" for ever; a failed read looked like "set up your first key" | one 25 s limit around all six reads, `try/catch/finally`, and `loadVerdict()` (`src/lib/outer-control-load.ts`): a failed connections/keys read shows the error and **Try again**; a failed activity feed only shows a notice, the rest works |
| Project list (`useProjectList`) | no timeout | 15 s |

## Checks

- `src/test/with-timeout.test.ts`, `src/test/outer-control-read.test.ts` (a hung server ends as a `timeout` error), `src/test/outer-control-load.test.ts`.
- `src/test/outer-control-page.test.tsx`, "loading always ends": a failed read shows the error and no "Loading…"; **Try again** reads again; a read that never answers ends in the error after 25 s; a failed feed costs only the feed.

## Not here

The cards on the page (active sessions, tasks, workflows) poll every 3 seconds and show nothing special when a poll fails; that is Day 1 task 2 (lighter polling).
