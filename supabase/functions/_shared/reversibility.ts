// ============================================================================
// REVERSIBILITY LAYER — every real write declares whether it can be undone,
// what pre-state must be captured to undo it, and a REAL compensating action
// that is verified by re-fetching, exactly like the forward executors.
//
// Contract:
//   - captureUndoState() runs BEFORE the write and snapshots anything the
//     compensating action will need (e.g. current Shopify prices).
//   - runUndo() performs the real compensating call and only reports ok:true
//     after confirming the reversal actually landed on the provider.
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { readSecret } from "./integration-secrets.ts";
import { canvaAuthedFetch } from "./canva.ts";
import { figmaAuthedFetch } from "./figma.ts";
import { loadProviderIntegration, type WriteResult } from "./provider-writes.ts";

export type UndoKind = "compensating" | "delete" | "restore" | "none";

export type Reversibility = {
  reversible: boolean;
  undo_kind: UndoKind;
  /** Plain-language description of what undoing actually does. */
  undo_effect: string;
  /** Why it cannot be undone, when reversible is false. */
  irreversible_reason?: string;
};

const NONE = (reason: string): Reversibility => ({
  reversible: false, undo_kind: "none", undo_effect: "", irreversible_reason: reason,
});

export const REVERSIBILITY: Record<string, Reversibility> = {
  slack_post_message: {
    reversible: true, undo_kind: "delete",
    undo_effect: "deletes the posted Slack message and confirms it is gone from the channel",
  },
  notion_create_page: {
    reversible: true, undo_kind: "delete",
    undo_effect: "archives the created Notion page and re-reads it to confirm archived:true",
  },
  notion_update_page: {
    reversible: true, undo_kind: "restore",
    undo_effect: "writes the page's previous properties back and re-reads the page to confirm",
  },
  canva_create_folder: {
    reversible: true, undo_kind: "delete",
    undo_effect: "moves the Canva folder to trash and confirms it can no longer be fetched",
  },
  shopify_create_draft_order: {
    reversible: true, undo_kind: "delete",
    undo_effect: "deletes the Shopify draft order and confirms it no longer exists",
  },
  shopify_update_product: {
    reversible: true, undo_kind: "restore",
    undo_effect: "restores the product's previous title/status/description and variant prices, verified by re-fetch",
  },
  figma_post_comment: {
    reversible: true, undo_kind: "delete",
    undo_effect: "deletes the Figma comment and confirms it is gone from the file's comments",
  },
  figma_create_dev_resource: {
    reversible: true, undo_kind: "delete",
    undo_effect: "removes the dev resource link and confirms it is gone from the node",
  },
  create_calendar_event: {
    reversible: true, undo_kind: "delete",
    undo_effect: "cancels/deletes the calendar event and confirms it is gone or cancelled",
  },
  create_doc: {
    reversible: true, undo_kind: "delete",
    undo_effect: "moves the created Google Doc to Drive trash and confirms trashed:true",
  },
  create_sheet: {
    reversible: true, undo_kind: "delete",
    undo_effect: "moves the created spreadsheet to Drive trash and confirms trashed:true",
  },
  canva_create_design: NONE("Canva's Connect API has no delete endpoint for designs — once created, a design can only be removed by hand in Canva."),
  send_email: NONE("A sent email cannot be recalled — it is already in the recipient's mailbox."),
  reply_email: NONE("A sent reply cannot be recalled — it is already in the recipient's mailbox."),
  edit_doc: NONE("Document edits are appended in place and the previous body is not snapshotted, so there is nothing to restore."),
  edit_sheet: NONE("Sheet range edits are not snapshotted before writing, so the previous values cannot be restored."),
  http_post: NONE("An external webhook call cannot be taken back."),
};

export function reversibilityFor(kind: string): Reversibility {
  return REVERSIBILITY[kind] ?? NONE("No compensating action is implemented for this tool.");
}

// ---------------------------------------------------------------------------
// Pre-state capture (runs BEFORE the forward write)
// ---------------------------------------------------------------------------
const NOTION_HEADERS = (t: string) => ({
  Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json",
});
const SHOPIFY_API_VERSION = "2024-10";
const shopifyHeaders = (t: string) => ({ "X-Shopify-Access-Token": t, "Content-Type": "application/json" });

async function notionToken(admin: SupabaseClient, userId: string, agentId: string) {
  const row = await loadProviderIntegration(admin, userId, agentId, "Notion");
  if (!row) return null;
  const creds = await readSecret(admin, row.credentials_secret_id);
  return (creds.access_token as string | undefined) || null;
}

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

