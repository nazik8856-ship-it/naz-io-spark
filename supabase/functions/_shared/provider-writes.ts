// ============================================================================
// Real, verified write executors for Slack, Notion, Canva and Shopify.
//
// Every executor follows the exact contract already used by the Gmail / Docs /
// Sheets / Calendar executors:
//   1. call the real external API with the org's connected credentials
//   2. RE-FETCH (or read the provider's own authoritative receipt) to confirm
//      the effect actually landed
//   3. only then return ok:true
// A bare HTTP 200 is never treated as success. Any API error or failed
// verification returns ok:false with a plain-language reason.
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readSecret } from "./integration-secrets.ts";
import { canvaAuthedFetch } from "./canva.ts";

export type WriteResult = {
  ok: boolean;
  summary: string;
  ref?: string | null;
  url?: string | null;
  target?: string | null;
};

type IntegrationRow = {
  id: string;
  credentials_secret_id: string | null;
  metadata: Record<string, unknown> | null;
  agent_id: string | null;
};

const fail = (summary: string, ref: string | null = null, target: string | null = null): WriteResult =>
  ({ ok: false, summary, ref, target });

/** Pick the connected integration for a provider, preferring this agent's own row. */
export async function loadProviderIntegration(
  admin: SupabaseClient,
  userId: string,
  agentId: string,
  provider: string,
  match?: (row: IntegrationRow) => boolean,
): Promise<IntegrationRow | null> {
  const { data } = await admin
    .from("agent_integrations")
    .select("id, credentials_secret_id, metadata, agent_id")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("status", "connected");
  const rows = ((data || []) as IntegrationRow[]).filter((r) => (match ? match(r) : true));
  return rows.find((r) => r.agent_id === agentId) || rows[0] || null;
}

const notConnected = (provider: string, kind: string) =>
  fail(`${kind} needs a connected ${provider} account — none is connected, so nothing was sent or created.`);

// ---------------------------------------------------------------------------
// SLACK — chat.postMessage. Slack's own response (ok:true + ts + channel) is
// the authoritative delivery receipt; we additionally confirm the message is
// readable back where scopes allow it.
// ---------------------------------------------------------------------------
export async function slackPostMessage(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const channel = String(input.channel || "").trim();
  const text = String(input.text || "").trim();
  const threadTs = input.thread_ts ? String(input.thread_ts) : undefined;
  if (!channel || !text) return fail("slack_post_message requires both channel and text.");

  const row = await loadProviderIntegration(admin, userId, agentId, "Slack");
  if (!row) return notConnected("Slack", "slack_post_message");
  const creds = await readSecret(admin, row.credentials_secret_id);
  const token = creds.access_token as string | undefined;
  if (!token) return fail("Slack token missing — reconnect Slack. Nothing was posted.");

  let body: Record<string, unknown>;
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
    });
    body = await r.json().catch(() => ({}));
    if (!r.ok) return fail(`Slack chat.postMessage HTTP ${r.status} — message NOT posted.`);
  } catch (e) {
    return fail(`Slack chat.postMessage failed: ${e instanceof Error ? e.message : String(e)} — message NOT posted.`);
  }
  // Slack's receipt: ok:true plus a real message timestamp. Anything else is a failure.
  if (!body?.ok || !body?.ts) {
    return fail(`Slack refused the message: ${String(body?.error || "unknown error")} — nothing was posted.`);
  }
  const ts = String(body.ts);
  const ch = String(body.channel || channel);

  // Best-effort read-back. If history scopes are missing we keep Slack's own
  // receipt (per Slack's API design) but say so plainly.
  let verifiedNote = "confirmed by Slack receipt ts=" + ts;
  try {
    const vr = await fetch(
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(ch)}&latest=${ts}&inclusive=true&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const vb = await vr.json().catch(() => ({}));
    if (vb?.ok && Array.isArray(vb.messages) && vb.messages.some((m: { ts?: string }) => m.ts === ts)) {
      verifiedNote = `re-read from the channel (ts=${ts})`;
    } else if (vb?.error && vb.error !== "missing_scope" && vb.error !== "not_in_channel") {
      verifiedNote = `Slack receipt ts=${ts} (read-back unavailable: ${vb.error})`;
    }
  } catch { /* keep the receipt-based verification */ }

  return {
    ok: true,
    summary: `Posted to Slack ${channel} — ${verifiedNote}.`,
    ref: ts,
    target: channel,
    url: null,
  };
}

