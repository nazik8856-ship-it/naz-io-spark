import { resolveWelcomeEmailRecipient, sendWelcomeEmail } from "@/lib/send-welcome-email";

type AuthUserLike = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: Array<{ identity_data?: Record<string, unknown> | null }> | null;
};

type AuthDataLike = {
  user?: AuthUserLike | null;
  session?: { user?: AuthUserLike | null } | null;
} | null | undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const stringifyForDebug = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `[unserializable auth object: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

export async function forceSendWelcomeEmailAfterAuth(params: {
  data?: AuthDataLike;
  fallbackEmail?: string | null;
  fallbackName?: string | null;
  source: string;
}): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  const data = params.data ?? null;
  const user = data?.user ?? data?.session?.user ?? null;
  const session = data?.session ?? null;
  let userEmail = readString(user?.email) || readString(session?.user?.email) || readString(data?.user?.email);

  console.log("=== SIGN-UP SUCCESS DEBUG ===");
  console.log("Full user object:", stringifyForDebug(user));
  console.log("Session object:", stringifyForDebug(session));
  console.log("Extracted user email:", userEmail);

  if (!userEmail) {
    console.error("ERROR: No email found in auth response");
    userEmail = readString(params.fallbackEmail);
    if (userEmail) {
      console.warn("Using sign-up form email fallback for welcome email:", userEmail);
    }
  }

  console.log("Attempting to send welcome email...");

  const recipient = resolveWelcomeEmailRecipient({
    authData: data,
    fallbackEmail: userEmail ?? params.fallbackEmail,
    fallbackName: params.fallbackName,
    source: params.source,
  });
  const finalEmail = recipient.email ?? userEmail ?? readString(params.fallbackEmail);

  try {
    const welcomeResult = await sendWelcomeEmail({
      email: finalEmail,
      name: recipient.name,
      userId: recipient.userId,
      source: params.source,
    });

    if (!welcomeResult.ok) {
      console.error("Welcome email FAILED:", welcomeResult);
      return welcomeResult;
    }

    console.log("Welcome email sent successfully to:", finalEmail);
    return welcomeResult;
  } catch (error) {
    console.error("Welcome email FAILED:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}