-- =============================================================
-- AurisIQ Schema Completo - Session 1.1
-- Fuente de verdad: Canvas TECNICO F0ALYPV5D16
-- Orden de creacion respeta FK ordering
-- =============================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- =============================================================
-- 1. organizations
-- =============================================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'growth', 'pro', 'scale', 'enterprise', 'founder')),
  founder_account BOOLEAN DEFAULT false,
  analyses_count INTEGER DEFAULT 0 NOT NULL,
  timezone TEXT DEFAULT 'America/Mexico_City',
  access_status TEXT NOT NULL DEFAULT 'active'
    CHECK (access_status IN ('active', 'grace', 'read_only')),
  stripe_customer_id TEXT,
  stripe_grace_started_at TIMESTAMPTZ,
  conversion_baseline DECIMAL,
  ticket_promedio DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations (slug);

-- =============================================================
-- 2. users
-- =============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('captadora', 'gerente', 'direccion', 'agencia', 'super_admin')),
  photo_url TEXT,
  active BOOLEAN DEFAULT true,
  last_sign_in_at TIMESTAMPTZ,
  xp_total INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_analysis_date DATE,
  current_focus_phase TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users (organization_id, active);
CREATE INDEX idx_users_role ON users (organization_id, role);

-- =============================================================
-- 3. scorecards
-- =============================================================
CREATE TABLE scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  vertical TEXT NOT NULL,
  phases JSONB NOT NULL,
  prompt_template TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scorecards_org ON scorecards (organization_id, active);

-- =============================================================
-- 4. invitations
-- =============================================================
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('captadora', 'gerente', 'direccion', 'agencia', 'super_admin')),
  token TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitations_org ON invitations (organization_id, accepted_at);
CREATE INDEX idx_invitations_token ON invitations (token);

-- =============================================================
-- 5. funnel_config
-- =============================================================
CREATE TABLE funnel_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
  working_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  timezone TEXT DEFAULT 'America/Mexico_City',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 6. funnel_stages
-- =============================================================
CREATE TABLE funnel_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  scorecard_id UUID REFERENCES scorecards(id),
  name TEXT NOT NULL,
  stage_type TEXT NOT NULL
    CHECK (stage_type IN ('llamada', 'visita', 'cierre')),
  order_index INTEGER NOT NULL,
  min_score_to_advance INTEGER,
  avg_cycle_days INTEGER,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_funnel_stages_org ON funnel_stages (organization_id, order_index);

-- =============================================================
-- 7. lead_sources
-- =============================================================
CREATE TABLE lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  cost_per_lead DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_sources_org ON lead_sources (organization_id, active);

-- =============================================================
-- 8. analyses
-- =============================================================
CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  scorecard_id UUID NOT NULL REFERENCES scorecards(id),
  funnel_stage_id UUID REFERENCES funnel_stages(id),
  fuente_lead_id UUID REFERENCES lead_sources(id),
  prospect_identifier TEXT,
  score_general INTEGER,
  clasificacion TEXT
    CHECK (clasificacion IN ('excelente', 'buena', 'regular', 'deficiente')),
  momento_critico TEXT,
  patron_error TEXT,
  objecion_principal TEXT,
  siguiente_accion TEXT,
  manager_note TEXT,
  categoria_descalificacion JSONB,
  avanzo_a_siguiente_etapa TEXT DEFAULT 'pending'
    CHECK (avanzo_a_siguiente_etapa IN ('converted', 'lost_captadora', 'lost_external', 'pending')),
  conversion_discrepancy BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'procesando', 'completado', 'error')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analyses_user ON analyses (organization_id, user_id, created_at DESC);
CREATE INDEX idx_analyses_conversion ON analyses (organization_id, avanzo_a_siguiente_etapa);
CREATE INDEX idx_analyses_prospect ON analyses (organization_id, prospect_identifier) WHERE prospect_identifier IS NOT NULL;
CREATE INDEX idx_primary_category ON analyses ((categoria_descalificacion->>0))
  WHERE categoria_descalificacion IS NOT NULL
    AND jsonb_typeof(categoria_descalificacion) = 'array'
    AND jsonb_array_length(categoria_descalificacion) > 0;

