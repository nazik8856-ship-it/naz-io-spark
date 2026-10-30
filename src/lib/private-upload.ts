// User & data isolation: files a user attaches (prompt images, clarification answers, brand assets, mission files) are stored in
// the private `user-uploads` bucket under their own folder and shared as short-lived signed links. Nobody else can open or list
// them. When a generated site places an attached image, the site generator publishes a copy of just that image with the site
// (supabase/functions/_shared/uploaded-assets.ts).
import { supabase } from "@/integrations/supabase/client";

export const UPLOADS_BUCKET = "user-uploads";
export const DAY = 24 * 60 * 60;

/** Uploads to `<user id>/<path>` and returns a signed link valid for `expiresIn` seconds. */
export async function uploadPrivate(
  userId: string, path: string, file: File, opts: { expiresIn: number; upsert?: boolean; contentType?: string },
): Promise<string> {
  const key = `${userId}/${path}`;
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).upload(key, file, { upsert: opts.upsert ?? false, contentType: opts.contentType });
  if (error) throw error;
  const { data, error: signErr } = await supabase.storage.from(UPLOADS_BUCKET).createSignedUrl(key, opts.expiresIn);
  if (signErr || !data?.signedUrl) throw signErr ?? new Error("Could not create a link to the uploaded file.");
  return data.signedUrl;
}
