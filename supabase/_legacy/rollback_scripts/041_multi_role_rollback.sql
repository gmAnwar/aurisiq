-- 041 ROLLBACK — Revert multi-role migration
-- Run this ONLY if 041 needs to be reverted

-- 1. Drop trigger
DROP TRIGGER IF EXISTS users_sync_role_roles ON users;
DROP TRIGGER IF EXISTS invitations_sync_role_roles ON invitations;
DROP FUNCTION IF EXISTS sync_users_role_roles();

-- 2. Drop new function
DROP FUNCTION IF EXISTS get_user_roles();

-- 3. Restore get_user_role() to original (reads role column directly)
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. Drop GIN index
DROP INDEX IF EXISTS idx_users_roles;

-- 5. Drop constraints on roles columns
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_roles_not_empty;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_roles_valid;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_roles_not_empty;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_roles_valid;

-- 6. Drop roles columns
ALTER TABLE users DROP COLUMN IF EXISTS roles;
ALTER TABLE invitations DROP COLUMN IF EXISTS roles;

-- 7. Revert ALL 39 policies to original (using get_user_role() returning TEXT)
-- NOTE: The policies below use get_user_role() which was restored in step 3

-- organizations
DROP POLICY IF EXISTS "users_view_own_org" ON organizations;
CREATE POLICY "users_view_own_org" ON organizations
  FOR SELECT USING (id = get_user_org_id() OR get_user_role() = 'super_admin');

-- users
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users
  FOR SELECT USING (
    CASE get_user_role()
      WHEN 'super_admin' THEN true
      WHEN 'captadora' THEN id = auth.uid()
      ELSE organization_id = get_user_org_id()
    END
  );

