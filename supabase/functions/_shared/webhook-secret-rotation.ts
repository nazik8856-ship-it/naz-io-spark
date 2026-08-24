// Pure logic for outbound webhook secret rotation.
//
// webhooks.secret was rotatable only via an in-place UPDATE with zero
// overlap (breaks the receiver until it updates its own copy in lockstep)
// or delete-and-recreate (loses the webhook id and its webhook_deliveries
// history). rotate_webhook_secret() (see the migration) now moves the old
// secret into previous_secret with a bounded expiry instead of discarding
// it, and every delivery signs with BOTH secrets while the grace window is
// open -- the receiver can swap in the new secret whenever suits them,
// without a hard cutover moment where deliveries start failing.

export type RotatableSecretHook = {
  secret: string;
  previous_secret?: string | null;
  previous_secret_expires_at?: string | null;
};

/** Whether the just-rotated-out secret is still inside its grace window. */
export function previousSecretActive(hook: RotatableSecretHook, now: Date = new Date()): boolean {
  return !!(
    hook.previous_secret &&
    hook.previous_secret_expires_at &&
    new Date(hook.previous_secret_expires_at).getTime() > now.getTime()
  );
}
