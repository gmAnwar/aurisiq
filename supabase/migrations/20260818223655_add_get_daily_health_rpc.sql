create or replace function public.get_daily_health()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'db_size_mb', (pg_database_size(current_database()) / 1024 / 1024)::int,
    'http_response_mb', (pg_total_relation_size('net._http_response') / 1024 / 1024)::int,
    'cron_history_mb', (pg_total_relation_size('cron.job_run_details') / 1024 / 1024)::int,
    'stuck_pending', (
      select count(*) from public.background_jobs
      where status = 'pending' and created_at < now() - interval '30 minutes'
    ),
    'month_usage', (
      select coalesce(
        jsonb_agg(jsonb_build_object('org_id', o.id, 'slug', o.slug, 'plan', o.plan, 'completed', c.n)),
        '[]'::jsonb
      )
      from public.organizations o
      join lateral (
        select count(*) as n from public.analyses a
        where a.organization_id = o.id
          and a.status = 'completado'
          and a.created_at >= date_trunc('month', now() at time zone 'utc')
      ) c on true
      where c.n > 0
    )
  )
$$;

revoke all on function public.get_daily_health() from public, anon, authenticated;
grant execute on function public.get_daily_health() to service_role;
