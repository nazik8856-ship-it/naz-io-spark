// notion-oauth-callback — Notion redirects here with ?code & ?state. We
// atomically consume the server-side transaction, exchange the code for an
// access token via Basic Auth (base64 of client_id:client_secret), then
// upsert per workspace keyed on (user_id, provider="Notion",
// metadata->>'workspace_id') so a user connecting multiple workspaces gets
// one row per workspace instead of overwriting the previous one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { exchangeCode } from "../_shared/notion.ts";
import { createSecret, updateSecret } from "../_shared/integration-secrets.ts";

const html = (title: string, msg: string, ok: boolean, workspace?: string) => `<!doctype html>
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
    window.opener.postMessage({ source:"nazai-notion-oauth", ok:${ok}, workspace:${JSON.stringify(workspace || "")}, message:${JSON.stringify(msg)} }, "*");
  }
} catch(e){}
setTimeout(function(){ window.close(); }, 120);
</script></body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");
  const respond = (title: string, msg: string, ok: boolean, workspace?: string, status = 200) =>
    new Response(html(title, msg, ok, workspace), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

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
    const userId = tx.user_id as string;

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
    };
    const persistence = existing?.id
      ? admin.from("agent_integrations").update(integrationRow).eq("id", existing.id)
      : admin.from("agent_integrations").insert(integrationRow);
    const { error: pErr } = await persistence;
    if (pErr) throw new Error(pErr.message);

    return respond(
      "Notion connected",
      `Connected to ${workspaceName}. You can close this window.`,
      true,
      workspaceId,
      200,
    );
  } catch (e) {
    return respond("Notion connection failed", e instanceof Error ? e.message : "Unknown error", false, undefined, 500);
  }
});
