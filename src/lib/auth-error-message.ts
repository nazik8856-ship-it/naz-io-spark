// @supabase/auth-js builds its error message from the server's JSON error
// body (msg/message/error_description/error). When none of those fields
// exist -- an error response whose body is empty or unrecognized, e.g. `{}`
// -- it falls back to JSON.stringify(body), producing a raw, unreadable
// string like "{}" that must never reach a user-facing toast. This catches
// that shape (and any other bare JSON blob) and replaces it with an honest,
// readable fallback instead of guessing at what the server meant.
const GENERIC_AUTH_ERROR = "Something went wrong on our end. Please try again in a moment.";

export function sanitizeAuthErrorMessage(message: string | null | undefined): string {
  const trimmed = (message ?? "").trim();
  if (!trimmed || trimmed === "{}" || trimmed === "null" || trimmed === "undefined") {
    return GENERIC_AUTH_ERROR;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      JSON.parse(trimmed);
      return GENERIC_AUTH_ERROR;
    } catch {
      // Looked like JSON but wasn't valid — a real (if oddly-formatted)
      // message, so show it as-is rather than over-suppressing.
    }
  }
  return trimmed;
}
