-- Data encryption, front 1: every address NazAI sends a customer's data to is https. The server functions already check this when
-- an address is saved through them, but the website can also write webhooks.url and api_keys.callback_url directly (row level
-- security allows the owner to). These checks hold whatever path writes the row, so a plain http:// address can never be stored
-- and later receive signed events or callbacks unencrypted. external_tools.endpoint_url may also hold NazAI's internal placeholder
-- schemes (nazai-internal://, nazai-agent://), which are never fetched.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_url_https') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_url_https CHECK (url ~* '^https://') NOT VALID;
    ALTER TABLE public.webhooks VALIDATE CONSTRAINT webhooks_url_https;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_callback_url_https') THEN
    ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_callback_url_https
      CHECK (callback_url IS NULL OR callback_url = '' OR callback_url ~* '^https://') NOT VALID;
    ALTER TABLE public.api_keys VALIDATE CONSTRAINT api_keys_callback_url_https;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_tools_endpoint_https') THEN
    ALTER TABLE public.external_tools ADD CONSTRAINT external_tools_endpoint_https
      CHECK (endpoint_url ~* '^(https://|nazai-internal://|nazai-agent://)') NOT VALID;
    ALTER TABLE public.external_tools VALIDATE CONSTRAINT external_tools_endpoint_https;
  END IF;
END $$;
