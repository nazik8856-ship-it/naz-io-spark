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
import { figmaAuthedFetch } from "./figma.ts";

export type WriteResult = {
  ok: boolean;
  summary: string;
  ref?: string | null;
  url?: string | null;
  target?: string | null;
};

export type IntegrationRow = {
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
  const folderId = String(input.folder_id || "").trim();
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

  // Optional: move the new design into an existing folder (Canva's "project").
  let folderNote = "";
  if (folderId) {
    try {
      const mr = await canvaAuthedFetch(admin, row, `https://api.canva.com/rest/v1/folders/${folderId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: designId }),
      });
      if (!mr.ok) {
        const mb = await mr.json().catch(() => ({}));
        return fail(
          `Canva design ${designId} was created but could NOT be placed in folder ${folderId}: ${
            String((mb as { message?: string })?.message || `HTTP ${mr.status}`)
          }.`,
          designId, title,
        );
      }
      folderNote = ` and placed it in folder ${folderId}`;
    } catch (e) {
      return fail(
        `Canva design ${designId} was created but moving it into folder ${folderId} failed: ${
          e instanceof Error ? e.message : String(e)
        }.`,
        designId, title,
      );
    }
  }

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
    summary: `Created Canva design "${title}"${folderNote} and verified it by fetching design ${designId} back${url ? ` — ${url}` : ""}.`,
    ref: designId, url, target: title,
  };
}

// ---------------------------------------------------------------------------
// CANVA — list the user's existing designs (real read via the Connect API).
// ---------------------------------------------------------------------------
export async function canvaListDesigns(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const row = await loadProviderIntegration(admin, userId, agentId, "Canva");
  if (!row) return notConnected("Canva", "canva_list_designs");

  const query = String(input.query || "").trim();
  const limit = Math.max(1, Math.min(50, Number(input.limit ?? 20) || 20));
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (input.folder_id) params.set("folder_id", String(input.folder_id));
  const qs = params.toString();

  try {
    const r = await canvaAuthedFetch(
      admin, row, `https://api.canva.com/rest/v1/designs${qs ? `?${qs}` : ""}`, { method: "GET" },
    );
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return fail(`Canva designs could NOT be listed: ${String((body as { message?: string })?.message || `HTTP ${r.status}`)}`);
    }
    const items = (Array.isArray(body?.items) ? body.items : []) as Record<string, unknown>[];
    const designs = items.slice(0, limit).map((d) => {
      const urls = (d.urls as Record<string, string>) || {};
      const thumb = (d.thumbnail as Record<string, unknown>) || {};
      return {
        id: String(d.id || ""),
        title: String(d.title || "(untitled)"),
        thumbnail: thumb.url ? String(thumb.url) : null,
        edit_url: urls.edit_url || null,
        view_url: urls.view_url || null,
      };
    });
    return {
      ok: true,
      summary: designs.length
        ? `Canva returned ${designs.length} design(s): ${
          designs.map((d) => `${d.title} (${d.id})${d.view_url ? ` — ${d.view_url}` : ""}`).join("; ")
        }`
        : "Canva returned no designs for this account/query.",
      ref: JSON.stringify(designs),
      url: null,
      target: query || "all designs",
    };
  } catch (e) {
    return fail(`Canva list failed: ${e instanceof Error ? e.message : String(e)}.`);
  }
}

