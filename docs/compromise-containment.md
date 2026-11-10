# Compromise containment

General data security, task 6. If one outside tool or path turns out to be unsafe, NazAI stops that path cleanly and protects the
rest of the system.

## What counts as unsafe

Two signals, both already written as signed security evidence (`docs/security-evidence.md`), so the decision rests on the same record
an auditor reads:

| Signal | Evidence kind | What it means | Result |
|---|---|---|---|
| NazAI's outbound guard refused a request aimed at the tool | `outbound_blocked` | a credential would have gone to a host it does not belong to, or the address left the allowed destinations | the tool is suspended **at once** |
| A reply from the tool tried to give NazAI instructions and was held | `content_held` | the tool is trying to steer NazAI (`docs/external-content.md`) | the tool is suspended on the **third** in 24 hours |

A held reply is also asked again within the same step, so two replies can follow one another quickly; three in a day means the tool
keeps doing it. Signals older than 24 hours do not count, and neither do signals of other tools or other accounts.

## What "suspended" does

Everything happens in one place, `_shared/outer-control-containment.ts`:

1. **The tool row is marked** (`suspended_at`, `suspended_reason`) and its first-contact approval is **taken back**
   (`approved_at = null`). Only the first caller to mark it wins, so two sessions raising the same signal suspend it once, record it
   once and alert once.
2. **Its work in flight is closed with a reason** through `stopToolWork()`, the same function that removing a tool uses: sessions
   that use it as their tool end as `stopped` (the session that raised the signal is finished by the engine itself), and a session
   that only had it as a fallback keeps going without one. Tasks whose later steps depended on it move on or wait for a person, as
   they do when a tool is removed.
3. **Nothing new can reach it.** The session engine stops at the first step of any session aimed at it, before the first-contact
   approval (so an automatic approval can not wave it through). Starting a session, a Task or a goal with it, using it as a fallback
   and its connection test are all refused. The scheduled connection test already skips tools without an approval.
4. **It is recorded**: a `containment` evidence row with the tool, the trigger and the number of sessions stopped.
5. **The owner is told** with the `outer_control_tool_suspended` alert, which also opens an incident.

## What is not touched

The account's other tools, their sessions and Tasks, the agents, the websites, the API keys, the Control Gate and the rules.
Suspension is per tool. An account-wide stop is a different, deliberate switch that already exists (the account kill switch).
NazAI's own agent, report writer and starter tools are not suspended by this (they run inside NazAI for the account).

## Coming back

Only the owner brings a tool back: **Resume** on the tool in Outer Control (`resume_tool` in `outer-control-drive`, signed in as the
account). Resuming records a `containment` row with the owner as the actor and **starts the count of unsafe signals over**
(`resumed_at`), so the signals that stopped the tool do not stop it again. The first-contact approval stays taken back, so the next
contact needs a fresh approval. A tool that is still unsafe is suspended again on its next signal.

## Other stops that already exist

| What | Stops | How it comes back |
|---|---|---|
| Account kill switch / agent kill switch / platform kill switch | everything of the account, one agent, or everything | a person turns it off |
| `control-api-abuse-sweep` | one API key that looks abused (volume, block rate) | the pause ends, or the owner revokes the key |
| Integration revocation sweep | a connected service whose token was revoked | the owner reconnects |
| Webhook retry sweep | a webhook that kept failing | the owner fixes the endpoint |
| Removing a tool | the tool and its sessions, its stored key is deleted | add it again |
| Spend guard and circuit breakers | an account over its limit, a failing provider | the limit or the failure clears |

## Limits

- The two signals are what NazAI can detect itself. A tool that is compromised but answers politely is not detected by this; the
  rules, the held-content gate and the owner's review still apply to what it says.
- A step already in flight when the tool is suspended (its HTTP request is on the wire) is not interrupted; its reply is still
  checked like any other, and the session stops afterwards.
- Detection is per tool. A key that is leaked and used from outside is handled by `control-api-abuse-sweep` and revoking the key.
