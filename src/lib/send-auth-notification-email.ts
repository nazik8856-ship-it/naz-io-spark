import { supabase } from "@/integrations/supabase/client";

/**
 * Fires the "you signed in" / "your password was changed" security notices.
 * Both always run with an active session (post-sign-in, post-password-update),
 * so this goes through send-transactional-email's normal session-authenticated
 * path rather than send-welcome-resend's anon-key workaround for session-less
 * signups. Best-effort only — never throws, never blocks the caller's own flow.
 */
async function sendAuthNotification(
  templateName: "sign-in-notification" | "password-changed",
  email: string | null | undefined,
  templateData: Record<string, unknown>,
): Promise<void> {
  if (!email) return;
  try {
    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName,
        recipientEmail: email,
        templateData: { email, timestamp: new Date().toISOString(), ...templateData },
      },
    });
    if (error) console.error(`[auth-notification] ${templateName} failed:`, error.message);
  } catch (err) {
    console.error(`[auth-notification] ${templateName} threw:`, err instanceof Error ? err.message : err);
  }
}

export const sendSignInNotification = (email: string | null | undefined, method: "password" | "google" | "apple") =>
  sendAuthNotification("sign-in-notification", email, { method });

export const sendPasswordChangedNotification = (email: string | null | undefined) =>
  sendAuthNotification("password-changed", email, {});
