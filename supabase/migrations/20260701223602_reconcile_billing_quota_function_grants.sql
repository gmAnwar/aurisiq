-- Reconciliation: mirrors the security grants ALREADY APPLIED directly to
-- production (2026-07-01). Replaces the earlier revoke-from-anon/authenticated
-- migration, which was incorrect: several grants lived on the PUBLIC role, so
-- revoking only from anon/authenticated would not have closed the hole.
-- Verified against pg_proc.proacl in prod: every function below now holds
-- EXECUTE for postgres + service_role only, except get_org_quota which keeps
-- authenticated (frontend calls it) and only loses anon.

-- Grupo 1: grant estaba en PUBLIC
REVOKE EXECUTE ON FUNCTION public.upgrade_org_plan(text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_grace_period(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_grace_period(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atribuye_lfpdppp_hard_delete(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upgrade_org_plan(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_grace_period(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_grace_period(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.atribuye_lfpdppp_hard_delete(uuid, text, uuid) TO service_role;
-- Grupo 2: grant directo en anon/authenticated
REVOKE EXECUTE ON FUNCTION public.expire_grace_periods() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_starter_orgs() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_and_increment_analysis_count(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_org_quota(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atribuye_get_meta_secret(uuid, uuid) FROM anon, authenticated;