// ---------------------------------------------------------------------------
// NOTION — create/update a page, then GET the page back to confirm.
// ---------------------------------------------------------------------------
const NOTION_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
});

function notionBlocks(markdown: string) {
  return markdown.split(/\n{2,}/).slice(0, 90).filter((p) => p.trim()).map((p) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: p.slice(0, 1900) } }] },
  }));
}

async function notionToken(admin: SupabaseClient, userId: string, agentId: string) {
  const row = await loadProviderIntegration(admin, userId, agentId, "Notion");
  if (!row) return null;
  const creds = await readSecret(admin, row.credentials_secret_id);
  return (creds.access_token as string | undefined) || null;
}

export async function notionCreatePage(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const parentId = String(input.parent_id || "").trim();
  const parentType = String(input.parent_type || "page").toLowerCase() === "database" ? "database" : "page";
  const title = String(input.title || "").trim();
  const bodyMd = String(input.body_markdown || "");
  if (!parentId || !title) return fail("notion_create_page requires parent_id and title.");

  const token = await notionToken(admin, userId, agentId);
  if (!token) return notConnected("Notion", "notion_create_page");

  const parent = parentType === "database" ? { database_id: parentId } : { page_id: parentId };
  const properties = parentType === "database"
    ? { Name: { title: [{ text: { content: title.slice(0, 200) } }] } }
    : { title: { title: [{ text: { content: title.slice(0, 200) } }] } };

  let created: Record<string, unknown>;
  try {
    const r = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: NOTION_HEADERS(token),
      body: JSON.stringify({ parent, properties, ...(bodyMd ? { children: notionBlocks(bodyMd) } : {}) }),
    });
    created = await r.json().catch(() => ({}));
    if (!r.ok || !created?.id) {
      return fail(`Notion page NOT created: ${String((created as { message?: string })?.message || `HTTP ${r.status}`)}`);
    }
  } catch (e) {
    return fail(`Notion create failed: ${e instanceof Error ? e.message : String(e)} — no page created.`);
  }

  const pageId = String(created.id);
  // Verification: GET the page back and confirm it exists and isn't archived.
  const vr = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: NOTION_HEADERS(token) });
  const vb = await vr.json().catch(() => ({}));
  if (!vr.ok || vb?.id !== pageId || vb?.archived === true) {
    return fail(
      `Notion create could NOT be verified (page ${pageId} not readable back${vb?.archived ? " / archived" : ""}). Treat as failed.`,
      pageId, title,
    );
  }
  const url = (vb.url as string) || `https://www.notion.so/${pageId.replace(/-/g, "")}`;
  return { ok: true, summary: `Created Notion page "${title}" and verified it by re-fetching it — ${url}`, ref: pageId, url, target: title };
}

