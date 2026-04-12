-- 028: Audit log for transcription edits
-- Every save in TranscriptEditor creates a row before overwriting analysis_jobs.

CREATE TABLE transcript_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_job_id UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  previous_text TEXT NOT NULL,
  new_text TEXT NOT NULL,
  edit_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transcript_edits_job ON transcript_edits (analysis_job_id, created_at DESC);
CREATE INDEX idx_transcript_edits_user ON transcript_edits (user_id, created_at DESC);

-- RLS
ALTER TABLE transcript_edits ENABLE ROW LEVEL SECURITY;

-- SELECT: gerente/direccion/super_admin see all in their org via join.
-- Captadora sees only own edits.
CREATE POLICY "transcript_edits_select" ON transcript_edits
  FOR SELECT USING (
    CASE
      WHEN get_user_role() IN ('gerente', 'direccion', 'agencia', 'super_admin')
        THEN EXISTS (
          SELECT 1 FROM analysis_jobs aj
          WHERE aj.id = transcript_edits.analysis_job_id
            AND aj.organization_id = get_user_org_id()
        )
      ELSE user_id = auth.uid()
    END
  );

-- INSERT: anyone can log their own edits
CREATE POLICY "transcript_edits_insert" ON transcript_edits
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

-- No UPDATE or DELETE — audit log is append-only
