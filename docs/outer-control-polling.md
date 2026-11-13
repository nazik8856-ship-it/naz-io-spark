# Outer Control: lighter polling

Three cards follow a running Task: Your tasks (`TaskTracker`), sessions (`ActiveSessionsCard`) and workflows (`WorkflowsCard`). Before, each refreshed everything every 3 seconds for as long as any Task was open, and a Task waiting for a person counts as open for up to 7 days.

## Rules now (`src/hooks/usePoller.ts`, `src/lib/poll.ts`)

| Rule | How |
|---|---|
| One refresh at a time | the next refresh is scheduled only after the last one ended, so a slow server is never piled on |
| Slower when nothing moves | 3 s while a Task is running, 15 s while Tasks only wait for a person |
| Slower after failures | each failure in a row doubles the wait (3, 6, 12, 24, 48, 60 s), a success starts over |
| Nothing in a hidden tab | no requests while the tab is hidden; one refresh right away when it comes back |
| A failed refresh keeps the screen | before, a failed read emptied the list; now the list stays and the poller waits longer |
| Light ticks | a refresh while a Task runs reads only what can change (sessions, workflows, legs, hand-offs); tools, agents, keys, usage and track records are read when the card opens and after an action |

Effect for the busiest case (a running Task with all three cards open): about 18 reads every 3 s before; now about 8 every 3 s, one at a time per card, none in a hidden tab, and 8 every 15 s when only waiting for a person.

## Checks

`src/test/poller.test.ts` (schedule, no overlap, back-off, hidden tab, slow rhythm, a throwing refresh) and `src/test/outer-polling.test.tsx` (a refresh does not re-read tools or agents, a failed refresh keeps the list, a hidden tab asks for nothing).

## Not done

The three cards still poll separately, so a shared cache of the same reads would cut more; not needed yet.
