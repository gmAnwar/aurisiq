-- 031: claim_next_jobs RPC — atomic job claiming for process-queue
-- Source of truth: canvas TECNICO F0ALYPV5D16 section "Funcion claim_next_jobs"

CREATE OR REPLACE FUNCTION claim_next_jobs(p_limit INTEGER, p_worker_id TEXT)
RETURNS SETOF background_jobs AS $$
BEGIN
  RETURN QUERY
  UPDATE background_jobs
  SET
    status = 'processing',
    processing_started_at = NOW(),
    processing_worker_id = p_worker_id,
    updated_at = NOW()
  WHERE id IN (
    SELECT id FROM background_jobs
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke from public FIRST, then grant only to service_role
REVOKE EXECUTE ON FUNCTION claim_next_jobs(INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_next_jobs(INTEGER, TEXT) TO service_role;