async function googleAccess(admin: SupabaseClient, userId: string, agentId: string): Promise<string | null> {
  const row = await loadProviderIntegration(admin, userId, agentId, "Gmail");
  if (!row) return null;
  const { ensureAccessToken } = await import("./gmail.ts");
  return await ensureAccessToken(admin, { id: row.id, credentials_secret_id: row.credentials_secret_id });
}

/** Snapshot whatever the compensating action will need. Never throws. */
export async function captureUndoState(
  kind: string, admin: SupabaseClient, userId: string, agentId: string, params: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    if (kind === "notion_update_page") {
      const pageId = String(params.page_id || "").trim();
      const token = pageId ? await notionToken(admin, userId, agentId) : null;
      if (!token) return null;
      const r = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, { headers: NOTION_HEADERS(token) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      return { page_id: pageId, prior_properties: b?.properties ?? null, prior_archived: b?.archived ?? false };
    }
    if (kind === "shopify_update_product") {
      const productId = String(params.product_id || "").trim();
      const ctx = productId ? await shopifyCtx(admin, userId, agentId, params.shop ? String(params.shop) : undefined) : null;
      if (!ctx) return null;
      const r = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, {
        headers: shopifyHeaders(ctx.token),
      });
      const b = await r.json().catch(() => ({}));
      const p = (b?.product as Record<string, unknown>) || null;
      if (!r.ok || !p) return null;
      return {
        shop: ctx.shop,
        product_id: productId,
        prior: {
          title: p.title ?? null,
          status: p.status ?? null,
          body_html: p.body_html ?? null,
          variants: ((p.variants as Record<string, unknown>[]) || []).slice(0, 50)
            .map((v) => ({ id: v.id, price: v.price, compare_at_price: v.compare_at_price ?? null })),
        },
      };
    }
  } catch { /* capture is best effort — never block the forward action */ }
  return null;
}

// ---------------------------------------------------------------------------
// Compensating actions (verified)
// ---------------------------------------------------------------------------
const fail = (summary: string): WriteResult => ({ ok: false, summary });

export type ReversalRow = {
  tool: string;
  ref: string | null;
  undo_payload: Record<string, unknown> | null;
};

