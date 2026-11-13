# Incident response and support procedures

What to do when something goes wrong, in plain steps, for the owner. It uses what NazAI already has (suspend, kill switches, the signed
security record) and says plainly what it does **not** have yet. It never contains a secret value: keys live in the owner's password
manager (Bitwarden notes `NazAI DATA_KEY` and `NazAI PROJECTS_KEY`).

Related: `docs/compromise-containment.md` (what stops what), `docs/security-evidence.md` (the signed record),
`docs/secrets-rotation.md` (replacing a secret), `docs/two-step-sign-in.md`, `docs/data-isolation.md`.

## 1. The first fifteen minutes, for any incident

1. **Write down the time and what you saw** (a note is enough). Do not delete anything: logs, evidence and rows are what lets us find out what happened.
2. **Stop the spread, smallest stop first.**

   | What looks wrong | Smallest stop | Where |
   |---|---|---|
   | One connected tool behaves badly | Suspend it (it happens by itself on an unsafe signal) | Outer Control → the tool; Resume is owner-only |
   | One API key is abused or leaked | Revoke the key (a new one is made after) | API keys screen (`api-keys`) |
   | One agent does something unwanted | Agent kill switch | Control System → Spend & safety → Kill switch |
   | A whole account must stop | Account kill switch | Control System → Spend & safety → Kill switch |
   | Everything must stop (platform) | Platform kill switch (staff role) | Control System → Spend & safety → Kill switch |
   | A connected service's token leaked | Disconnect it (the token is revoked at the provider) | Integrations |

3. **Check what the system recorded**, signed in as the account: `select * from my_security_activity(30)` (counts per kind and verdict) and,
   for the whole chain, `select * from verify_evidence_chain()` (an empty answer means the chain is intact). The weekly checks
   (`isolation_report()`, `secrets_exposure_report()`, `encryption_report()`) must all be empty.
4. **Decide the size.** Own account only and no customer data involved: fix it and note it. Customer data may have been seen by someone
   else: go to section 5 (telling customers) as soon as you know that, not when you know everything.

## 2. If the owner's own access is lost or taken

The accounts that can change NazAI, and where each one is recovered:

| Account | Protects | If the phone is lost | If it is taken over |
|---|---|---|---|
| GitHub | all code; functions load from it | the recovery codes in Bitwarden | change the password, revoke sessions and tokens (Settings), review the repo's recent commits and the `protect main` ruleset |
| Supabase | database, secrets, functions | the second authenticator (Bitwarden) or its text key | change the password, remove other sessions, then rotate what it can reach (section 3) |
| Vercel | the website | passkey / recovery codes | same; check deployments and environment variables |
| Google | how people sign in to NazAI | backup codes in Bitwarden | Security Checkup, remove unknown devices and third-party access |
| Namecheap | the domain nazai.net | recovery codes in Bitwarden | change the password, check the nameservers and DNS records, keep Domain Lock on |
| Bitwarden | all of the above | its own recovery sheet, kept offline | change the master password, rotate everything it held |

NazAI's own two-step sign-in has **recovery codes** (8, single use, shown once when it is turned on; `docs/two-step-sign-in.md`). Keep them
in Bitwarden. If the owner loses that phone, the sign-in screen's "Lost your phone? Use a recovery code" turns it off and the owner sets it up
again. With no code left, a project admin removes the factor in the Supabase dashboard (Authentication → Users → the user → remove the MFA
factor). A second owner account would make this routine; it does not exist yet (see section 7).

## 3. If a secret leaked

Replace it with the matching procedure in `docs/secrets-rotation.md`: encryption keys, the Resend key and webhook secret, the
server's full-access key, the AI provider keys, the OAuth client secrets. Decision signing keys are never deleted, only versioned.
After rotating, check the function logs for the secret's name (they must be silent) and run the three weekly checks.

If it is **a customer's** secret (a tool key, an integration token, an API key): the customer rotates it with the buttons they have
(`docs/secrets-rotation.md`, end), or you do it for them after they ask.

## 4. Support procedures for account problems

