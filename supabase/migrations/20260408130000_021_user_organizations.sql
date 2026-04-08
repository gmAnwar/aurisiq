-- =============================================================
-- Migration 021: user_organizations (multi-org membership)
-- A user can now belong to multiple organizations with a role per org.
-- public.users.organization_id stays as the "primary org"; this table
-- holds every additional (or mirrored) membership. New permissive RLS
-- policies extend SELECT across every org the user is a member of,
-- without touching existing policies.
-- =============================================================

CREATE TABLE IF NOT EXISTS user_organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('captadora', 'gerente', 'direccion', 'agencia', 'super_admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_user_orgs_user ON user_organizations (user_id);
CREATE INDEX IF NOT EXISTS idx_user_orgs_org ON user_organizations (organization_id);

ALTER TABLE user_organizations ENABLE ROW LEVEL SECURITY;

-- Service role bypass so the admin API routes can read/write freely.
CREATE POLICY "user_organizations_service_role_bypass" ON user_organizations
  USING (true) WITH CHECK (true);

-- Backfill: mirror every user's primary org into user_organizations so
-- the multi-org queries see them even if the admin UI hasn't added them.
INSERT INTO user_organizations (user_id, organization_id, role)
SELECT id, organization_id, role
FROM public.users
WHERE organization_id IS NOT NULL
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- =============================================================
-- Permissive multi-org SELECT policies
-- (added alongside existing org policies — Postgres OR's them)
-- =============================================================

CREATE POLICY "organizations_multi_org_select" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid())
  );

CREATE POLICY "users_multi_org_select" ON users
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid())
  );

CREATE POLICY "scorecards_multi_org_select" ON scorecards
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid())
  );

CREATE POLICY "funnel_stages_multi_org_select" ON funnel_stages
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid())
  );

CREATE POLICY "lead_sources_multi_org_select" ON lead_sources
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid())
  );

CREATE POLICY "analyses_multi_org_select" ON analyses
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid())
  );

CREATE POLICY "analysis_phases_multi_org_select" ON analysis_phases
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid())
  );