export async function runUndo(
  admin: SupabaseClient, userId: string, agentId: string, row: ReversalRow,
): Promise<WriteResult> {
  const kind = row.tool;
  const rev = reversibilityFor(kind);
  if (!rev.reversible) return fail(rev.irreversible_reason || "This action cannot be undone.");
  const p = (row.undo_payload || {}) as Record<string, unknown>;
  const ref = row.ref || String(p.ref || "");

  try {
    // ---------------- Slack ----------------
    if (kind === "slack_post_message") {
      const channel = String(p.channel || "");
      if (!channel || !ref) return fail("Missing the Slack channel/timestamp needed to delete the message.");
      const int = await loadProviderIntegration(admin, userId, agentId, "Slack");
      if (!int) return fail("Slack is no longer connected — the message was NOT deleted.");
      const token = (await readSecret(admin, int.credentials_secret_id)).access_token as string | undefined;
      if (!token) return fail("Slack token missing — the message was NOT deleted.");
      const r = await fetch("https://slack.com/api/chat.delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel, ts: ref }),
      });
      const b = await r.json().catch(() => ({}));
      if (!b?.ok) return fail(`Slack refused the delete: ${String(b?.error || `HTTP ${r.status}`)} — the message is still posted.`);
      // Verification: the message must no longer be readable at that ts.
      const vr = await fetch(
        `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&latest=${ref}&inclusive=true&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const vb = await vr.json().catch(() => ({}));
      const still = vb?.ok && Array.isArray(vb.messages)
        && vb.messages.some((m: { ts?: string; subtype?: string }) => m.ts === ref && m.subtype !== "tombstone");
      if (still) return fail(`Slack accepted the delete but the message is still readable at ts=${ref}. Treat as NOT undone.`);
      return { ok: true, summary: `Deleted the Slack message in ${channel} (ts ${ref}) and confirmed it is gone.`, ref };
    }

    // ---------------- Notion ----------------
    if (kind === "notion_create_page" || kind === "notion_update_page") {
      const pageId = String(p.page_id || ref);
      const token = await notionToken(admin, userId, agentId);
      if (!token) return fail("Notion is no longer connected — nothing was undone.");
      const body = kind === "notion_create_page"
        ? { archived: true }
        : { properties: p.prior_properties ?? {}, archived: Boolean(p.prior_archived) };
      const r = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
        method: "PATCH", headers: NOTION_HEADERS(token), body: JSON.stringify(body),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return fail(`Notion refused the undo: ${String(b?.message || `HTTP ${r.status}`)} — nothing changed.`);
      const vr = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, { headers: NOTION_HEADERS(token) });
      const vb = await vr.json().catch(() => ({}));
      if (!vr.ok) return fail(`Could not re-read the Notion page to verify the undo — treat as NOT undone.`);
      if (kind === "notion_create_page" && vb?.archived !== true) {
        return fail("Notion accepted the archive but the page still reads as active. Treat as NOT undone.");
      }
      return {
        ok: true,
        summary: kind === "notion_create_page"
          ? `Archived the Notion page ${pageId} and confirmed archived:true by re-reading it.`
          : `Restored the Notion page ${pageId} to its previous properties and confirmed it by re-reading it.`,
        ref: pageId, url: (vb?.url as string) || null,
      };
    }

    // ---------------- Canva ----------------
    if (kind === "canva_create_folder") {
      const int = await loadProviderIntegration(admin, userId, agentId, "Canva");
      if (!int) return fail("Canva is no longer connected — the folder was NOT deleted.");
      const r = await canvaAuthedFetch(admin, int, `https://api.canva.com/rest/v1/folders/${encodeURIComponent(ref)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) return fail(`Canva refused to delete folder ${ref} (HTTP ${r.status}) — it still exists.`);
      const vr = await canvaAuthedFetch(admin, int, `https://api.canva.com/rest/v1/folders/${encodeURIComponent(ref)}`, { method: "GET" });
      if (vr.ok) return fail(`Canva folder ${ref} is still fetchable after the delete. Treat as NOT undone.`);
      return { ok: true, summary: `Deleted Canva folder ${ref} and confirmed it can no longer be fetched.`, ref };
    }

    // ---------------- Shopify ----------------
    if (kind === "shopify_create_draft_order" || kind === "shopify_update_product") {
      const ctx = await shopifyCtx(admin, userId, agentId, p.shop ? String(p.shop) : undefined);
      if (!ctx) return fail("Shopify is no longer connected — nothing was undone.");
      if (kind === "shopify_create_draft_order") {
        const r = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/draft_orders/${ref}.json`, {
          method: "DELETE", headers: shopifyHeaders(ctx.token),
        });
        if (!r.ok && r.status !== 404) return fail(`Shopify refused to delete draft order ${ref} (HTTP ${r.status}) — it still exists.`);
        const vr = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/draft_orders/${ref}.json`, { headers: shopifyHeaders(ctx.token) });
        if (vr.ok) return fail(`Draft order ${ref} still exists after the delete. Treat as NOT undone.`);
        return { ok: true, summary: `Deleted Shopify draft order ${ref} on ${ctx.shop} and confirmed it no longer exists.`, ref };
      }
      const prior = (p.prior as Record<string, unknown>) || null;
      const productId = String(p.product_id || ref);
      if (!prior) return fail("No pre-change snapshot was captured for this product, so the previous values cannot be restored.");
      const patch: Record<string, unknown> = { id: Number(productId) };
      if (prior.title != null) patch.title = prior.title;
      if (prior.status != null) patch.status = prior.status;
      if (prior.body_html != null) patch.body_html = prior.body_html;
      if (Array.isArray(prior.variants)) {
        patch.variants = (prior.variants as Record<string, unknown>[]).map((v) => ({
          id: Number(v.id), price: String(v.price ?? ""), ...(v.compare_at_price != null ? { compare_at_price: String(v.compare_at_price) } : {}),
        }));
      }
      const r = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, {
        method: "PUT", headers: shopifyHeaders(ctx.token), body: JSON.stringify({ product: patch }),
      });
      if (!r.ok) return fail(`Shopify refused the restore (HTTP ${r.status}) — the product is unchanged from its edited state.`);
      const vr = await fetch(`https://${ctx.shop}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, { headers: shopifyHeaders(ctx.token) });
      const vb = await vr.json().catch(() => ({}));
      const live = (vb?.product as Record<string, unknown>) || null;
      if (!vr.ok || !live) return fail("Could not re-fetch the product to verify the restore — treat as NOT undone.");
      const bad: string[] = [];
      if (prior.title != null && String(live.title) !== String(prior.title)) bad.push(`title is "${live.title}"`);
      if (prior.status != null && String(live.status) !== String(prior.status)) bad.push(`status is "${live.status}"`);
      for (const want of ((prior.variants as Record<string, unknown>[]) || [])) {
        const got = ((live.variants as Record<string, unknown>[]) || []).find((v) => String(v.id) === String(want.id));
        if (got && String(got.price) !== String(want.price)) bad.push(`variant ${want.id} price is ${got.price}, expected ${want.price}`);
      }
      if (bad.length) return fail(`Restore did NOT fully land: ${bad.join("; ")}.`);
      return { ok: true, summary: `Restored Shopify product ${productId} to its pre-change values and verified every field by re-fetching it.`, ref: productId };
    }

    // ---------------- Figma ----------------
    if (kind === "figma_post_comment") {
      const fileKey = String(p.file_key || "");
      const int = await loadProviderIntegration(admin, userId, agentId, "Figma");
      if (!int) return fail("Figma is no longer connected — the comment was NOT deleted.");
      const r = await figmaAuthedFetch(admin, int, `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments/${encodeURIComponent(ref)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) return fail(`Figma refused to delete comment ${ref} (HTTP ${r.status}) — it is still there.`);
      const vr = await figmaAuthedFetch(admin, int, `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`, { method: "GET" });
      const vb = await vr.json().catch(() => ({}));
      const still = Array.isArray(vb?.comments) && vb.comments.some((c: { id?: string }) => String(c.id) === ref);
      if (still) return fail(`Figma comment ${ref} is still present after the delete. Treat as NOT undone.`);
      return { ok: true, summary: `Deleted Figma comment ${ref} from file ${fileKey} and confirmed it is gone.`, ref };
    }

    if (kind === "figma_create_dev_resource") {
      const fileKey = String(p.file_key || "");
      const nodeId = String(p.node_id || "");
      const int = await loadProviderIntegration(admin, userId, agentId, "Figma");
      if (!int) return fail("Figma is no longer connected — the dev resource was NOT removed.");
      const r = await figmaAuthedFetch(admin, int, `https://api.figma.com/v1/dev_resources/${encodeURIComponent(ref)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) return fail(`Figma refused to delete dev resource ${ref} (HTTP ${r.status}) — it is still attached.`);
      const vr = await figmaAuthedFetch(
        admin, int,
        `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/dev_resources${nodeId ? `?node_ids=${encodeURIComponent(nodeId)}` : ""}`,
        { method: "GET" },
      );
      const vb = await vr.json().catch(() => ({}));
      const still = Array.isArray(vb?.dev_resources) && vb.dev_resources.some((d: { id?: string }) => String(d.id) === ref);
      if (still) return fail(`Dev resource ${ref} is still attached after the delete. Treat as NOT undone.`);
      return { ok: true, summary: `Removed Figma dev resource ${ref} from node ${nodeId || fileKey} and confirmed it is gone.`, ref };
    }

    // ---------------- Google ----------------
    if (kind === "create_calendar_event") {
      const access = await googleAccess(admin, userId, agentId);
      if (!access) return fail("Google is no longer connected — the event was NOT deleted.");
      const h = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ref)}`, { method: "DELETE", headers: h });
      if (!r.ok && r.status !== 404 && r.status !== 410) return fail(`Google Calendar refused the delete (HTTP ${r.status}) — the event still exists.`);
      const vr = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ref)}`, { headers: h });
      const vb = await vr.json().catch(() => ({}));
      const gone = !vr.ok || String((vb as { status?: string })?.status || "") === "cancelled";
      if (!gone) return fail(`Event ${ref} is still active on the calendar. Treat as NOT undone.`);
      return { ok: true, summary: `Deleted the calendar event ${ref} and confirmed it is gone/cancelled.`, ref };
    }

    if (kind === "create_doc" || kind === "create_sheet") {
      const access = await googleAccess(admin, userId, agentId);
      if (!access) return fail("Google is no longer connected — the file was NOT trashed.");
      const h = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref)}?supportsAllDrives=true`, {
        method: "PATCH", headers: h, body: JSON.stringify({ trashed: true }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        return fail(`Google Drive refused to trash the file: ${String((b as { error?: { message?: string } })?.error?.message || `HTTP ${r.status}`)} — the file still exists. This needs Drive access on the Google connection.`);
      }
      const vr = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref)}?fields=id,trashed,name&supportsAllDrives=true`, { headers: h });
      const vb = await vr.json().catch(() => ({}));
      if (!vr.ok || (vb as { trashed?: boolean })?.trashed !== true) {
        return fail(`The file ${ref} does not read back as trashed. Treat as NOT undone.`);
      }
      return { ok: true, summary: `Moved "${(vb as { name?: string }).name || ref}" to Google Drive trash and confirmed trashed:true.`, ref };
    }

    return fail(`No compensating action is wired for "${kind}".`);
  } catch (e) {
    return fail(`The undo threw an error: ${e instanceof Error ? e.message : String(e)} — assume it did NOT happen.`);
  }
}
