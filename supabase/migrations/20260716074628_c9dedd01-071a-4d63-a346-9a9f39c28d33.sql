
REVOKE EXECUTE ON FUNCTION public.create_integration_secret(JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_integration_secret(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_integration_secret(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_integration_secret(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_integration_secret(JSONB, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_integration_secret(UUID, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_integration_secret(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_integration_secret(UUID) FROM anon, authenticated;
