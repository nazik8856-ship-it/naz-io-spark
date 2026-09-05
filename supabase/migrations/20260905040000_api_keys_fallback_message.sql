-- "/respond" MVP backlog, item 175: lets a company override the generic
-- "I don't have enough information to answer that." wording with their
-- own -- e.g. "Sorry, I can't help with that. Please contact
-- support@acme.com." -- applied everywhere that generic fallback would
-- otherwise be returned (the leak guard, item 164, and the grounding
-- check, item 5). Same "one discrete setting, one typed column" idiom as
-- response_persona (20260903020000_api_keys_response_persona.sql), never
-- a jsonb blob. Writable through the same POST /api-keys/:id/policy
-- endpoint response_persona already uses.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS fallback_message text
  CHECK (fallback_message IS NULL OR char_length(fallback_message) <= 500);
