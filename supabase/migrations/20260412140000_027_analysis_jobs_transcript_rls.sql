-- 027: User-level RLS for transcription editing on analysis_jobs
-- Captadora can only UPDATE transcription_edited on own records.
-- Gerente/super_admin can update any record in their org.

-- Drop the broad org-level ALL policy first
DROP POLICY IF EXISTS "analysis_jobs_org" ON analysis_jobs;

-- SELECT: org-level (unchanged behavior)
CREATE POLICY "analysis_jobs_select" ON analysis_jobs
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- INSERT: org-level (worker inserts, user creates via C2)
CREATE POLICY "analysis_jobs_insert" ON analysis_jobs
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- UPDATE: user-level for captadora, org-level for gerente+
CREATE POLICY "analysis_jobs_update" ON analysis_jobs
  FOR UPDATE USING (
    CASE
      WHEN get_user_role() IN ('gerente', 'direccion', 'agencia', 'super_admin')
        THEN organization_id = get_user_org_id()
      ELSE user_id = auth.uid()
    END
  );

-- DELETE: restrict to super_admin only
CREATE POLICY "analysis_jobs_delete" ON analysis_jobs
  FOR DELETE USING (
    get_user_role() = 'super_admin'
  );
