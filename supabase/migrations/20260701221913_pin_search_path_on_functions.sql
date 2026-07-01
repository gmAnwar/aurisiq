-- Lint 0011 (function_search_path_mutable): pin search_path on public functions.
-- All bodies reference only public tables (auth.uid() is already schema-qualified),
-- so 'public', 'pg_temp' is safe for every one. Signatures verified against pg_proc.

ALTER FUNCTION public.check_and_increment_analysis_count(uuid, integer) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.get_user_org_id() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.get_user_role() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.get_user_roles() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.expire_starter_orgs() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.expire_grace_periods() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.start_grace_period(text) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.resolve_grace_period(text) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.get_org_quota(uuid) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.upgrade_org_plan(text, text, uuid) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.set_updated_at() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.claim_next_jobs(integer, text) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.validate_scorecard_phases_schema(jsonb) SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.sync_users_role_roles() SET search_path = 'public', 'pg_temp';
ALTER FUNCTION public.reset_stale_streaks() SET search_path = 'public', 'pg_temp';
