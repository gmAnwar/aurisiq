-- 030: background_jobs table — job queue for async processing
-- Source of truth: canvas TECNICO F0ALYPV5D16 section "Tabla background_jobs"

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('analysis')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'error', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  result JSONB,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  processing_worker_id TEXT,
  quota_consumed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Trigger: auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_background_jobs_updated_at ON background_jobs;
CREATE TRIGGER trg_background_jobs_updated_at
  BEFORE UPDATE ON background_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Indices
CREATE INDEX IF NOT EXISTS idx_jobs_polling
  ON background_jobs (status, priority DESC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_jobs_org_status
  ON background_jobs (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_jobs_user
  ON background_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_stale
  ON background_jobs (processing_started_at)
  WHERE status = 'processing';

-- RLS
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;

-- SELECT: captadora sees own jobs, gerente+ sees all in org
DROP POLICY IF EXISTS "background_jobs_select" ON background_jobs;
CREATE POLICY "background_jobs_select" ON background_jobs
  FOR SELECT USING (
    CASE
      WHEN get_user_role() IN ('gerente', 'direccion', 'agencia', 'super_admin')
        THEN organization_id = get_user_org_id()
      ELSE user_id = auth.uid()
    END
  );

-- INSERT: user can only insert jobs for themselves
DROP POLICY IF EXISTS "background_jobs_insert" ON background_jobs;
CREATE POLICY "background_jobs_insert" ON background_jobs
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

-- UPDATE: no policy — default deny for authenticated, service_role bypasses RLS

-- DELETE: only super_admin
DROP POLICY IF EXISTS "background_jobs_delete" ON background_jobs;
CREATE POLICY "background_jobs_delete" ON background_jobs
  FOR DELETE USING (
    get_user_role() = 'super_admin'
  );

-- Cleanup: drop stale policy from earlier version if it exists
DROP POLICY IF EXISTS "background_jobs_update_deny" ON background_jobs;
