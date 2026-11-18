-- Connected AI tools store the provider's BASE address (https://api.groq.com/openai/v1); Outer Control adds /chat/completions
-- (Anthropic-style: /messages) when it calls the tool (supabase/functions/_shared/outer-control-tool-url.ts). Addresses saved in
-- full before are trimmed to their base. Applied after the functions that add the path were deployed; those also still accept a
-- full address, so no call breaks in between. An address with a query string (Azure's ?api-version=) is left as it is: the code
-- strips and re-adds the path around the query itself.
UPDATE public.external_tools
   SET endpoint_url = regexp_replace(endpoint_url, '/+(chat/completions|completions)/*$', '')
 WHERE request_format = 'openai_chat'
   AND endpoint_url ~ '^https://[^?#]*/(chat/completions|completions)/*$';

UPDATE public.external_tools
   SET endpoint_url = regexp_replace(endpoint_url, '/+messages/*$', '')
 WHERE request_format = 'anthropic_messages'
   AND endpoint_url ~ '^https://[^?#]*/messages/*$';