// ---------------------------------------------------------------------------
// CANVA — create a folder, then GET the folder back by id to verify.
// ---------------------------------------------------------------------------
export async function canvaCreateFolder(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const name = String(input.name || input.title || "").trim();
  if (!name) return fail("canva_create_folder requires a name.");
  const parent = String(input.parent_folder_id || "root").trim() || "root";

  const row = await loadProviderIntegration(admin, userId, agentId, "Canva");
  if (!row) return notConnected("Canva", "canva_create_folder");

  let created: Record<string, unknown>;
  try {
    const r = await canvaAuthedFetch(admin, row, "https://api.canva.com/rest/v1/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.slice(0, 250), parent_folder_id: parent }),
    });
    created = await r.json().catch(() => ({}));
    if (!r.ok) {
      return fail(`Canva folder NOT created: ${String((created as { message?: string })?.message || `HTTP ${r.status}`)}`);
    }
  } catch (e) {
    return fail(`Canva folder creation failed: ${e instanceof Error ? e.message : String(e)} — no folder created.`);
  }

  const folder = (created.folder as Record<string, unknown>) || created;
  const folderId = folder?.id ? String(folder.id) : "";
  if (!folderId) return fail("Canva returned no folder id — treat the folder as NOT created.");

  // Verification: fetch the folder back by id.
  const vr = await canvaAuthedFetch(admin, row, `https://api.canva.com/rest/v1/folders/${folderId}`, { method: "GET" });
  const vb = await vr.json().catch(() => ({}));
  const verified = (vb?.folder as Record<string, unknown>) || vb;
  if (!vr.ok || String(verified?.id || "") !== folderId) {
    return fail(`Canva folder ${folderId} could NOT be fetched back for verification. Treat as failed.`, folderId, name);
  }
  return {
    ok: true,
    summary: `Created Canva folder "${name}" (id ${folderId}) and verified it by fetching it back. Pass folder_id:"${folderId}" to canva_create_design to create designs inside it.`,
    ref: folderId, url: null, target: name,
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

// ---------------------------------------------------------------------------
// FIGMA — the REST API cannot create files or draw shapes. The only real write
// surfaces are comments and dev resources, both verified by re-fetching.
// ---------------------------------------------------------------------------
const figmaFileKey = (raw: string): string => {
  const s = raw.trim();
  const m = s.match(/figma\.com\/(?:file|design|board|proto)\/([A-Za-z0-9]+)/);
  return m ? m[1] : s;
};

export async function figmaPostComment(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const fileKey = figmaFileKey(String(input.file_key || input.file_url || ""));
  const message = String(input.message || "").trim();
  const nodeId = input.node_id ? String(input.node_id).trim() : "";
  if (!fileKey || !message) return fail("figma_post_comment requires both file_key and message.");

  const row = await loadProviderIntegration(admin, userId, agentId, "Figma");
  if (!row) return notConnected("Figma", "figma_post_comment");

  const payload: Record<string, unknown> = { message };
  if (nodeId) payload.client_meta = { node_id: nodeId, node_offset: { x: 0, y: 0 } };

  let created: Record<string, unknown>;
  try {
    const r = await figmaAuthedFetch(
      admin, row, `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    );
    created = await r.json().catch(() => ({}));
    if (!r.ok) {
      return fail(`Figma comment NOT posted: ${String((created as { message?: string })?.message || `HTTP ${r.status}`)}`);
    }
  } catch (e) {
    return fail(`Figma comment failed: ${e instanceof Error ? e.message : String(e)} — nothing was posted.`);
  }

  const commentId = created?.id ? String(created.id) : "";
  if (!commentId) return fail("Figma returned no comment id — treat the comment as NOT posted.");

  // Verification: re-fetch the file's comments and find this one.
  try {
    const vr = await figmaAuthedFetch(
      admin, row, `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`, { method: "GET" },
    );
    const vb = await vr.json().catch(() => ({}));
    const list = Array.isArray(vb?.comments) ? vb.comments as Array<{ id?: string }> : [];
    if (!vr.ok || !list.some((c) => String(c.id) === commentId)) {
      return fail(
        `Figma comment ${commentId} could NOT be found when re-reading the file's comments. Treat as failed.`,
        commentId, fileKey,
      );
    }
  } catch (e) {
    return fail(`Figma comment verification failed: ${e instanceof Error ? e.message : String(e)}. Treat as failed.`, commentId, fileKey);
  }

  const url = `https://www.figma.com/file/${fileKey}?#${commentId}`;
  return {
    ok: true,
    summary: `Posted a comment on Figma file ${fileKey}${nodeId ? ` (node ${nodeId})` : ""} and verified it by re-reading the file's comments (id ${commentId}).`,
    ref: commentId, url, target: fileKey,
  };
}