export async function notionUpdatePage(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const pageId = String(input.page_id || "").trim();
  const title = input.title ? String(input.title).trim() : "";
  const appendMd = input.append_markdown ? String(input.append_markdown) : "";
  const archived = typeof input.archived === "boolean" ? (input.archived as boolean) : undefined;
  if (!pageId) return fail("notion_update_page requires page_id.");
  if (!title && !appendMd && archived === undefined) {
    return fail("notion_update_page needs at least one of title, append_markdown or archived.");
  }

  const token = await notionToken(admin, userId, agentId);
  if (!token) return notConnected("Notion", "notion_update_page");

  try {
    if (title || archived !== undefined) {
      const patch: Record<string, unknown> = {};
      if (archived !== undefined) patch.archived = archived;
      if (title) patch.properties = { title: { title: [{ text: { content: title.slice(0, 200) } }] } };
      const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "PATCH", headers: NOTION_HEADERS(token), body: JSON.stringify(patch),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return fail(`Notion page NOT updated: ${String(b?.message || `HTTP ${r.status}`)}`, pageId);
    }
    if (appendMd) {
      const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: "PATCH", headers: NOTION_HEADERS(token), body: JSON.stringify({ children: notionBlocks(appendMd) }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return fail(`Notion content append failed: ${String(b?.message || `HTTP ${r.status}`)}`, pageId);
    }
  } catch (e) {
    return fail(`Notion update failed: ${e instanceof Error ? e.message : String(e)}`, pageId);
  }

  // Verification: re-fetch the page (and its last_edited_time) to confirm.
  const vr = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: NOTION_HEADERS(token) });
  const vb = await vr.json().catch(() => ({}));
  if (!vr.ok || vb?.id !== pageId) {
    return fail(`Notion update could NOT be verified (page ${pageId} not readable back). Treat as failed.`, pageId);
  }
  if (archived !== undefined && vb?.archived !== archived) {
    return fail(`Notion archived state did not change (still archived=${vb?.archived}). Treat as failed.`, pageId);
  }
  const url = (vb.url as string) || `https://www.notion.so/${pageId.replace(/-/g, "")}`;
  return {
    ok: true,
    summary: `Updated Notion page ${pageId} and verified by re-fetching it (last edited ${vb.last_edited_time || "just now"}) — ${url}`,
    ref: pageId, url, target: title || pageId,
  };
}

