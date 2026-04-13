-- 041: Multi-role users — users.roles TEXT[] + RLS rewrite
-- Commit B of multi-role refactor. Additive only — does NOT drop role column.

-- ═══════════════════════════════════════════════════════════
-- 1. ADD COLUMN + BACKFILL + CONSTRAINTS
-- ═══════════════════════════════════════════════════════════

-- users.roles
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE users SET roles = ARRAY[role] WHERE array_length(roles, 1) IS NULL OR array_length(roles, 1) = 0;

-- Verify backfill
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM users WHERE array_length(roles, 1) IS NULL OR array_length(roles, 1) = 0) > 0 THEN
    RAISE EXCEPTION 'ABORT: some users have empty roles after backfill';
  END IF;
END $$;

-- Constraints (after backfill)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_roles_not_empty;
ALTER TABLE users ADD CONSTRAINT users_roles_not_empty CHECK (array_length(roles, 1) >= 1);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_roles_valid;
ALTER TABLE users ADD CONSTRAINT users_roles_valid CHECK (roles <@ ARRAY['captadora','gerente','direccion','agencia','super_admin']::TEXT[]);

-- invitations.roles
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE invitations SET roles = ARRAY[role] WHERE array_length(roles, 1) IS NULL OR array_length(roles, 1) = 0;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_roles_not_empty;
ALTER TABLE invitations ADD CONSTRAINT invitations_roles_not_empty CHECK (array_length(roles, 1) >= 1);
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_roles_valid;
ALTER TABLE invitations ADD CONSTRAINT invitations_roles_valid CHECK (roles <@ ARRAY['captadora','gerente','direccion','agencia','super_admin']::TEXT[]);

-- GIN index for array queries
CREATE INDEX IF NOT EXISTS idx_users_roles ON users USING GIN (roles);

-- ═══════════════════════════════════════════════════════════
-- 2. FUNCTIONS
-- ═══════════════════════════════════════════════════════════

-- New: returns roles array
CREATE OR REPLACE FUNCTION get_user_roles() RETURNS TEXT[] AS $$
  SELECT roles FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Compat: rewrite to read from roles[1] (same result for single-role users)
CREATE OR REPLACE FUNCTION get_user_role() RETURNS TEXT AS $$
  SELECT roles[1] FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════
-- 3. BIDIRECTIONAL SYNC TRIGGER
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_users_role_roles() RETURNS TRIGGER AS $$
BEGIN
  -- If roles changed, sync role = roles[1]
  IF NEW.roles IS DISTINCT FROM OLD.roles THEN
    NEW.role := NEW.roles[1];
  -- If role changed but NOT roles (legacy write), sync roles = ARRAY[role]
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.roles := ARRAY[NEW.role];
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_sync_role_roles ON users;
CREATE TRIGGER users_sync_role_roles
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_users_role_roles();

DROP TRIGGER IF EXISTS invitations_sync_role_roles ON invitations;
CREATE TRIGGER invitations_sync_role_roles
  BEFORE UPDATE ON invitations
  FOR EACH ROW
  EXECUTE FUNCTION sync_users_role_roles();

-- ═══════════════════════════════════════════════════════════
-- 4. REWRITE ALL 39 RLS POLICIES
-- Pattern: get_user_role() = 'X'  →  'X' = ANY(get_user_roles())
-- Pattern: get_user_role() IN (...)  →  get_user_roles() && ARRAY[...]
-- Pattern: CASE get_user_role() WHEN 'X' THEN ...  →  CASE WHEN 'X' = ANY(get_user_roles()) THEN ...
-- ═══════════════════════════════════════════════════════════

