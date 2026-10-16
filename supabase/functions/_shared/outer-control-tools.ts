// Outer Control (active): changing a connected tool after it was created — replacing its
// credential and removing it. A removed tool is hidden and switched off, not deleted, so
// the history of sessions that used it stays readable. Plain functions so they can be
// tested without the network.

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;
const iso = () => new Date().toISOString();

export type ToolChange = { ok: true; message: string } | { ok: false; code: string; message: string; status: number };

const MAX_TOKEN = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Replace the credential a tool is contacted with. The new value goes to the vault (in place
 * when the tool already has one), the old test result is cleared so the next Test starts fresh,
 * and nothing about the value is ever returned.
 */
export async function updateToolKey(admin: AnyAdmin, accountId: string, toolId: string, rawToken: unknown): Promise<ToolChange> {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) return { ok: false, code: "invalid_token", message: "Paste the new API key or token.", status: 400 };
  if (token.length > MAX_TOKEN) return { ok: false, code: "invalid_token", message: "That credential is too long.", status: 400 };
  const { data: tool } = await admin.from("external_tools").select("id, credentials_secret_id, removed_at").eq("id", toolId).eq("user_id", accountId).maybeSingle();
  if (!tool || tool.removed_at) return { ok: false, code: "not_found", message: "Tool not found.", status: 404 };

  let secretId: string | null = tool.credentials_secret_id ?? null;
  if (secretId) {
    const { error } = await admin.rpc("update_integration_secret", { sid: secretId, payload: { token } });
    if (error) return { ok: false, code: "secret_failed", message: "Could not store the new credential.", status: 500 };
  } else {
    const { data: sid, error } = await admin.rpc("create_integration_secret", { payload: { token }, label: `outer-control-tool-${crypto.randomUUID()}` });
    if (error || !sid) return { ok: false, code: "secret_failed", message: "Could not store the new credential.", status: 500 };
    secretId = String(sid);
  }
  const { error: upErr } = await admin.from("external_tools")
    .update({ credentials_secret_id: secretId, last_error: null, last_checked_at: null, updated_at: iso() }).eq("id", toolId).eq("user_id", accountId);
  if (upErr) return { ok: false, code: "internal_error", message: "Could not save the tool.", status: 500 };
  return { ok: true, message: "New key saved. Press Test to check it." };
}

/**
 * Remove a tool: switch it off, hide it, drop its stored credential and cancel any session
 * still using it as its tool (sessions that only had it as a fallback keep going without one).
 * Returns the workflows whose later steps may now be able to move on.
 */
export async function removeTool(admin: AnyAdmin, accountId: string, toolId: string): Promise<ToolChange & { workflowIds?: string[] }> {
  // The id goes into a filter string below, so it must be a plain uuid.
  if (!UUID.test(toolId)) return { ok: false, code: "not_found", message: "Tool not found.", status: 404 };
  const { data: tool } = await admin.from("external_tools").select("id, credentials_secret_id, removed_at").eq("id", toolId).eq("user_id", accountId).maybeSingle();
  if (!tool || tool.removed_at) return { ok: false, code: "not_found", message: "Tool not found.", status: 404 };

  // Close the sessions that use it as their tool first, so nothing starts contacting it while it is
  // being removed. A session that only had it as its fallback is not cancelled: its own tool still
  // works, so it keeps going without a fallback (a later failure then goes to a person instead of
  // switching tools).
  const { data: open } = await admin.from("outer_control_sessions").select("id, workflow_id, tool_id")
    .eq("user_id", accountId).in("status", ["queued", "running", "awaiting_human"]).or(`tool_id.eq.${toolId},fallback_tool_id.eq.${toolId}`);
  const found = (open ?? []) as { id: string; workflow_id: string | null; tool_id: string }[];
  const rows = found.filter((r) => r.tool_id === toolId);
  const fallbackOnly = found.filter((r) => r.tool_id !== toolId);
  if (rows.length) {
    await admin.from("outer_control_sessions")
      .update({ status: "cancelled", stop_reason: "The tool was removed.", finished_at: iso(), updated_at: iso(), pending_kind: null, pending_approval_id: null, lease_until: null, handoff: null })
      .in("id", rows.map((r) => r.id));
  }
  if (fallbackOnly.length) {
    await admin.from("outer_control_sessions")
      .update({ fallback_tool_id: null, updated_at: iso() })
      .in("id", fallbackOnly.map((r) => r.id)).eq("fallback_tool_id", toolId);
  }

  const { error } = await admin.from("external_tools")
    .update({ enabled: false, removed_at: iso(), credentials_secret_id: null, updated_at: iso() }).eq("id", toolId).eq("user_id", accountId);
  if (error) return { ok: false, code: "internal_error", message: "Could not remove the tool.", status: 500 };
  if (tool.credentials_secret_id) await admin.rpc("delete_integration_secret", { sid: tool.credentials_secret_id });

  const workflowIds = [...new Set(rows.map((r) => r.workflow_id).filter((w): w is string => !!w))];
  return { ok: true, message: "Tool removed.", workflowIds };
}
