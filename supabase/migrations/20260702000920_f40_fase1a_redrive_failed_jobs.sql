-- F40 Fase 1a: manual redrive lever for failed background jobs.
-- Resets error jobs to pending so claim_next_jobs picks them up after a fix ships.
-- Guards: orphan-recovery literal exclusion, recency window, FIFO cap.
-- NEVER touches quota_consumed (prevents double-charging org quota).

create or replace function public.redrive_failed_jobs(
  p_pattern text default null,
  p_limit int default 50,
  p_since timestamptz default (now() - interval '7 days')
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with candidates as (
    select id
    from background_jobs
    where status = 'error'
      and created_at >= p_since
      and error_message is distinct from 'Worker crashed or timed out after 5 minutes'
      and (p_pattern is null or error_message ilike '%' || p_pattern || '%')
    order by created_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update background_jobs bj
  set status = 'pending',
      retry_count = 0,
      next_retry_at = null,
      error_message = null,
      processing_started_at = null,
      processing_worker_id = null,
      completed_at = null
  from candidates c
  where bj.id = c.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Default-deny (regla S47): explicit revoke, service_role only.
revoke execute on function public.redrive_failed_jobs(text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.redrive_failed_jobs(text, int, timestamptz) to service_role;
