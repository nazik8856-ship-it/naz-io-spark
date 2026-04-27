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
  const userEmail =
    readString(user?.email) ||
    readString(session?.user?.email) ||
    readString(data?.user?.email) ||
    null;

  console.log("=== WELCOME EMAIL FINAL ATTEMPT ===");
  console.log("Extracted email:", userEmail);
  console.log("Full auth data:", stringifyForDebug({ user, session, data }));

  if (!userEmail) {
    console.error("CRITICAL: No email address found in auth response!");
    return { ok: false, error: "missing_email" };
  }

  console.log("Calling sendWelcomeEmail for:", userEmail);

  const recipient = resolveWelcomeEmailRecipient({
    authData: data,
    fallbackEmail: userEmail,
    fallbackName: params.fallbackName,
    source: params.source,
  });
  const finalEmail = recipient.email ?? userEmail;

  try {
    const welcomeResult = await sendWelcomeEmail({
      email: finalEmail,
      name: recipient.name,
      userId: recipient.userId,
      source: params.source,
    });

    if (!welcomeResult.ok) {
      console.error("❌ Welcome email FAILED:", welcomeResult.error || welcomeResult.body || welcomeResult);
      return welcomeResult;
    }

    console.log("✅ Welcome email SENT successfully to", finalEmail);
    return welcomeResult;
  } catch (error) {
    console.error("❌ Welcome email FAILED:", error instanceof Error ? error.message : error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}