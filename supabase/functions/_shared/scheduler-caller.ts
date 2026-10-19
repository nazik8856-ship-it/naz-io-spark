// agent-runtime is reachable without a user login (verify_jwt = false) because webhooks call it. The scheduler and Outer Control
// start runs for a user by sending that user's id in "x-scheduler-user-id". That header is only believed when the same request
// also proves it comes from the platform itself: its Authorization header is the service role key. Without that, anyone on the
// internet could name another account's id and run its agents.
import { timingSafeEqual } from "./timing-safe.ts";

export type SchedulerCaller = { kind: "none" } | { kind: "platform"; userId: string } | { kind: "forged" };

export function resolveSchedulerCaller(authHeader: string, schedulerUserId: string, serviceKey: string): SchedulerCaller {
  const claimed = schedulerUserId.trim();
  if (!claimed) return { kind: "none" };
  if (!serviceKey) return { kind: "forged" };
  return timingSafeEqual(authHeader, `Bearer ${serviceKey}`) ? { kind: "platform", userId: claimed } : { kind: "forged" };
}
