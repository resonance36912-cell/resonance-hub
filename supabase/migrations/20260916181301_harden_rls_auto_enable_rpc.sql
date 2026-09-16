-- RONSAS Supabase hardening
-- Keep the ensure_rls event trigger active while preventing direct RPC execution
-- of its SECURITY DEFINER helper from browser-facing roles.

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;