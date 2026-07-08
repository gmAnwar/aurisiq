-- F40 Fase 1b: clasificación de errores en origen (diseño S47).
-- Forward-only: SIN backfill — los jobs failed históricos quedan error_kind NULL
-- por diseño.

-- 1. Columna + CHECK de los 4 valores
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS error_kind TEXT NULL;
ALTER TABLE background_jobs DROP CONSTRAINT IF EXISTS background_jobs_error_kind_check;
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_error_kind_check
  CHECK (error_kind IS NULL OR error_kind IN ('infra_transient', 'needs_deploy', 'content', 'quota'));

-- 2. Orphan-recovery: kills terminales clasifican como infra_transient
-- (un worker crash/timeout ES transitorio). COALESCE preserva el kind del
-- último fallo real si el job ya traía uno de un intento previo — más
-- informativo que sobreescribirlo. cron.schedule con el mismo jobname
-- reemplaza el job existente.
SELECT cron.schedule(
  'aurisiq-orphan-recovery',
  '* * * * *',
  $$
  UPDATE background_jobs
  SET
    status = CASE
      WHEN retry_count < max_retries THEN 'pending'
      ELSE 'error'
    END,
    error_message = COALESCE(error_message, 'Worker crashed or timed out after 5 minutes'),
    error_kind = CASE
      WHEN retry_count < max_retries THEN error_kind
      ELSE COALESCE(error_kind, 'infra_transient')
    END,
    retry_count = retry_count + 1,
    next_retry_at = CASE
      WHEN retry_count < max_retries THEN NOW() + (CASE retry_count WHEN 0 THEN INTERVAL '10 seconds' WHEN 1 THEN INTERVAL '1 minute' ELSE INTERVAL '5 minutes' END)
      ELSE NULL
    END,
    processing_started_at = NULL,
    processing_worker_id = NULL,
    completed_at = CASE WHEN retry_count < max_retries THEN NULL ELSE NOW() END,
    updated_at = NOW()
  WHERE status = 'processing'
    AND processing_started_at < NOW() - INTERVAL '5 minutes';
  $$
);

-- 3. redrive_failed_jobs gana p_error_kind (default null = comportamiento
-- idéntico al actual). Firma nueva → DROP explícito de la vieja para no dejar
-- un overload ambiguo.
DROP FUNCTION IF EXISTS public.redrive_failed_jobs(text, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.redrive_failed_jobs(
  p_pattern text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_since timestamptz DEFAULT (now() - interval '7 days'),
  p_error_kind text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH candidates AS (
    SELECT id
    FROM background_jobs
    WHERE status = 'error'
      AND created_at >= p_since
      -- EXCLUSIÓN INCONDICIONAL del literal orphan. NO se reemplaza por el
      -- filtro de error_kind: los kills del cron llevan error_kind =
      -- 'infra_transient', así que un redrive por ese kind los incluiría y
      -- resucitaría jobs que orphan-recovery acaba de matar (ciclo
      -- kill → redrive → kill). El filtro p_error_kind de abajo es un AND
      -- ADICIONAL, nunca sustituye esta línea.
      AND error_message IS DISTINCT FROM 'Worker crashed or timed out after 5 minutes'
      AND (p_pattern IS NULL OR error_message ILIKE '%' || p_pattern || '%')
      AND (p_error_kind IS NULL OR error_kind = p_error_kind)
    ORDER BY created_at ASC
    LIMIT greatest(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE background_jobs bj
  SET status = 'pending',
      retry_count = 0,
      next_retry_at = NULL,
      error_message = NULL,
      error_kind = NULL,
      processing_started_at = NULL,
      processing_worker_id = NULL,
      completed_at = NULL
  FROM candidates c
  WHERE bj.id = c.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Default-deny (regla S47): explicit revoke, service_role only.
REVOKE EXECUTE ON FUNCTION public.redrive_failed_jobs(text, int, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redrive_failed_jobs(text, int, timestamptz, text) TO service_role;
