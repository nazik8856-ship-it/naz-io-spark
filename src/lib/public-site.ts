// One published site, opened by its link (id, subdomain or custom domain). The database function behind it returns only what the
// public preview renders: never the owner, the prompt or the generation notes, and it can not be used to list sites
// (user & data isolation, front 2). Visitors and signed-in users alike read a site this way; the tables themselves are owner-only.
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // the function is newer than the generated types

export type PublicSitePage = {
  id: string; slug: string; title: string; seo_description: string | null; sections: unknown[]; order_index: number;
};
export type PublicSite = {
  id: string; name: string | null; tagline: string | null; theme: unknown; images_status: string | null;
  /** Left out when only the title and description are asked for. */
  pages?: PublicSitePage[];
};

export async function fetchPublicSite(ref: string, metaOnly = false): Promise<PublicSite | null> {
  const { data, error } = await anyDb.rpc("get_public_site", { _ref: ref, _meta_only: metaOnly });
  if (error) throw error;
  return (data ?? null) as PublicSite | null;
}