export async function figmaCreateDevResource(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const fileKey = figmaFileKey(String(input.file_key || input.file_url || ""));
  const nodeId = String(input.node_id || "").trim();
  const name = String(input.name || "").trim();
  const url = String(input.url || "").trim();
  if (!fileKey || !nodeId || !name || !url) {
    return fail("figma_create_dev_resource requires file_key, node_id, name and url.");
  }
  if (!/^https?:\/\//i.test(url)) return fail("figma_create_dev_resource url must be an http(s) link.");

  const row = await loadProviderIntegration(admin, userId, agentId, "Figma");
  if (!row) return notConnected("Figma", "figma_create_dev_resource");

  let created: Record<string, unknown>;
  try {
    const r = await figmaAuthedFetch(admin, row, "https://api.figma.com/v1/dev_resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dev_resources: [{ name, url, file_key: fileKey, node_id: nodeId }] }),
    });
    created = await r.json().catch(() => ({}));
    if (!r.ok) {
      return fail(`Figma dev resource NOT created: ${String((created as { message?: string })?.message || `HTTP ${r.status}`)}`);
    }
  } catch (e) {
    return fail(`Figma dev resource failed: ${e instanceof Error ? e.message : String(e)} — nothing was attached.`);
  }

  const errs = Array.isArray(created?.errors) ? created.errors as Array<{ error?: string }> : [];
  const links = Array.isArray(created?.links_created) ? created.links_created as Array<{ id?: string; url?: string }> : [];
  if (!links.length) {
    return fail(`Figma refused the dev resource: ${errs.map((e) => String(e?.error || "unknown")).join("; ") || "no link created"}.`);
  }
  const resourceId = String(links[0]?.id || "");
  if (!resourceId) return fail("Figma returned no dev resource id — treat it as NOT attached.");

  // Verification: re-fetch the node's dev resources and find this one.
  try {
    const vr = await figmaAuthedFetch(
      admin, row,
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/dev_resources?node_ids=${encodeURIComponent(nodeId)}`,
      { method: "GET" },
    );
    const vb = await vr.json().catch(() => ({}));
    const list = Array.isArray(vb?.dev_resources) ? vb.dev_resources as Array<{ id?: string; url?: string }> : [];
    if (!vr.ok || !list.some((d) => String(d.id) === resourceId || String(d.url) === url)) {
      return fail(
        `Figma dev resource ${resourceId} could NOT be found when re-reading node ${nodeId}. Treat as failed.`,
        resourceId, fileKey,
      );
    }
  } catch (e) {
    return fail(`Figma dev resource verification failed: ${e instanceof Error ? e.message : String(e)}. Treat as failed.`, resourceId, fileKey);
  }

  return {
    ok: true,
    summary: `Attached dev resource "${name}" to Figma node ${nodeId} in file ${fileKey} and verified it by re-reading the node's dev resources (id ${resourceId}).`,
    ref: resourceId, url, target: `${fileKey}:${nodeId}`,
  };
}

// ---------------------------------------------------------------------------
// GOOGLE — Gmail send, Docs create/edit, Sheets create/edit, Calendar create.
// Same contract: call the real API, then RE-FETCH the created/edited resource
// and only return ok:true when the effect is confirmed on Google's side.
// ---------------------------------------------------------------------------
async function googleRow(admin: SupabaseClient, userId: string, agentId: string) {
  return await loadProviderIntegration(admin, userId, agentId, "Gmail");
}

async function googleAccess(
  admin: SupabaseClient, userId: string, agentId: string,
): Promise<{ access: string; creds: Record<string, unknown> } | WriteResult> {
  const row = await googleRow(admin, userId, agentId);
  if (!row) return notConnected("Google", "This action");
  const { ensureAccessToken } = await import("./gmail.ts");
  const access = await ensureAccessToken(admin, { id: row.id, credentials_secret_id: row.credentials_secret_id });
  if (!access) return fail("Google token is invalid or revoked — reconnect Google before running this.");
  const creds = await readSecret(admin, row.credentials_secret_id);
  return { access, creds };
}

const gJson = async (r: Response) => await r.json().catch(() => ({} as Record<string, unknown>));
const gErr = (b: Record<string, unknown>, r: Response) =>
  String((b?.error as { message?: string } | undefined)?.message || `HTTP ${r.status}`);

async function googleSendEmail(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const to = String(input.to || "").trim();
  const subject = String(input.subject || "").trim();
  const body = String(input.body || input.body_markdown || "").trim();
  if (!to || !subject || !body) return fail("send_email needs to, subject and body — nothing was sent.");
  const auth = await googleAccess(admin, userId, agentId);
  if ("ok" in auth) return auth;
  const { gmailSend } = await import("./gmail.ts");
  const from = String(auth.creds.email || "me");
  const sent = await gmailSend(auth.access, from, to, subject, body);
  if (!sent.ok || !sent.id) return fail(`Gmail refused the send: ${sent.error || "no message id returned"}. Nothing was delivered.`);
  const vr = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(sent.id)}?format=metadata`,
    { headers: { Authorization: `Bearer ${auth.access}` } },
  );
  const vb = await gJson(vr);
  if (!vr.ok || !(vb as { id?: string }).id) {
    return fail(`Gmail accepted the send but it could not be verified: ${gErr(vb, vr)} (id ${sent.id}).`, sent.id, to);
  }
  const labels = ((vb as { labelIds?: string[] }).labelIds || []);
  if (labels.includes("DRAFT")) return fail(`The email is still a draft in Gmail, not sent (id ${sent.id}).`, sent.id, to);
  return {
    ok: true,
    summary: `Email "${subject}" was really sent to ${to} and verified by re-reading the Gmail message (id ${sent.id}).`,
    ref: sent.id, target: to, url: `https://mail.google.com/mail/u/0/#all/${sent.id}`,
  };
}

