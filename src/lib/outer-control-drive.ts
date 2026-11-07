// Calls the outer-control-drive edge function with the signed-in user's token.
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { showLimitIfAny } from "@/lib/limit-window";

export type DriveResult = {
  ok: boolean;
  // deno-lint-ignore no-explicit-any
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  message: string;
  /** A free usage limit refused it; the limit window is already open, so the caller shows nothing else. */
  limited?: boolean;
};

export async function callDrive(action: string, payload: Record<string, unknown>): Promise<DriveResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? SUPABASE_ANON;
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/outer-control-drive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && showLimitIfAny(data)) return { ok: false, data, message: data?.message || "", limited: true };
    return { ok: resp.ok && data?.ok !== false, data, message: data?.message || data?.error || "" };
  } catch {
    return { ok: false, data: null, message: "Could not reach Outer Control. Try again." };
  }
}
