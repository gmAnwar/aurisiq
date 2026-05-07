-- 034: Orphan recovery cron — rescue stuck jobs every minute
-- Jobs stuck in 'processing' for >5 minutes get retried or marked as error

SELECT cron.schedule(
  'aurisiq-orphan-recovery',
  '1 minute',
  $$
  UPDATE background_jobs
  SET
    status = CASE
      WHEN retry_count < max_retries THEN 'pending'
      ELSE 'error'
    END,
    error_message = COALESCE(error_message, 'Worker crashed or timed out after 5 minutes'),
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
