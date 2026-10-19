-- Outer Control: a connector can speak MCP (Model Context Protocol). For such a connector `model` holds the name of the MCP tool to
-- call (empty when the server offers exactly one tool).
ALTER TABLE public.external_tools DROP CONSTRAINT IF EXISTS external_tools_request_format_check;
ALTER TABLE public.external_tools
  ADD CONSTRAINT external_tools_request_format_check
  CHECK (request_format IN ('openai_chat', 'anthropic_messages', 'generic_json', 'mcp'));
