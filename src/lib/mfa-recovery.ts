import { supabase } from "@/integrations/supabase/client";

export type RecoveryAnswer<T> = { ok: boolean; data?: T; error?: string };

/** One call to the mfa-recovery function. Failures come back as the function's short error code, never its raw text. */
export async function callRecovery<T = Record<string, unknown>>(action: "status" | "generate" | "use", extra: Record<string, unknown> = {}): Promise<RecoveryAnswer<T>> {
  try {
    const { data, error } = await supabase.functions.invoke("mfa-recovery", { body: { action, ...extra } });
    if (!error) return { ok: true, data: data as T };
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
      if (body?.error) return { ok: false, error: body.error };
    }
    return { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}
