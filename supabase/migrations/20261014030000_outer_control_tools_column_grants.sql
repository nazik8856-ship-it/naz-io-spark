-- Clients may read a tool's public fields, never the pointer to its vault credential.
REVOKE SELECT ON public.external_tools FROM authenticated;
GRANT SELECT (
  id, user_id, name, endpoint_url, request_format, model, auth_header, auth_scheme, enabled,
  approved_at, approved_by, last_checked_at, last_ok_at, last_error, created_at, updated_at
) ON public.external_tools TO authenticated;
