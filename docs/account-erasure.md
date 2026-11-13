# Complete account erasure

A customer can delete their whole account: **Account settings → Delete my account**. It waits 7 days (cancel any time), then removes everything that belongs to the person. This replaces the old situation where "request deletion" removed governance data only (that button, on the Control System's *Account data* page, still exists and still removes only governance data).

## What happens

1. The person types `DELETE MY ACCOUNT` (the screen lists what goes and what stays) and presses **Schedule deletion**. This needs a session that passed the two-step code, if they use it (`request_account_erasure()`); platform staff accounts (roles `owner`, `admin`) are refused. A `data_deletion_requests` row with `scope = 'account'` is created, `execute_at` = now + 7 days. **Cancel deletion** (same screen) sets it to `cancelled`.
2. The daily `data-deletion-sweep` (05:00 UTC) picks up due requests. For `scope = 'account'` it calls `eraseAccount()` (`supabase/functions/_shared/account-erasure.ts`):
   - every connected service is cancelled at its provider, the same way the Disconnect button does it (`disconnectIntegration`); a provider that is down never stops the erasure;
   - then the database function `erase_account(user_id)` runs.
3. `erase_account()` works in **one transaction**, from the register `isolation_tables` (not from a list of names, so a new owner table is covered automatically):
   1. every registered owner table is emptied explicitly (children before parents; repeated until nothing is left), except the change log and the signed record;
   2. the person as a member of other accounts, and invitations to their address (`account_members`);
   3. rows kept by address: the mail log and unsubscribe links (`email_send_log`, `email_unsubscribe_tokens`, `free_limit_exempt_emails`);
   4. stored secrets that belong to the person (`vault.secrets` via `vault_secret_owners`);
   5. the change log (`config_changes`), last, because emptying the other tables writes to it;
   6. the login (`auth.users`): sessions, authenticator apps and recovery codes go with it;
   7. the signed security record (`security_evidence`, `security_evidence_heads`), which can be removed only once the account no longer exists;
   8. **proof:** every registered owner table is counted for that person; one row left raises an error and **the whole erasure is undone**.
   Then one row goes to `account_erasures`: a SHA-256 of the id, the date, and row counts per table. Nothing that names the person.
4. If the erasure fails, the request stays `pending` and the next daily run tries again; the failure is in the function logs (`[data-deletion-sweep] account erasure failed`).

## What stays, and why

| Kept | Why |
|---|---|
| The address on `suppressed_emails`, if the person ever unsubscribed | so the opt-out keeps being honoured |
| Encrypted daily governance backups, up to **30 days** | they age out by themselves (`governance-backup-export`, retention 30 days); a restore within that window would bring the data back, so a restore after an erasure must re-run the erasure (`account_erasures` lists who) |
| Files in storage | removed by the daily `site-images-cleanup-sweep` once the account is gone: site pictures after 1 day, private uploads after 7 days |
| Records the law requires (for example invoices once payments exist) | not applicable yet; to be decided with an advisor before payments start |
| `account_erasures` rows | proof an erasure happened; nothing that names anyone |

## Checks

- `isolation_report()` (weekly) includes `erasure_missing`: any table that names a person (a `user_id`-like column, or an email column) that is not an owner table in the register and not on the handled list inside `erasure_gaps()`. A new table either gets registered with its owner column (and is then covered) or is added to the handled list with a decision. It is empty today.
- `src/test/account-erasure.test.ts`: the shape of the function, the order of deletion, the self-check, the request rules, the sweep and the screen.
- `_shared/account-erasure_test.ts` (Deno): revocation before erasure, a failing provider, a refusing database.
- **Live test, 2026-11-13** (in a transaction that was rolled back, on two real accounts, one with 4 websites and tens of thousands of alert and mail rows): every owner table was empty for that account afterwards, the login, the signed record and the vault entries were gone, the evidence chain still verified, and a platform staff account was refused. The first run found a real fault (deleting the login fired change-log triggers for the user being removed); the order of deletion above is the fix.

## Not covered

- Third parties NazAI sent data to before erasure (a model provider, the mail provider) keep their own copies under their own terms.
- Anything exported by the customer.
- A person's rows in someone else's account that are not theirs (a note a team member wrote in the owner's account stays with the owner; `account_members` rows for the person go).
