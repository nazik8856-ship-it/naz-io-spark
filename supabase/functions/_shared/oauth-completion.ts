// User & data isolation, front 4: a tool connection is finished only by the account that started it.
//
// The provider sends the person's browser to the public callback with ?code & ?state. The callback no longer finishes the connection
// on that request (anyone can be lured into following such a link). Instead:
//   GET   (from the provider)  → hands the browser back to the app's /oauth/complete page with the same parameters; nothing is used up.
//   POST  (from that page)     → carries the signed-in person's token. The connection is finished only if that person is the one who
//                                started it (peek_oauth_transaction); a different person gets 403 and the state stays unused.
// Everything after the gate in each callback is the code that was there before; only its answer changes shape (JSON for the page).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCaller } from "./caller.ts";
import { isAllowedRedirectOrigin, oauthCallbackPage, safeRedirectOrigin, type OAuthCallbackPageOptions } from "./oauth-callback-page.ts";

const CORS_HEADERS = "authorization, x-client-info, apikey, content-type";

export type PeekFn = (provider: string, state: string) => Promise<{ user_id: string; request_origin: string | null } | null>;

const corsFor = (req: Request): Record<string, string> => {
  const origin = req.headers.get("Origin");
  return isAllowedRedirectOrigin(origin)
    ? { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Headers": CORS_HEADERS, "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" }
    : {};
};

/** The page that finishes a connection sends POST; the provider's redirect is a GET. */
export const isCompletion = (req: Request) => req.method === "POST";

export const completionJson = (req: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsFor(req) } });

/** The answer of a callback: the old result page for the provider's redirect, JSON (same fields the page posts to the app) for the app. */
export function oauthResponse(req: Request, opts: OAuthCallbackPageOptions, status = 200): Response {
  if (isCompletion(req)) return completionJson(req, { source: opts.source, ok: opts.ok, title: opts.title, message: opts.message, ...(opts.extra || {}) }, status);
  return new Response(oauthCallbackPage(opts), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Where the app's finishing page lives, and what the browser carries there: every parameter the provider sent, plus which provider. */
export function completionRedirect(appOrigin: string | null | undefined, provider: string, search: URLSearchParams): string {
  const dest = new URL("/oauth/complete", safeRedirectOrigin(appOrigin));
  dest.searchParams.set("provider", provider);
  for (const [k, v] of search) if (k !== "provider") dest.searchParams.set(k, v);
  return dest.toString();
}

export type GateOptions = {
  provider: "slack" | "canva" | "notion" | "shopify" | "gmail" | "figma";
  /** For states that carry the app's address inside the signed state (Gmail, Figma). */
  originFromState?: (state: string) => Promise<string | null>;
  /** Tests give their own; the default asks the database as the server. */
  peek?: PeekFn;
  /** Tests give their own; the default checks the sign-in token. */
  who?: (req: Request) => Promise<string | null>;
};

const defaultPeek: PeekFn = async (provider, state) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("peek_oauth_transaction", { _provider: provider, _state: state });
  // a failed lookup is not "no such connection": it must stop the request, never let it through unchecked
  if (error) throw new Error(`peek failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { user_id: row.user_id as string, request_origin: (row.request_origin as string | null) ?? null } : null;
};

const defaultWho = async (req: Request): Promise<string | null> => {
  const r = await requireCaller(req, (h) => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: h } } }));
  return r.ok ? r.caller.userId : null;
};

/** Returns a response when the gate handles the request itself; null means "carry on with the callback's own code". */
export async function oauthGate(req: Request, o: GateOptions): Promise<Response | null> {
  const peek = o.peek ?? defaultPeek;
  const url = new URL(req.url);
  const state = url.searchParams.get("state");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsFor(req) });

  if (req.method === "GET") {
    // no state: the callback's own page explains it ("Invalid callback")
    if (!state) return null;
    let origin: string | null = null;
    try { origin = (await peek(o.provider, state))?.request_origin ?? null; } catch { /* fall through to the signed state */ }
    if (!origin && o.originFromState) { try { origin = await o.originFromState(state); } catch { origin = null; } }
    return new Response(null, { status: 302, headers: { Location: completionRedirect(origin, o.provider, url.searchParams), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }

  if (req.method === "POST") {
    const me = await (o.who ?? defaultWho)(req);
    if (!me) return completionJson(req, { ok: false, message: "Sign in to NazAI in this window to finish connecting." }, 401);
    let started: { user_id: string } | null = null;
    try { started = state ? await peek(o.provider, state) : null; }
    catch { return completionJson(req, { ok: false, message: "Could not check this connection just now. Please try again." }, 503); }
    // no such state (used, expired, made up): the callback's own code answers that
    if (!started) return null;
    if (started.user_id !== me) {
      return completionJson(req, { ok: false, message: "This connection was started from a different NazAI account, so it was not completed. Open NazAI with that account to connect it." }, 403);
    }
    return null;
  }

  return new Response("Method not allowed", { status: 405 });
}
