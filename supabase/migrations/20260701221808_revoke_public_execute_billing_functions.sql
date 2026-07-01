-- Revoke EXECUTE on internal billing / privileged functions from public REST roles.
-- These are invoked exclusively via service_role (Stripe webhook in the Worker,
-- internal jobs) and must not be callable through PostgREST with anon/user JWTs.
-- Verified: only worker/src/index.js calls upgrade_org_plan, start_grace_period
-- and resolve_grace_period, always with SUPABASE_SERVICE_ROLE_KEY.

REVOKE EXECUTE ON FUNCTION public.upgrade_org_plan(text, text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_grace_period(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_grace_period(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atribuye_lfpdppp_hard_delete(uuid, text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atribuye_get_meta_secret(uuid, uuid) FROM anon, authenticated;
