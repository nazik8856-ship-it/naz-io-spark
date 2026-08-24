// slack-oauth-callback — Slack redirects here with ?code & ?state. We
// atomically consume the server-side transaction, exchange the code for a
// bot token (form-encoded, per Slack docs), then upsert per workspace
// keyed on (user_id, provider="Slack", metadata->>'team_id') so the same
// user connecting multiple workspaces gets one row per workspace.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { exchangeCode, fetchTeamInfo, scopesForGroups, SLACK_DEFAULT_GROUPS } from "../_shared/slack.ts";
import { createSecret, updateSecret } from "../_shared/integration-secrets.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

// Confirmed zero rate-limit coverage. Public/unauthenticated endpoint, so
// there's no real userId to key on until AFTER the one-time transaction is
// consumed below.
const RATE_LIMIT_PER_MINUTE = 10;

const html = (title: string, msg: string, ok: boolean, team?: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;color:#e5e5e5;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
  .card{max-width:420px;background:#111;border:1px solid #222;border-radius:12px;padding:28px}
  h1{margin:0 0 8px;font-size:18px;color:${ok ? "#34d399" : "#f87171"}}
  p{margin:0;font-size:14px;line-height:1.5;color:#a3a3a3}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${msg}</p></div>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({ source:"nazai-slack-oauth", ok:${ok}, team:${JSON.stringify(team || "")}, message:${JSON.stringify(msg)} }, "*");
  }
} catch(e){}
setTimeout(function(){ window.close(); }, 120);
</script></body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  const respond = (title: string, msg: string, ok: boolean, team?: string, status = 200) =>
    new Response(html(title, msg, ok, team), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (errParam) return respond("Slack connection cancelled", errParam, false, undefined, 400);
  if (!code || !state) return respond("Invalid callback", "Missing code or state.", false, undefined, 400);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows, error: txErr } = await admin.rpc(
      "consume_slack_oauth_transaction",
      { _state: state },
    );
    const tx = Array.isArray(rows) ? rows[0] : null;
    if (txErr || !tx) {
      return respond("Invalid state", "OAuth state is invalid, expired, or already used. Please try again.", false, undefined, 400);
    }
    const userId = tx.user_id as string;
    const grantedGroups: string[] = Array.isArray(tx.scope_groups) && tx.scope_groups.length
      ? (tx.scope_groups as string[])
      : SLACK_DEFAULT_GROUPS;
    const grantedScopes = scopesForGroups(grantedGroups);

    const rate = await checkRateLimit(admin, userId, "slack-oauth-callback", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) {
      return respond("Too many requests", "Too many connection attempts for this account. Try again shortly.", false, undefined, 429);
    }

    const tok = await exchangeCode(code);
    const teamId = tok.team?.id || "";
    const teamName = tok.team?.name || "Slack workspace";
    if (!teamId) {
      return respond("Slack connection failed", "Slack did not return a team id.", false, undefined, 500);
    }
    const info = await fetchTeamInfo(tok.access_token!, teamId);
    const now = new Date().toISOString();

    const credentials: Record<string, unknown> = {
      access_token: tok.access_token,
      token_type: tok.token_type || "bot",
      scope: tok.scope || grantedScopes.join(","),
      bot_user_id: tok.bot_user_id || null,
      app_id: tok.app_id || null,
      team_id: teamId,
      team_name: teamName,
      team_domain: (info?.domain as string) || null,
      authed_user_id: tok.authed_user?.id || null,
      account_name: teamName,
    };

    // Upsert per workspace: keyed on (user_id, provider="Slack", metadata->>'team_id').
    const { data: existing } = await admin
      .from("agent_integrations")
      .select("id, credentials_secret_id, metadata")
      .eq("user_id", userId)
      .eq("provider", "Slack")
      .is("agent_id", null)
      .contains("metadata", { team_id: teamId })
      .maybeSingle();

    let secretId: string | null = (existing?.credentials_secret_id as string | null) ?? null;
    if (secretId) {
      await updateSecret(admin, secretId, credentials);
    } else {
      secretId = await createSecret(admin, credentials, `slack-${userId}-${teamId}`);
    }

    const integrationRow = {
      user_id: userId,
      agent_id: null,
      provider: "Slack",
      credentials_secret_id: secretId,
      metadata: {
        team_id: teamId,
        team_name: teamName,
        team_domain: (info?.domain as string) || null,
        account_name: teamName,
        bot_user_id: tok.bot_user_id || null,
        granted_scopes: grantedScopes,
        granted_groups: grantedGroups,
        scope: tok.scope || grantedScopes.join(","),
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
      "Slack connected",
      `Connected to ${teamName}. You can close this window.`,
      true,
      teamId,
      200,
    );
  } catch (e) {
    return respond("Slack connection failed", e instanceof Error ? e.message : "Unknown error", false, undefined, 500);
  }
});
