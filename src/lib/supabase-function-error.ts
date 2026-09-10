// supabase-js's FunctionsHttpError always carries the literal message "Edge
// Function returned a non-2xx status code" -- it never surfaces the actual
// JSON body an edge function returned (e.g. {"error": "rate_limited"}).
// Left unhandled, every failure mode of every functions.invoke() call shows
// this same unhelpful generic text instead of the real reason -- this is
// exactly what a Figma app reviewer saw and quoted verbatim in an app
// rejection when figma-oauth-start failed for an unrelated reason.
import { FunctionsHttpError } from "@supabase/supabase-js";

export async function extractFunctionErrorMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  try {
    const body = await error.context.json();
    const message = (body as { error?: string; message?: string } | null)?.error
      ?? (body as { error?: string; message?: string } | null)?.message;
    return typeof message === "string" && message ? message : null;
  } catch {
    return null;
  }
}
