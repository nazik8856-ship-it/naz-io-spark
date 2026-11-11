# Two-step sign-in (authenticator app)

A person can add a 6-digit code from an authenticator app (TOTP) to their sign-in. It is their own choice, in **Account settings → Two-step sign-in**. The owner and admin accounts should turn it on.

## What it does

| Where | Rule |
|---|---|
| Website | After sign-in, a person who has a confirmed authenticator app sees "Confirm it's you" until they type a code (`AuthGuard` → `MfaChallenge`). |
| Database | For the `owner` and `admin` roles, `has_role()` answers true only for a session that passed the code (`aal2`), once that person has a confirmed factor. A stolen password or a hijacked Google session (`aal1`) gets nothing an owner or admin can reach. |
| Server functions | `requireCaller` (`supabase/functions/_shared/caller.ts`) refuses a session that has not used the code (`aal1`) when the person has a confirmed authenticator app, with reason `mfa_required` (HTTP 401). So the website's code screen can not be skipped by calling a function directly. The check costs nothing extra: the sign-in service's `getUser()` already returns the person's factors. |
| Turning it off | Needs a session that passed the code. Supabase refuses to remove a confirmed factor from an `aal1` session, so the protection cannot be switched off by whoever only has the password. |

Not covered yet: a signed-in person reading their own rows straight from the database (row level security) with an `aal1` token. The 39 functions that use `requireCaller` are covered; direct table reads are not. Closing that means an `aal2` condition on the row level rules for people who have a factor.

Not affected: people without a confirmed factor, the `user` role, the server key and database jobs (they have no sign-in).

## Set up

1. Account settings → **Set up**.
2. Scan the picture with an authenticator app (or type the key it shows).
3. Type the 6-digit code → **Turn on**.

## If the phone is lost

There are no recovery codes. A project admin removes the factor in the Supabase dashboard (Authentication → Users → the user → Remove MFA factor), then the person signs in and sets it up again. This is the same recovery path as any lost second factor: keep two devices or a backup of the key (the "Can't scan?" key) in a password manager.

## Checks

`src/test/two-step-sign-in.test.ts`: step logic, code cleaning, wording, the page gate (a failing check never locks a person out of the website; the database rule still holds), and the shape of the `has_role` rule.

Live check after the migration is applied: a user with no factor still passes `has_role` (unchanged); with a confirmed factor, an `aal1` token fails `has_role(..., 'owner')` and an `aal2` token passes.