-- =============================================================
-- 9. analysis_jobs
-- =============================================================
CREATE TABLE analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES analyses(id) UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'procesando', 'completado', 'error')),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  transcription_text TEXT,
  has_audio BOOLEAN DEFAULT false,
  audio_url TEXT,
  audio_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_status ON analysis_jobs (organization_id, status);
CREATE INDEX idx_jobs_user ON analysis_jobs (user_id, created_at DESC);

-- =============================================================
-- 10. analysis_phases
-- =============================================================
CREATE TABLE analysis_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES analyses(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  phase_id TEXT NOT NULL,
  phase_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  score_max INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_phases_analysis ON analysis_phases (analysis_id);
CREATE INDEX idx_phases_org_phase ON analysis_phases (organization_id, phase_id);
CREATE INDEX idx_phases_user_phase ON analysis_phases (organization_id, user_id, phase_id, created_at DESC);

-- =============================================================
-- 11. descalification_categories
-- =============================================================
CREATE TABLE descalification_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

CREATE INDEX idx_descalification_org ON descalification_categories (organization_id, active);

-- =============================================================
-- 12. speech_versions
-- =============================================================
CREATE TABLE speech_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  scorecard_id UUID REFERENCES scorecards(id),
  version_number INTEGER NOT NULL,
  content JSONB NOT NULL,
  published BOOLEAN DEFAULT false,
  published_by UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_speech_published ON speech_versions (organization_id, scorecard_id) WHERE published = true;

-- =============================================================
-- 13. reports
-- =============================================================
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  generated_by UUID REFERENCES users(id),
  tipo TEXT NOT NULL
    CHECK (tipo IN ('semanal', 'mensual')),
  destinatario_tipo TEXT NOT NULL
    CHECK (destinatario_tipo IN ('equipo', 'agencia', 'direccion', 'todos')),
  content JSONB,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_org_tipo ON reports (organization_id, destinatario_tipo, created_at DESC);

-- =============================================================
-- 14. alerts
-- =============================================================
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL
    CHECK (type IN ('lead_quality_drop', 'conversion_rate_drop', 'fuente_performance', 'volume_anomaly')),
  fuente_lead_id UUID REFERENCES lead_sources(id),
  threshold_value DECIMAL,
  current_value DECIMAL,
  status TEXT DEFAULT 'activa'
    CHECK (status IN ('activa', 'atendida')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_alerts_org_status ON alerts (organization_id, status);

-- =============================================================
-- 15. xp_events
-- =============================================================
CREATE TABLE xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  organization_id UUID NOT NULL,
  event_type TEXT,
  xp_earned INTEGER,
  analysis_id UUID REFERENCES analyses(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 16. badges
-- =============================================================
CREATE TABLE badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  name TEXT,
  description TEXT,
  icon_code TEXT,
  condition_type TEXT,
  condition_value DECIMAL,
  active BOOLEAN DEFAULT true
);

-- =============================================================
-- 17. user_badges
-- =============================================================
CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  badge_id UUID REFERENCES badges(id),
  earned_at TIMESTAMPTZ,
  notified BOOLEAN DEFAULT false
);

-- =============================================================
-- 18. objectives
-- =============================================================
CREATE TABLE objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  created_by UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id),
  type TEXT
    CHECK (type IN ('volume', 'score', 'phase_score', 'consistency')),
  target_phase_id TEXT,
  target_value DECIMAL NOT NULL,
  period_type TEXT
    CHECK (period_type IN ('weekly', 'monthly', 'custom')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_objectives_org ON objectives (organization_id, is_active);
CREATE INDEX idx_objectives_user ON objectives (target_user_id, is_active);

-- =============================================================
-- 19. objective_progress
-- =============================================================
CREATE TABLE objective_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id UUID REFERENCES objectives(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  snapshot_date DATE NOT NULL,
  current_value DECIMAL,
  completion_pct DECIMAL,
  on_track BOOLEAN,
  projected_final DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_progress_date ON objective_progress (objective_id, snapshot_date DESC);
CREATE INDEX idx_progress_org ON objective_progress (organization_id, snapshot_date DESC);

-- =============================================================
-- RPC: check_and_increment_analysis_count
-- Correccion de Gaps: IF tier_limit IS NULL como primera instruccion
-- =============================================================
CREATE OR REPLACE FUNCTION check_and_increment_analysis_count(org_id UUID, tier_limit INTEGER)
RETURNS BOOLEAN AS $$
DECLARE current_count INTEGER;
BEGIN
  IF tier_limit IS NULL THEN RETURN TRUE; END IF;
  SELECT analyses_count INTO current_count FROM organizations WHERE id = org_id FOR UPDATE;
  IF current_count >= tier_limit THEN RETURN FALSE; END IF;
  UPDATE organizations SET analyses_count = analyses_count + 1 WHERE id = org_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- RLS: Habilitar en todas las tablas
-- =============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE descalification_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE speech_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE objective_progress ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- RLS Policies
-- Patron base: aislamiento por organization_id via users table
-- =============================================================

-- Helper: obtener organization_id del usuario autenticado
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID AS $$
  SELECT organization_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: obtener role del usuario autenticado
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- organizations: usuario solo ve su propia org
CREATE POLICY "users_view_own_org" ON organizations
  FOR SELECT USING (
    id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- users: captadoras ven solo su registro, gerente/direccion ven su org
CREATE POLICY "users_select" ON users
  FOR SELECT USING (
    CASE get_user_role()
      WHEN 'super_admin' THEN true
      WHEN 'captadora' THEN id = auth.uid()
      ELSE organization_id = get_user_org_id()
    END
  );

-- scorecards: visibles para la org + globales (organization_id IS NULL)
CREATE POLICY "scorecards_select" ON scorecards
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- scorecards: solo super_admin puede modificar globales
CREATE POLICY "scorecards_modify_global" ON scorecards
  FOR ALL USING (
    CASE
      WHEN organization_id IS NULL THEN get_user_role() = 'super_admin'
      ELSE organization_id = get_user_org_id()
    END
  );

-- invitations: solo gerente+ de la org
CREATE POLICY "invitations_org" ON invitations
  FOR ALL USING (
    organization_id = get_user_org_id()
    AND get_user_role() IN ('gerente', 'direccion', 'super_admin')
  );

-- funnel_config: org isolation
CREATE POLICY "funnel_config_org" ON funnel_config
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- funnel_stages: org isolation
CREATE POLICY "funnel_stages_org" ON funnel_stages
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- lead_sources: org isolation
CREATE POLICY "lead_sources_org" ON lead_sources
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- analyses: org isolation (agencia acceso restringido se maneja en vistas)
CREATE POLICY "analyses_org" ON analyses
  FOR SELECT USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

CREATE POLICY "analyses_insert" ON analyses
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id()
  );

CREATE POLICY "analyses_update" ON analyses
  FOR UPDATE USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- analysis_jobs: org isolation
CREATE POLICY "analysis_jobs_org" ON analysis_jobs
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- analysis_phases: org isolation
CREATE POLICY "analysis_phases_org" ON analysis_phases
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- descalification_categories: org isolation
CREATE POLICY "descalification_categories_org" ON descalification_categories
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- speech_versions: org isolation
CREATE POLICY "speech_versions_org" ON speech_versions
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- reports: org isolation + filtro por destinatario_tipo segun rol
CREATE POLICY "reports_org" ON reports
  FOR SELECT USING (
    (organization_id = get_user_org_id() OR get_user_role() = 'super_admin')
    AND (
      destinatario_tipo = 'todos'
      OR (get_user_role() = 'agencia' AND destinatario_tipo = 'agencia')
      OR (get_user_role() = 'direccion' AND destinatario_tipo IN ('direccion', 'equipo'))
      OR (get_user_role() = 'gerente' AND destinatario_tipo = 'equipo')
      OR get_user_role() = 'super_admin'
    )
  );

-- alerts: org isolation
CREATE POLICY "alerts_org" ON alerts
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- xp_events: org isolation
CREATE POLICY "xp_events_org" ON xp_events
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- badges: globales + org
CREATE POLICY "badges_select" ON badges
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- user_badges: usuario ve los suyos, gerente+ ve los de su org
CREATE POLICY "user_badges_select" ON user_badges
  FOR SELECT USING (
    user_id = auth.uid()
    OR get_user_role() IN ('gerente', 'direccion', 'super_admin')
  );

-- objectives: captadoras ven sus objetivos + globales de equipo
CREATE POLICY "objectives_select" ON objectives
  FOR SELECT USING (
    CASE get_user_role()
      WHEN 'super_admin' THEN true
      WHEN 'captadora' THEN
        organization_id = get_user_org_id()
        AND (target_user_id = auth.uid() OR target_user_id IS NULL)
      ELSE organization_id = get_user_org_id()
    END
  );

CREATE POLICY "objectives_manage" ON objectives
  FOR ALL USING (
    get_user_role() IN ('gerente', 'direccion', 'super_admin')
    AND (organization_id = get_user_org_id() OR get_user_role() = 'super_admin')
  );

-- objective_progress: org isolation
CREATE POLICY "objective_progress_org" ON objective_progress
  FOR ALL USING (
    organization_id = get_user_org_id()
    OR get_user_role() = 'super_admin'
  );

-- =============================================================
-- SEED DATA
-- =============================================================

-- Organizaciones founders
INSERT INTO organizations (id, name, slug, plan, founder_account, timezone, access_status)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Immobili Internacional', 'immobili', 'founder', true, 'America/Mexico_City', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'EnPagos', 'enpagos', 'founder', true, 'America/Mexico_City', 'active');

-- Scorecards globales (organization_id = NULL)
INSERT INTO scorecards (id, organization_id, name, version, vertical, phases, prompt_template, active)
VALUES
  ('b0000000-0000-0000-0000-000000000001', NULL, 'Llamada Captacion Inmobiliaria/Infonavit', 'V5A', 'inmobiliario',
   '[]'::jsonb, 'PENDIENTE: importar desde canvas SCORECARDS F0AK5T984FM', true),
  ('b0000000-0000-0000-0000-000000000002', NULL, 'Visita Presencial Inmobiliaria', 'V5B', 'inmobiliario',
   '[]'::jsonb, 'PENDIENTE: importar desde canvas SCORECARDS F0AK5T984FM', true),
  ('b0000000-0000-0000-0000-000000000003', NULL, 'Financiero/Credito', 'v1', 'financiero',
   '[]'::jsonb, 'PENDIENTE: importar desde canvas SCORECARDS F0AK5T984FM', true);

-- Funnel config para ambas orgs
INSERT INTO funnel_config (organization_id, working_days, timezone)
VALUES
  ('a0000000-0000-0000-0000-000000000001', ARRAY[1,2,3,4,5], 'America/Mexico_City'),
  ('a0000000-0000-0000-0000-000000000002', ARRAY[1,2,3,4,5], 'America/Mexico_City');

-- Funnel stages para Immobili (4 etapas)
INSERT INTO funnel_stages (organization_id, scorecard_id, name, stage_type, order_index)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Llamada 1 de Captacion', 'llamada', 1),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Visita Presencial', 'visita', 2),
  ('a0000000-0000-0000-0000-000000000001', NULL, 'Seguimiento', 'llamada', 3),
  ('a0000000-0000-0000-0000-000000000001', NULL, 'Cierre', 'cierre', 4);

-- Lead sources para Immobili
INSERT INTO lead_sources (organization_id, name)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Facebook/Instagram Ads'),
  ('a0000000-0000-0000-0000-000000000001', 'Portales (Lamudi, Inmuebles24)'),
  ('a0000000-0000-0000-0000-000000000001', 'Referidos'),
  ('a0000000-0000-0000-0000-000000000001', 'Llamadas en frio');

-- Categorias de descalificacion para Immobili (6 categorias)
INSERT INTO descalification_categories (organization_id, code, label)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'sin_credito_vigente', 'Sin credito vigente'),
  ('a0000000-0000-0000-0000-000000000001', 'fuera_de_zona', 'Fuera de zona'),
  ('a0000000-0000-0000-0000-000000000001', 'precio_fuera_de_rango', 'Precio fuera de rango'),
  ('a0000000-0000-0000-0000-000000000001', 'no_contesta', 'No contesta'),
  ('a0000000-0000-0000-0000-000000000001', 'sin_documentos', 'Sin documentos'),
  ('a0000000-0000-0000-0000-000000000001', 'no_tiene_negocio_establecido', 'No tiene negocio establecido');