-- scorecards
DROP POLICY IF EXISTS "scorecards_select" ON scorecards;
CREATE POLICY "scorecards_select" ON scorecards
  FOR SELECT USING (organization_id IS NULL OR organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "scorecards_modify_global" ON scorecards;
CREATE POLICY "scorecards_modify_global" ON scorecards
  FOR ALL USING (
    CASE WHEN organization_id IS NULL THEN get_user_role() = 'super_admin'
    ELSE organization_id = get_user_org_id() END
  );

-- invitations
DROP POLICY IF EXISTS "invitations_org" ON invitations;
CREATE POLICY "invitations_org" ON invitations
  FOR ALL USING (organization_id = get_user_org_id() AND get_user_role() IN ('gerente', 'direccion', 'super_admin'));

-- funnel_config
DROP POLICY IF EXISTS "funnel_config_org" ON funnel_config;
CREATE POLICY "funnel_config_org" ON funnel_config
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- funnel_stages
DROP POLICY IF EXISTS "funnel_stages_org" ON funnel_stages;
CREATE POLICY "funnel_stages_org" ON funnel_stages
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- lead_sources
DROP POLICY IF EXISTS "lead_sources_org" ON lead_sources;
CREATE POLICY "lead_sources_org" ON lead_sources
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- analyses
DROP POLICY IF EXISTS "analyses_org" ON analyses;
CREATE POLICY "analyses_org" ON analyses
  FOR SELECT USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "analyses_update" ON analyses;
CREATE POLICY "analyses_update" ON analyses
  FOR UPDATE USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- analysis_jobs
DROP POLICY IF EXISTS "analysis_jobs_select" ON analysis_jobs;
CREATE POLICY "analysis_jobs_select" ON analysis_jobs
  FOR SELECT USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "analysis_jobs_insert" ON analysis_jobs;
CREATE POLICY "analysis_jobs_insert" ON analysis_jobs
  FOR INSERT WITH CHECK (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "analysis_jobs_update" ON analysis_jobs;
CREATE POLICY "analysis_jobs_update" ON analysis_jobs
  FOR UPDATE USING (
    CASE WHEN get_user_role() IN ('gerente', 'direccion', 'agencia', 'super_admin')
      THEN organization_id = get_user_org_id()
    ELSE user_id = auth.uid() END
  );

DROP POLICY IF EXISTS "analysis_jobs_delete" ON analysis_jobs;
CREATE POLICY "analysis_jobs_delete" ON analysis_jobs
  FOR DELETE USING (get_user_role() = 'super_admin');

-- analysis_phases
DROP POLICY IF EXISTS "analysis_phases_org" ON analysis_phases;
CREATE POLICY "analysis_phases_org" ON analysis_phases
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- descalification_categories
DROP POLICY IF EXISTS "descalification_categories_org" ON descalification_categories;
CREATE POLICY "descalification_categories_org" ON descalification_categories
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- speech_versions
DROP POLICY IF EXISTS "speech_versions_org" ON speech_versions;
CREATE POLICY "speech_versions_org" ON speech_versions
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- reports
DROP POLICY IF EXISTS "reports_org" ON reports;
CREATE POLICY "reports_org" ON reports
  FOR SELECT USING (
    (organization_id = get_user_org_id() OR get_user_role() = 'super_admin')
    AND (destinatario_tipo = 'todos'
      OR (get_user_role() = 'agencia' AND destinatario_tipo = 'agencia')
      OR (get_user_role() = 'direccion' AND destinatario_tipo IN ('direccion', 'equipo'))
      OR (get_user_role() = 'gerente' AND destinatario_tipo = 'equipo')
      OR get_user_role() = 'super_admin')
  );

-- alerts
DROP POLICY IF EXISTS "alerts_org" ON alerts;
CREATE POLICY "alerts_org" ON alerts
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- xp_events
DROP POLICY IF EXISTS "xp_events_org" ON xp_events;
CREATE POLICY "xp_events_org" ON xp_events
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- badges
DROP POLICY IF EXISTS "badges_select" ON badges;
CREATE POLICY "badges_select" ON badges
  FOR SELECT USING (organization_id IS NULL OR organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- user_badges
DROP POLICY IF EXISTS "user_badges_select" ON user_badges;
CREATE POLICY "user_badges_select" ON user_badges
  FOR SELECT USING (user_id = auth.uid() OR get_user_role() IN ('gerente', 'direccion', 'super_admin'));

-- objectives
DROP POLICY IF EXISTS "objectives_select" ON objectives;
CREATE POLICY "objectives_select" ON objectives
  FOR SELECT USING (
    CASE get_user_role()
      WHEN 'super_admin' THEN true
      WHEN 'captadora' THEN organization_id = get_user_org_id() AND (target_user_id = auth.uid() OR target_user_id IS NULL)
      ELSE organization_id = get_user_org_id()
    END
  );

DROP POLICY IF EXISTS "objectives_manage" ON objectives;
CREATE POLICY "objectives_manage" ON objectives
  FOR ALL USING (
    get_user_role() IN ('gerente', 'direccion', 'super_admin')
    AND (organization_id = get_user_org_id() OR get_user_role() = 'super_admin')
  );

-- objective_progress
DROP POLICY IF EXISTS "objective_progress_org" ON objective_progress;
CREATE POLICY "objective_progress_org" ON objective_progress
  FOR ALL USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

-- scorecard_templates
DROP POLICY IF EXISTS "scorecard_templates_select" ON scorecard_templates;
CREATE POLICY "scorecard_templates_select" ON scorecard_templates
  FOR SELECT USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "scorecard_templates_modify" ON scorecard_templates;
CREATE POLICY "scorecard_templates_modify" ON scorecard_templates
  FOR ALL USING (get_user_role() = 'super_admin') WITH CHECK (get_user_role() = 'super_admin');

-- transcript_edits
DROP POLICY IF EXISTS "transcript_edits_select" ON transcript_edits;
CREATE POLICY "transcript_edits_select" ON transcript_edits
  FOR SELECT USING (
    CASE WHEN get_user_role() IN ('gerente', 'direccion', 'agencia', 'super_admin')
      THEN EXISTS (SELECT 1 FROM analysis_jobs aj WHERE aj.id = transcript_edits.analysis_job_id AND aj.organization_id = get_user_org_id())
    ELSE user_id = auth.uid() END
  );

-- background_jobs
DROP POLICY IF EXISTS "background_jobs_select" ON background_jobs;
CREATE POLICY "background_jobs_select" ON background_jobs
  FOR SELECT USING (
    CASE WHEN get_user_role() IN ('gerente', 'direccion', 'agencia', 'super_admin')
      THEN organization_id = get_user_org_id()
    ELSE user_id = auth.uid() END
  );

DROP POLICY IF EXISTS "background_jobs_delete" ON background_jobs;
CREATE POLICY "background_jobs_delete" ON background_jobs
  FOR DELETE USING (get_user_role() = 'super_admin');

-- conversation_trackers
DROP POLICY IF EXISTS "conversation_trackers_select" ON conversation_trackers;
CREATE POLICY "conversation_trackers_select" ON conversation_trackers
  FOR SELECT USING (organization_id IS NULL OR organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "conversation_trackers_insert" ON conversation_trackers;
CREATE POLICY "conversation_trackers_insert" ON conversation_trackers
  FOR INSERT WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "conversation_trackers_update" ON conversation_trackers;
CREATE POLICY "conversation_trackers_update" ON conversation_trackers
  FOR UPDATE USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "conversation_trackers_delete" ON conversation_trackers;
CREATE POLICY "conversation_trackers_delete" ON conversation_trackers
  FOR DELETE USING (get_user_role() = 'super_admin');

-- stage_checklist_items
DROP POLICY IF EXISTS "stage_checklist_items_select" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_select" ON stage_checklist_items
  FOR SELECT USING (organization_id = get_user_org_id() OR get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "stage_checklist_items_insert" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_insert" ON stage_checklist_items
  FOR INSERT WITH CHECK (
    (organization_id = get_user_org_id() AND get_user_role() IN ('gerente', 'direccion'))
    OR get_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "stage_checklist_items_update" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_update" ON stage_checklist_items
  FOR UPDATE USING (
    (organization_id = get_user_org_id() AND get_user_role() IN ('gerente', 'direccion'))
    OR get_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "stage_checklist_items_delete" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_delete" ON stage_checklist_items
  FOR DELETE USING (
    (organization_id = get_user_org_id() AND get_user_role() IN ('gerente', 'direccion'))
    OR get_user_role() = 'super_admin'
  );
