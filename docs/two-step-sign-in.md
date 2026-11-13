# Two-step sign-in (authenticator app)

A person can add a 6-digit code from an authenticator app (TOTP) to their sign-in. It is their own choice, in **Account settings → Two-step sign-in**. The owner and admin accounts should turn it on.

## What it does

| Where | Rule |
|---|---|
| Website | After sign-in, a person who has a confirmed authenticator app sees "Confirm it's you" until they type a code (`AuthGuard` → `MfaChallenge`). |
| Database | For the `owner` and `admin` roles, `has_role()` answers true only for a session that passed the code (`aal2`), once that person has a confirmed factor. A stolen password or a hijacked Google session (`aal1`) gets nothing an owner or admin can reach. |
| Server functions | `requireCaller` (`supabase/functions/_shared/caller.ts`) refuses a session that has not used the code (`aal1`) when the person has a confirmed authenticator app, with reason `mfa_required` (HTTP 401). So the website's code screen can not be skipped by calling a function directly. The check costs nothing extra: the sign-in service's `getUser()` already returns the person's factors. |
| Turning it off | Needs a session that passed the code. Supabase refuses to remove a confirmed factor from an `aal1` session, so the protection cannot be switched off by whoever only has the password. |
| Customers' own data rows | Every table that holds an account's data (all `owner`, `team`, `self` and `membership` tables in `isolation_tables`) carries a second, **restrictive** row rule, `two_step_required`: `USING ((SELECT session_mfa_ok()))`. A person with a confirmed authenticator app who is in a first-step session (`aal1`) sees and changes nothing, even by calling the database interface directly. Tables that are public by link keep their public reading; only their writes carry the rule (`two_step_required_insert/update/delete`). The weekly `isolation_report()` fails (`two_step_missing`) when a table is added without it. |

**Database functions.** A function that runs as the database owner (`SECURITY DEFINER`) ignores row rules, so the ones a signed-in person can call and that act for them (`get_business_context`, `request_data_deletion`, `rotate_webhook_secret`, `my_security_activity`, the approval and policy functions and others) start with the same check (`IF NOT session_mfa_ok() THEN RAISE …`, migration `20261113031304`). The weekly `isolation_report()` fails (`two_step_missing_function`) when such a function is added without it.

`session_mfa_ok()` is true for: visitors, the server key and database jobs, an `aal2` session, and a person with no confirmed factor. It is false only for a first-step session of a person who has the app on.

Not covered: files in storage (their rules are separate and none depends on a table that holds account data), and the sign-in service's own endpoints.

Not affected: people without a confirmed factor, the `user` role, the server key and database jobs (they have no sign-in).

## Set up

1. Account settings → **Set up**.
2. Scan the picture with an authenticator app (or type the key it shows).
3. Type the 6-digit code → **Turn on**.

## If the phone is lost

**Recovery codes.** When two-step sign-in is turned on, 8 single-use recovery codes are made and shown once (copy, download, "I saved them"). They are 16 characters (about 79 bits), kept only as SHA-256 hashes with the account id mixed in (`mfa_recovery_codes`; nobody, the server key included, can read the table directly). **Account settings → Make new recovery codes** replaces the whole set; the old codes stop working.

On the code screen, **Lost your phone? Use a recovery code**:

1. The person signs in with their password or Google as usual (first step), then types a code.
2. A good code works once. It turns two-step sign-in **off** (every authenticator app on the account and the remaining codes are removed) and signs the person in with their sign-in method alone. They are asked to turn it on again and save new codes.
3. Five wrong tries in fifteen minutes lock the door for fifteen minutes. Each wrong try is an `access_refused` row, each success a `credential_change` row (`removed_by_recovery_code`) in the person's signed security record.

`mfa-recovery` is the only server function that serves a first-step session, and only for this one action (`use`). `status`, `generate` and `support_reset` need the code.

**Owner-assisted reset** (no code left): a platform owner calls `mfa-recovery` with `{"action":"support_reset","user_id":"…","reason":"lost_phone"|"takeover"|"other"}` signed in with their own two-step sign-in. The database checks the owner role again, refuses a reset of oneself, and writes a `removed_by_support` row to the customer's chain with the owner's id as the actor. There is no button for it yet; removing the factor in the Supabase dashboard still works but is **not recorded**, so prefer the call.

Keep a backup of the "Can't scan?" key in a password manager too.

## Checks

`src/test/two-step-sign-in.test.ts`: step logic, code cleaning, wording, the page gate (a failing check never locks a person out of the website; the database rule still holds), the shape of the `has_role` rule, the restrictive rules, the recovery tables and functions, and the screens. `supabase/functions/_shared/recovery-codes_test.ts` and `caller_test.ts` (Deno): code generation, reading back, hashing, and the single `allowFirstStep` door.

Live check after the migration is applied: a user with no factor still passes `has_role` (unchanged); with a confirmed factor, an `aal1` token fails `has_role(..., 'owner')` and an `aal2` token passes.

Live check on 2026-11-13, in a transaction that was rolled back: a person without a factor sees their own profile at `aal1`; with a confirmed factor, `aal1` sees 0 rows and changes 0 rows, `aal2` sees the row, a visitor passes `session_mfa_ok()`. Recovery: replace gives 2 codes, a wrong code is refused, the sixth try within the window answers `locked`, a good code removes the factor and all codes, a second use answers `no_factor`; `support_remove_two_step` refuses a self-reset and a non-owner; all steps appear in the evidence chain, and a signed-in user is refused when calling the recovery functions directly (permission denied).