-- organizations
DROP POLICY IF EXISTS "users_view_own_org" ON organizations;
CREATE POLICY "users_view_own_org" ON organizations
  FOR SELECT USING (id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- users
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users
  FOR SELECT USING (
    CASE
      WHEN 'super_admin' = ANY(get_user_roles()) THEN true
      WHEN get_user_roles() && ARRAY['gerente','direccion','agencia'] THEN organization_id = get_user_org_id()
      ELSE id = auth.uid()
    END
  );

-- scorecards
DROP POLICY IF EXISTS "scorecards_select" ON scorecards;
CREATE POLICY "scorecards_select" ON scorecards
  FOR SELECT USING (organization_id IS NULL OR organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "scorecards_modify_global" ON scorecards;
CREATE POLICY "scorecards_modify_global" ON scorecards
  FOR ALL USING (
    CASE WHEN organization_id IS NULL THEN 'super_admin' = ANY(get_user_roles())
    ELSE organization_id = get_user_org_id() END
  );

-- invitations
DROP POLICY IF EXISTS "invitations_org" ON invitations;
CREATE POLICY "invitations_org" ON invitations
  FOR ALL USING (
    organization_id = get_user_org_id()
    AND get_user_roles() && ARRAY['gerente','direccion','super_admin']
  );

-- funnel_config
DROP POLICY IF EXISTS "funnel_config_org" ON funnel_config;
CREATE POLICY "funnel_config_org" ON funnel_config
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- funnel_stages
DROP POLICY IF EXISTS "funnel_stages_org" ON funnel_stages;
CREATE POLICY "funnel_stages_org" ON funnel_stages
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- lead_sources
DROP POLICY IF EXISTS "lead_sources_org" ON lead_sources;
CREATE POLICY "lead_sources_org" ON lead_sources
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- analyses
DROP POLICY IF EXISTS "analyses_org" ON analyses;
CREATE POLICY "analyses_org" ON analyses
  FOR SELECT USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "analyses_update" ON analyses;
CREATE POLICY "analyses_update" ON analyses
  FOR UPDATE USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- analysis_jobs (from migration 027)
DROP POLICY IF EXISTS "analysis_jobs_select" ON analysis_jobs;
CREATE POLICY "analysis_jobs_select" ON analysis_jobs
  FOR SELECT USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "analysis_jobs_insert" ON analysis_jobs;
CREATE POLICY "analysis_jobs_insert" ON analysis_jobs
  FOR INSERT WITH CHECK (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "analysis_jobs_update" ON analysis_jobs;
CREATE POLICY "analysis_jobs_update" ON analysis_jobs
  FOR UPDATE USING (
    CASE
      WHEN get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
        THEN organization_id = get_user_org_id()
      ELSE user_id = auth.uid()
    END
  );

DROP POLICY IF EXISTS "analysis_jobs_delete" ON analysis_jobs;
CREATE POLICY "analysis_jobs_delete" ON analysis_jobs
  FOR DELETE USING ('super_admin' = ANY(get_user_roles()));

-- analysis_phases
DROP POLICY IF EXISTS "analysis_phases_org" ON analysis_phases;
CREATE POLICY "analysis_phases_org" ON analysis_phases
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- descalification_categories
DROP POLICY IF EXISTS "descalification_categories_org" ON descalification_categories;
CREATE POLICY "descalification_categories_org" ON descalification_categories
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- speech_versions
DROP POLICY IF EXISTS "speech_versions_org" ON speech_versions;
CREATE POLICY "speech_versions_org" ON speech_versions
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- reports
DROP POLICY IF EXISTS "reports_org" ON reports;
CREATE POLICY "reports_org" ON reports
  FOR SELECT USING (
    (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()))
    AND (
      destinatario_tipo = 'todos'
      OR ('agencia' = ANY(get_user_roles()) AND destinatario_tipo = 'agencia')
      OR ('direccion' = ANY(get_user_roles()) AND destinatario_tipo IN ('direccion', 'equipo'))
      OR ('gerente' = ANY(get_user_roles()) AND destinatario_tipo = 'equipo')
      OR 'super_admin' = ANY(get_user_roles())
    )
  );

-- alerts
DROP POLICY IF EXISTS "alerts_org" ON alerts;
CREATE POLICY "alerts_org" ON alerts
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- xp_events
DROP POLICY IF EXISTS "xp_events_org" ON xp_events;
CREATE POLICY "xp_events_org" ON xp_events
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- badges
DROP POLICY IF EXISTS "badges_select" ON badges;
CREATE POLICY "badges_select" ON badges
  FOR SELECT USING (organization_id IS NULL OR organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- user_badges
DROP POLICY IF EXISTS "user_badges_select" ON user_badges;
CREATE POLICY "user_badges_select" ON user_badges
  FOR SELECT USING (user_id = auth.uid() OR get_user_roles() && ARRAY['gerente','direccion','super_admin']);

-- objectives
DROP POLICY IF EXISTS "objectives_select" ON objectives;
CREATE POLICY "objectives_select" ON objectives
  FOR SELECT USING (
    CASE
      WHEN 'super_admin' = ANY(get_user_roles()) THEN true
      WHEN 'captadora' = ANY(get_user_roles()) AND NOT get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
        THEN organization_id = get_user_org_id() AND (target_user_id = auth.uid() OR target_user_id IS NULL)
      ELSE organization_id = get_user_org_id()
    END
  );

DROP POLICY IF EXISTS "objectives_manage" ON objectives;
CREATE POLICY "objectives_manage" ON objectives
  FOR ALL USING (
    get_user_roles() && ARRAY['gerente','direccion','super_admin']
    AND (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()))
  );

-- objective_progress
DROP POLICY IF EXISTS "objective_progress_org" ON objective_progress;
CREATE POLICY "objective_progress_org" ON objective_progress
  FOR ALL USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

-- scorecard_templates
DROP POLICY IF EXISTS "scorecard_templates_select" ON scorecard_templates;
CREATE POLICY "scorecard_templates_select" ON scorecard_templates
  FOR SELECT USING ('super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "scorecard_templates_modify" ON scorecard_templates;
CREATE POLICY "scorecard_templates_modify" ON scorecard_templates
  FOR ALL USING ('super_admin' = ANY(get_user_roles()))
  WITH CHECK ('super_admin' = ANY(get_user_roles()));

-- transcript_edits
DROP POLICY IF EXISTS "transcript_edits_select" ON transcript_edits;
CREATE POLICY "transcript_edits_select" ON transcript_edits
  FOR SELECT USING (
    CASE
      WHEN get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
        THEN EXISTS (SELECT 1 FROM analysis_jobs aj WHERE aj.id = transcript_edits.analysis_job_id AND aj.organization_id = get_user_org_id())
      ELSE user_id = auth.uid()
    END
  );

-- background_jobs
DROP POLICY IF EXISTS "background_jobs_select" ON background_jobs;
CREATE POLICY "background_jobs_select" ON background_jobs
  FOR SELECT USING (
    CASE
      WHEN get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
        THEN organization_id = get_user_org_id()
      ELSE user_id = auth.uid()
    END
  );

DROP POLICY IF EXISTS "background_jobs_delete" ON background_jobs;
CREATE POLICY "background_jobs_delete" ON background_jobs
  FOR DELETE USING ('super_admin' = ANY(get_user_roles()));

-- conversation_trackers
DROP POLICY IF EXISTS "conversation_trackers_select" ON conversation_trackers;
CREATE POLICY "conversation_trackers_select" ON conversation_trackers
  FOR SELECT USING (organization_id IS NULL OR organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "conversation_trackers_insert" ON conversation_trackers;
CREATE POLICY "conversation_trackers_insert" ON conversation_trackers
  FOR INSERT WITH CHECK ('super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "conversation_trackers_update" ON conversation_trackers;
CREATE POLICY "conversation_trackers_update" ON conversation_trackers
  FOR UPDATE USING ('super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "conversation_trackers_delete" ON conversation_trackers;
CREATE POLICY "conversation_trackers_delete" ON conversation_trackers
  FOR DELETE USING ('super_admin' = ANY(get_user_roles()));

-- stage_checklist_items
DROP POLICY IF EXISTS "stage_checklist_items_select" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_select" ON stage_checklist_items
  FOR SELECT USING (organization_id = get_user_org_id() OR 'super_admin' = ANY(get_user_roles()));

DROP POLICY IF EXISTS "stage_checklist_items_insert" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_insert" ON stage_checklist_items
  FOR INSERT WITH CHECK (
    (organization_id = get_user_org_id() AND get_user_roles() && ARRAY['gerente','direccion'])
    OR 'super_admin' = ANY(get_user_roles())
  );

DROP POLICY IF EXISTS "stage_checklist_items_update" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_update" ON stage_checklist_items
  FOR UPDATE USING (
    (organization_id = get_user_org_id() AND get_user_roles() && ARRAY['gerente','direccion'])
    OR 'super_admin' = ANY(get_user_roles())
  );

DROP POLICY IF EXISTS "stage_checklist_items_delete" ON stage_checklist_items;
CREATE POLICY "stage_checklist_items_delete" ON stage_checklist_items
  FOR DELETE USING (
    (organization_id = get_user_org_id() AND get_user_roles() && ARRAY['gerente','direccion'])
    OR 'super_admin' = ANY(get_user_roles())
  );

-- ═══════════════════════════════════════════════════════════
-- 5. POLICIES NOT TOUCHED (no get_user_role() usage):
--    analyses_insert, background_jobs_insert, transcript_edits_insert
-- ═══════════════════════════════════════════════════════════