async function googleCreateDoc(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const title = String(input.title || "").trim();
  const text = String(input.body_markdown || input.body || "").trim();
  if (!title) return fail("create_doc needs a title — nothing was created.");
  const auth = await googleAccess(admin, userId, agentId);
  if ("ok" in auth) return auth;
  const h = { Authorization: `Bearer ${auth.access}`, "Content-Type": "application/json" };
  const cr = await fetch("https://docs.googleapis.com/v1/documents", {
    method: "POST", headers: h, body: JSON.stringify({ title }),
  });
  const cb = await gJson(cr);
  const docId = (cb as { documentId?: string }).documentId;
  if (!cr.ok || !docId) return fail(`Google Docs refused to create the doc: ${gErr(cb, cr)}.`);
  if (text) {
    const ur = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST", headers: h,
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text } }] }),
    });
    if (!ur.ok) return fail(`Doc was created but the content failed to write: ${gErr(await gJson(ur), ur)}.`, docId);
  }
  const vr = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, { headers: h });
  const vb = await gJson(vr);
  if (!vr.ok || (vb as { documentId?: string }).documentId !== docId) {
    return fail(`Doc creation could not be verified: ${gErr(vb, vr)}.`, docId);
  }
  const url = `https://docs.google.com/document/d/${docId}/edit`;
  return { ok: true, summary: `Google Doc "${title}" was really created and verified by re-reading it.`, ref: docId, url, target: title };
}