All of them start the same way: **confirm it is the account owner.** Reply to the address the account was created with, and ask for
something only they would know (when they signed up, what their first agent is called). Never act on a request that arrives from a
different address. Record what you did (date, account, what, why) in a note kept with these documents.

### A customer is locked out (lost phone, two-step sign-in)

1. Ask first whether they saved their recovery codes: on the sign-in code screen, **Lost your phone? Use a recovery code** lets them back in by themselves (it turns two-step sign-in off; they turn it on again and save new codes). Nothing for you to do.
2. No code left: confirm the owner as above, then reset it as a platform owner (signed in with your own two-step sign-in): call the `mfa-recovery` function with `{"action":"support_reset","user_id":"<their account id>","reason":"lost_phone"}`. It removes their authenticator apps and codes and writes who did it to their signed security record. (The Supabase dashboard, Authentication → Users → the account → remove the MFA factor, also works but is not recorded.)
3. Tell the customer to sign in and set two-step sign-in up again, and to save the new recovery codes.
4. Check `my_security_activity` for that account afterwards: no refused-access spike, nothing unusual. Many `access_refused` rows with door `mfa_recovery` mean someone is guessing codes.

### A customer thinks the account was taken over

1. Confirm the owner. Act first, explain after.
2. Revoke the account's API keys and suspend its connected tools (Outer Control); turn the account kill switch on if agents are acting.
3. In Supabase, sign the account's sessions out and have the customer set a new password (and remove and re-add two-step sign-in).
4. Read the account's `security_evidence` (what was contacted, what was blocked, what changed) to see what the other person did.
5. The customer reconnects tools with new keys; you turn the kill switch off once the keys are new.
6. If the other person saw customer data, go to section 5.

### A customer asks for their data to be deleted

What the **"request deletion" button does today:** after 7 days it deletes the governance data of that account: decisions, rules,
incidents, spend history, audit trail, approvals and webhooks (`data-deletion-sweep`). The customer can cancel during the 7 days.

What it does **not** do: it keeps the agents and team members, the login itself, and every table without a link to the login
(projects, imported projects, missions, website pages and form submissions, the Credits ledger, tool records and others). So it is
**not** a complete erasure, and you must not tell a customer it is. Until a complete erasure exists (section 7):

1. Confirm the owner, then tell them exactly what will be removed and what must stay (the signed security record keeps no content, and
   financial records may have to stay; ask an advisor for the rule that applies).
2. Do the deletion yourself in this order: connected tools and integrations (their stored keys are removed with them), API keys, websites
   and their images, projects, then the governance deletion, then the login. After each step run `isolation_report()` on the account.
3. Write down what was deleted and when, and tell the customer when it is done.

## 5. Telling customers

- **When:** as soon as you know customer data may have been seen or changed by someone else, even if you do not know how yet. Say what you
  know, what you do not, and when you will write again.
- **What to say:** what happened, which of their data was involved, what you already did (stopped, rotated, reviewed), what they should do
  (new passwords, new keys, check their tools), and how to reach you. No guesses, no blame, no secret values.
- **Who else:** if the data includes personal data of people in the EU, the data protection authority has to be told within 72 hours of
  learning about a breach, and the affected people when the risk to them is high. Confirm the exact duty with a lawyer; do not guess.

## 6. After every incident

1. Write what happened, how it was found, what was done, how long each step took.
2. Fix the cause, then add a check that would catch it next time (a test, a weekly report line, an alert).
3. Run the three weekly checks and `verify_evidence_chain()` again, and note that they are clean.
4. Update this document if a step was missing or wrong.

## 7. Known gaps (so nobody is surprised)

| Gap | Effect today | Planned |
|---|---|---|
| Owner-assisted reset has no button | it is a function call (section 4) | a small screen for platform owners |
| No complete account erasure | the deletion button removes governance data only | one complete erasure with a test that fails when a new table is missed |
| No second owner account | recovering the owner's own login depends on one person and the Supabase dashboard | decide with the owner |
| Supabase Free plan | no automatic Supabase backups; only the governance backups exist | move to Pro before launch, then do a test restore |
| Webhook and other customer secrets | customers rotate them with their own buttons | none needed |
