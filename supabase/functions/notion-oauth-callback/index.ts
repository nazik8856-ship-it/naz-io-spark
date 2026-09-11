// notion-oauth-callback — Notion redirects here with ?code & ?state. We
// atomically consume the server-side transaction, exchange the code for an
// access token via Basic Auth (base64 of client_id:client_secret), then
// upsert per workspace keyed on (user_id, provider="Notion",
// metadata->>'workspace_id') so a user connecting multiple workspaces gets
// one row per workspace instead of overwriting the previous one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { exchangeCode } from "../_shared/notion.ts";
import { createSecret, updateSecret } from "../_shared/integration-secrets.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { oauthCallbackPage } from "../_shared/oauth-callback-page.ts";

// Confirmed zero rate-limit coverage. Public/unauthenticated endpoint, so
// there's no real userId to key on until AFTER the one-time transaction is
// consumed below.
const RATE_LIMIT_PER_MINUTE = 10;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  // Set once the transaction is consumed below -- the origin captured at
  // OAuth-start time, used as the redirect-back target if this page has no
  // window.opener (see oauth-callback-page.ts's own doc comment for why).
  let redirectOrigin: string | null = null;
  const respond = (title: string, msg: string, ok: boolean, workspace?: string, status = 200) =>
    new Response(
      oauthCallbackPage({ title, message: msg, ok, source: "nazai-notion-oauth", redirectOrigin, extra: { workspace: workspace || "" } }),
      { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  if (errParam) return respond("Notion connection cancelled", errParam, false, undefined, 400);
  if (!code || !state) return respond("Invalid callback", "Missing code or state.", false, undefined, 400);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows, error: txErr } = await admin.rpc(
      "consume_notion_oauth_transaction",
      { _state: state },
    );
    const tx = Array.isArray(rows) ? rows[0] : null;
    if (txErr || !tx) {
      return respond("Invalid state", "OAuth state is invalid, expired, or already used. Please try again.", false, undefined, 400);
    }
    redirectOrigin = typeof tx.request_origin === "string" ? tx.request_origin : null;
    const userId = tx.user_id as string;

    const rate = await checkRateLimit(admin, userId, "notion-oauth-callback", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return respond("Too many requests", "Too many connection attempts for this account. Try again shortly.", false, undefined, 429);
    }

    const tok = await exchangeCode(code);
    const workspaceId = tok.workspace_id || "";
    const workspaceName = tok.workspace_name || "Notion workspace";
    if (!workspaceId) {
      return respond("Notion connection failed", "Notion did not return a workspace id.", false, undefined, 500);
    }
    const now = new Date().toISOString();

    const credentials: Record<string, unknown> = {
      access_token: tok.access_token,
      token_type: tok.token_type || "bearer",
      bot_id: tok.bot_id || null,
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      workspace_icon: tok.workspace_icon || null,
      owner: tok.owner || null,
      account_name: workspaceName,
    };

    // Upsert per workspace: keyed on (user_id, provider="Notion", metadata->>'workspace_id').
    const { data: existing } = await admin
      .from("agent_integrations")
      .select("id, credentials_secret_id, metadata")
      .eq("user_id", userId)
      .eq("provider", "Notion")
      .is("agent_id", null)
      .contains("metadata", { workspace_id: workspaceId })
      .maybeSingle();

    let secretId: string | null = (existing?.credentials_secret_id as string | null) ?? null;
    if (secretId) {
      await updateSecret(admin, secretId, credentials);
    } else {
      secretId = await createSecret(admin, credentials, `notion-${userId}-${workspaceId}`);
    }

    const integrationRow = {
      user_id: userId,
      agent_id: null,
      provider: "Notion",
      credentials_secret_id: secretId,
      metadata: {
        workspace_id: workspaceId,
        workspace_name: workspaceName,
        workspace_icon: tok.workspace_icon || null,
        bot_id: tok.bot_id || null,
        account_name: workspaceName,
      },
      status: "connected",
      last_verified_at: now,
      last_error: null,
      revoked_alerted_at: null,
    };
    const persistence = existing?.id
      ? admin.from("agent_integrations").update(integrationRow).eq("id", existing.id)
      : admin.from("agent_integrations").insert(integrationRow);
    const { error: pErr } = await persistence;
    if (pErr) throw new Error(pErr.message);

    return respond(
      "Notion connected",
      `Connected to ${workspaceName}.`,
      true,
      workspaceId,
      200,
    );
  } catch (e) {
    return respond("Notion connection failed", e instanceof Error ? e.message : "Unknown error", false, undefined, 500);
  }
});