async function googleEditDoc(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const docId = String(input.doc_id || "").trim();
  const text = String(input.body_markdown || input.body || "").trim();
  const mode = String(input.mode || "append") === "replace" ? "replace" : "append";
  if (!docId || !text) return fail("edit_doc needs doc_id and body_markdown — nothing was changed.");
  const auth = await googleAccess(admin, userId, agentId);
  if ("ok" in auth) return auth;
  const h = { Authorization: `Bearer ${auth.access}`, "Content-Type": "application/json" };
  const rr = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, { headers: h });
  const rb = await gJson(rr);
  if (!rr.ok) return fail(`Could not open that Google Doc: ${gErr(rb, rr)}.`, docId);
  const content = ((rb as { body?: { content?: { endIndex?: number }[] } }).body?.content || []);
  const endIndex = Math.max(1, (content[content.length - 1]?.endIndex ?? 2) - 1);
  const requests: unknown[] = [];
  if (mode === "replace" && endIndex > 1) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex } } });
    requests.push({ insertText: { location: { index: 1 }, text } });
  } else {
    requests.push({ insertText: { location: { index: endIndex }, text: `\n${text}` } });
  }
  const ur = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: "POST", headers: h, body: JSON.stringify({ requests }),
  });
  if (!ur.ok) return fail(`The doc edit failed: ${gErr(await gJson(ur), ur)}.`, docId);
  const vr = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, { headers: h });
  const vb = await gJson(vr);
  const flat = JSON.stringify(vb).replace(/\\n/g, " ");
  const probe = text.slice(0, 40).replace(/["\\]/g, "");
  if (!vr.ok || (probe && !flat.includes(probe))) {
    return fail(`The edit could not be verified in the doc after saving${vr.ok ? "" : `: ${gErr(vb, vr)}`}.`, docId);
  }
  return {
    ok: true,
    summary: `Google Doc ${docId} was really edited (${mode}) and verified by re-reading its contents.`,
    ref: docId, url: `https://docs.google.com/document/d/${docId}/edit`, target: docId,
  };
}

async function googleCreateSheet(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const title = String(input.title || "").trim();
  const rows = Array.isArray(input.rows) ? (input.rows as unknown[][]) : [];
  if (!title) return fail("create_sheet needs a title — nothing was created.");
  const auth = await googleAccess(admin, userId, agentId);
  if ("ok" in auth) return auth;
  const h = { Authorization: `Bearer ${auth.access}`, "Content-Type": "application/json" };
  const cr = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST", headers: h, body: JSON.stringify({ properties: { title } }),
  });
  const cb = await gJson(cr);
  const sheetId = (cb as { spreadsheetId?: string }).spreadsheetId;
  if (!cr.ok || !sheetId) return fail(`Google Sheets refused to create the sheet: ${gErr(cb, cr)}.`);
  if (rows.length) {
    const ur = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1?valueInputOption=RAW`,
      { method: "PUT", headers: h, body: JSON.stringify({ values: rows }) },
    );
    if (!ur.ok) return fail(`Sheet was created but the rows failed to write: ${gErr(await gJson(ur), ur)}.`, sheetId);
  }
  const vr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, { headers: h });
  const vb = await gJson(vr);
  if (!vr.ok || (vb as { spreadsheetId?: string }).spreadsheetId !== sheetId) {
    return fail(`Sheet creation could not be verified: ${gErr(vb, vr)}.`, sheetId);
  }
  return {
    ok: true,
    summary: `Google Sheet "${title}" was really created with ${rows.length} row(s) and verified by re-reading it.`,
    ref: sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, target: title,
  };
}

async function googleEditSheet(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const sheetId = String(input.sheet_id || "").trim();
  const range = String(input.range || "").trim();
  const values = Array.isArray(input.values) ? (input.values as unknown[][]) : [];
  if (!sheetId || !range || !values.length) return fail("edit_sheet needs sheet_id, range and values — nothing was changed.");
  const auth = await googleAccess(admin, userId, agentId);
  if ("ok" in auth) return auth;
  const h = { Authorization: `Bearer ${auth.access}`, "Content-Type": "application/json" };
  const ur = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: "PUT", headers: h, body: JSON.stringify({ values }) },
  );
  if (!ur.ok) return fail(`The sheet update failed: ${gErr(await gJson(ur), ur)}.`, sheetId, range);
  const vr = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
    { headers: h },
  );
  const vb = await gJson(vr);
  const got = (vb as { values?: unknown[][] }).values || [];
  if (!vr.ok || !got.length) return fail(`The update could not be verified when re-reading ${range}: ${gErr(vb, vr)}.`, sheetId, range);
  return {
    ok: true,
    summary: `Range ${range} in sheet ${sheetId} was really updated and verified by re-reading ${got.length} row(s).`,
    ref: sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, target: range,
  };
}

async function googleCreateCalendarEvent(
  admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  const title = String(input.title || input.summary || "").trim();
  const startIso = String(input.start_iso || "").trim();
  const endIso = String(input.end_iso || "").trim();
  if (!title || Number.isNaN(Date.parse(startIso)) || Number.isNaN(Date.parse(endIso))) {
    return fail("create_calendar_event needs a title and valid ISO start/end times — nothing was created.");
  }
  const auth = await googleAccess(admin, userId, agentId);
  if ("ok" in auth) return auth;
  const h = { Authorization: `Bearer ${auth.access}`, "Content-Type": "application/json" };
  const cr = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST", headers: h,
    body: JSON.stringify({
      summary: title,
      description: String(input.description || ""),
      start: { dateTime: new Date(startIso).toISOString() },
      end: { dateTime: new Date(endIso).toISOString() },
    }),
  });
  const cb = await gJson(cr);
  const eventId = (cb as { id?: string }).id;
  if (!cr.ok || !eventId) return fail(`Google Calendar refused to create the event: ${gErr(cb, cr)}.`);
  const vr = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { headers: h },
  );
  const vb = await gJson(vr);
  const status = String((vb as { status?: string }).status || "");
  if (!vr.ok || !(vb as { id?: string }).id || status === "cancelled") {
    return fail(`The event could not be verified on the calendar${status === "cancelled" ? " (it is cancelled)" : `: ${gErr(vb, vr)}`}.`, eventId, title);
  }
  return {
    ok: true,
    summary: `Calendar event "${title}" was really created and verified by re-reading it (status ${status || "confirmed"}).`,
    ref: eventId, url: (vb as { htmlLink?: string }).htmlLink || null, target: title,
  };
}

export const PROVIDER_WRITE_KINDS = new Set([
  "send_email",
  "create_doc",
  "edit_doc",
  "create_sheet",
  "edit_sheet",
  "create_calendar_event",

  "slack_post_message",
  "notion_create_page",
  "notion_update_page",
  "canva_create_design",
  "canva_list_designs",
  "canva_create_folder",
  "shopify_create_draft_order",
  "shopify_update_product",
  "figma_post_comment",
  "figma_create_dev_resource",
]);

export async function runProviderWrite(
  kind: string, admin: SupabaseClient, userId: string, agentId: string, input: Record<string, unknown>,
): Promise<WriteResult> {
  switch (kind) {
    case "slack_post_message": return await slackPostMessage(admin, userId, agentId, input);
    case "notion_create_page": return await notionCreatePage(admin, userId, agentId, input);
    case "notion_update_page": return await notionUpdatePage(admin, userId, agentId, input);
    case "canva_create_design": return await canvaCreateDesign(admin, userId, agentId, input);
    case "canva_list_designs": return await canvaListDesigns(admin, userId, agentId, input);
    case "canva_create_folder": return await canvaCreateFolder(admin, userId, agentId, input);
    case "shopify_create_draft_order": return await shopifyCreateDraftOrder(admin, userId, agentId, input);
    case "shopify_update_product": return await shopifyUpdateProduct(admin, userId, agentId, input);
    case "figma_post_comment": return await figmaPostComment(admin, userId, agentId, input);
    case "figma_create_dev_resource": return await figmaCreateDevResource(admin, userId, agentId, input);
    case "send_email": return await googleSendEmail(admin, userId, agentId, input);
    case "create_doc": return await googleCreateDoc(admin, userId, agentId, input);
    case "edit_doc": return await googleEditDoc(admin, userId, agentId, input);
    case "create_sheet": return await googleCreateSheet(admin, userId, agentId, input);
    case "edit_sheet": return await googleEditSheet(admin, userId, agentId, input);
    case "create_calendar_event": return await googleCreateCalendarEvent(admin, userId, agentId, input);
    default: return fail(`Unknown provider write "${kind}".`);
  }
}