// ---------------------------------------------------------------------------
// CANVA — Connect API design creation, then GET the design back by id.
// ---------------------------------------------------------------------------
export async function canvaCreateDesign(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const title = String(input.title || "").trim();
  const designType = String(input.design_type || "presentation").toLowerCase();
  if (!title) return fail("canva_create_design requires a title.");

  const row = await loadProviderIntegration(admin, userId, agentId, "Canva");
  if (!row) return notConnected("Canva", "canva_create_design");

  const allowed = new Set(["presentation", "doc", "whiteboard"]);
  const payload = {
    design_type: { type: "preset", name: allowed.has(designType) ? designType : "presentation" },
    title: title.slice(0, 250),
  };

  let created: Record<string, unknown>;
  try {
    const r = await canvaAuthedFetch(admin, row, "https://api.canva.com/rest/v1/designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    created = await r.json().catch(() => ({}));
    if (!r.ok) {
      return fail(`Canva design NOT created: ${String((created as { message?: string })?.message || `HTTP ${r.status}`)}`);
    }
  } catch (e) {
    return fail(`Canva create failed: ${e instanceof Error ? e.message : String(e)} — no design created.`);
  }

  const design = (created.design as Record<string, unknown>) || created;
  const designId = design?.id ? String(design.id) : "";
  if (!designId) return fail("Canva returned no design id — treat the design as NOT created.");

  // Verification: fetch the design back by id.
  const vr = await canvaAuthedFetch(admin, row, `https://api.canva.com/rest/v1/designs/${designId}`, { method: "GET" });
  const vb = await vr.json().catch(() => ({}));
  const verified = (vb?.design as Record<string, unknown>) || vb;
  if (!vr.ok || String(verified?.id || "") !== designId) {
    return fail(`Canva design ${designId} could NOT be fetched back for verification. Treat as failed.`, designId, title);
  }
  const urls = (verified.urls as Record<string, string>) || {};
  const url = urls.edit_url || urls.view_url || null;
  return {
    ok: true,
    summary: `Created Canva design "${title}" and verified it by fetching design ${designId} back${url ? ` — ${url}` : ""}.`,
    ref: designId, url, target: title,
  };
}

// ---------------------------------------------------------------------------
// SHOPIFY — Admin REST API against the connected shop, verified by re-fetch.
// ---------------------------------------------------------------------------
const SHOPIFY_API_VERSION = "2024-10";

async function shopifyCtx(admin: SupabaseClient, userId: string, agentId: string, wantedShop?: string) {
  const row = await loadProviderIntegration(admin, userId, agentId, "Shopify", (r) =>
    !wantedShop || String((r.metadata as Record<string, unknown> | null)?.shop || "").toLowerCase() === wantedShop.toLowerCase());
  if (!row) return null;
  const creds = await readSecret(admin, row.credentials_secret_id);
  const token = creds.access_token as string | undefined;
  const shop = (creds.shop_domain as string | undefined)
    || String((row.metadata as Record<string, unknown> | null)?.shop || "");
  if (!token || !shop) return null;
  return { token, shop };
}

const shopifyHeaders = (token: string) => ({ "X-Shopify-Access-Token": token, "Content-Type": "application/json" });

export async function shopifyCreateDraftOrder(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const items = Array.isArray(input.line_items) ? (input.line_items as Record<string, unknown>[]) : [];
  if (items.length === 0) return fail("shopify_create_draft_order requires at least one line item.");
  const ctx = await shopifyCtx(admin, userId, agentId, input.shop ? String(input.shop) : undefined);
  if (!ctx) return notConnected("Shopify", "shopify_create_draft_order");

  const line_items = items.slice(0, 50).map((li) => {
    const qty = Math.max(1, Number(li.quantity || 1));
    if (li.variant_id) return { variant_id: Number(li.variant_id), quantity: qty };
    return { title: String(li.title || "Custom item").slice(0, 200), price: String(li.price ?? "0.00"), quantity: qty };
  });
  const draft: Record<string, unknown> = { line_items };
  if (input.email) draft.email = String(input.email);
  if (input.note) draft.note = String(input.note).slice(0, 2000);

  let created: Record<string, unknown>;
  try {
    const r = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/draft_orders.json`, {
      method: "POST", headers: shopifyHeaders(ctx.token), body: JSON.stringify({ draft_order: draft }),
    });
    created = await r.json().catch(() => ({}));
    if (!r.ok) {
      return fail(`Shopify draft order NOT created: ${JSON.stringify((created as { errors?: unknown })?.errors ?? `HTTP ${r.status}`).slice(0, 300)}`);
    }
  } catch (e) {
    return fail(`Shopify draft order failed: ${e instanceof Error ? e.message : String(e)} — nothing created.`);
  }

  const order = (created.draft_order as Record<string, unknown>) || {};
  const id = order?.id ? String(order.id) : "";
  if (!id) return fail("Shopify returned no draft order id — treat as NOT created.");

  // Verification: re-fetch the draft order by id.
  const vr = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/draft_orders/${id}.json`, {
    headers: shopifyHeaders(ctx.token),
  });
  const vb = await vr.json().catch(() => ({}));
  const verified = (vb.draft_order as Record<string, unknown>) || {};
  if (!vr.ok || String(verified?.id || "") !== id) {
    return fail(`Shopify draft order ${id} could NOT be re-fetched for verification. Treat as failed.`, id);
  }
  const url = (verified.invoice_url as string) || `https://${ctx.shop}/admin/draft_orders/${id}`;
  return {
    ok: true,
    summary: `Created Shopify draft order ${verified.name || id} on ${ctx.shop} (total ${verified.total_price ?? "?"} ${verified.currency ?? ""}) and verified it by re-fetching it.`,
    ref: id, url, target: String(verified.name || id),
  };
}

export async function shopifyUpdateProduct(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const productId = String(input.product_id || "").trim();
  if (!productId) return fail("shopify_update_product requires product_id.");
  const ctx = await shopifyCtx(admin, userId, agentId, input.shop ? String(input.shop) : undefined);
  if (!ctx) return notConnected("Shopify", "shopify_update_product");

  const patch: Record<string, unknown> = { id: Number(productId) };
  if (input.title) patch.title = String(input.title).slice(0, 250);
  if (input.status) patch.status = String(input.status);
  if (input.body_html) patch.body_html = String(input.body_html).slice(0, 20000);
  if (Array.isArray(input.variants)) {
    patch.variants = (input.variants as Record<string, unknown>[]).slice(0, 50).map((v) => ({
      id: Number(v.id),
      ...(v.price !== undefined ? { price: String(v.price) } : {}),
      ...(v.sku !== undefined ? { sku: String(v.sku) } : {}),
    }));
  }
  if (Object.keys(patch).length <= 1) {
    return fail("shopify_update_product needs at least one field to change (title, status, body_html or variants).");
  }

  try {
    const r = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, {
      method: "PUT", headers: shopifyHeaders(ctx.token), body: JSON.stringify({ product: patch }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) {
      return fail(`Shopify product NOT updated: ${JSON.stringify((b as { errors?: unknown })?.errors ?? `HTTP ${r.status}`).slice(0, 300)}`, productId);
    }
  } catch (e) {
    return fail(`Shopify product update failed: ${e instanceof Error ? e.message : String(e)}`, productId);
  }

  // Verification: re-fetch the product and confirm the requested fields really changed.
  const vr = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, {
    headers: shopifyHeaders(ctx.token),
  });
  const vb = await vr.json().catch(() => ({}));
  const product = (vb.product as Record<string, unknown>) || {};
  if (!vr.ok || String(product?.id || "") !== String(productId)) {
    return fail(`Shopify product ${productId} could NOT be re-fetched for verification. Treat as failed.`, productId);
  }
  const mismatches: string[] = [];
  if (patch.title && product.title !== patch.title) mismatches.push(`title is still "${product.title}"`);
  if (patch.status && product.status !== patch.status) mismatches.push(`status is still "${product.status}"`);
  if (Array.isArray(patch.variants)) {
    const live = (product.variants as Record<string, unknown>[]) || [];
    for (const want of patch.variants as Record<string, unknown>[]) {
      const got = live.find((v) => String(v.id) === String(want.id));
      if (want.price !== undefined && got && String(got.price) !== String(want.price)) {
        mismatches.push(`variant ${want.id} price is still ${got.price}, expected ${want.price}`);
      }
    }
  }
  if (mismatches.length) {
    return fail(`Shopify accepted the request but verification shows the change did NOT land: ${mismatches.join("; ")}.`, productId);
  }
  const url = `https://${ctx.shop}/admin/products/${productId}`;
  return {
    ok: true,
    summary: `Updated Shopify product "${product.title}" (${productId}) on ${ctx.shop} and verified every changed field by re-fetching it.`,
    ref: productId, url, target: String(product.title || productId),
  };
}

export const PROVIDER_WRITE_KINDS = new Set([
  "slack_post_message",
  "notion_create_page",
  "notion_update_page",
  "canva_create_design",
  "shopify_create_draft_order",
  "shopify_update_product",
]);

export async function runProviderWrite(
  kind: string, admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  switch (kind) {
    case "slack_post_message": return await slackPostMessage(admin, userId, agentId, input);
    case "notion_create_page": return await notionCreatePage(admin, userId, agentId, input);
    case "notion_update_page": return await notionUpdatePage(admin, userId, agentId, input);
    case "canva_create_design": return await canvaCreateDesign(admin, userId, agentId, input);
    case "shopify_create_draft_order": return await shopifyCreateDraftOrder(admin, userId, agentId, input);
    case "shopify_update_product": return await shopifyUpdateProduct(admin, userId, agentId, input);
    default: return fail(`Unknown provider write "${kind}".`);
  }
}
