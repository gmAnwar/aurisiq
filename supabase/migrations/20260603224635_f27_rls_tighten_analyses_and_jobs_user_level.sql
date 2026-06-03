-- F27 — tighten RLS de public.analyses + public.analysis_jobs a user-level.
-- Antes: SELECT/UPDATE en analyses y SELECT en analysis_jobs eran org-level,
-- por lo que cualquier captadora de una org podía leer análisis y transcripciones
-- (con PII completa) de sus compañeras. Validado empíricamente (Fernanda → Miguel).
--
-- Después: captadora solo lee/edita sus propios rows. Gerente, direccion, agencia
-- y super_admin conservan acceso org-level (consistente con analysis_jobs_update y
-- con /agencia/page.tsx).
--
-- Out of scope (tracked para Audit 05): analysis_phases_org y xp_events_org siguen
-- siendo FOR ALL org-level. Sin PII directa, P3.

-- ─── public.analyses ───────────────────────────────────────────────
DROP POLICY IF EXISTS analyses_org    ON public.analyses;
DROP POLICY IF EXISTS analyses_update ON public.analyses;

CREATE POLICY analyses_select
  ON public.analyses
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      organization_id = get_user_org_id()
      AND get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
    )
  );

CREATE POLICY analyses_update
  ON public.analyses
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (
      organization_id = get_user_org_id()
      AND get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      organization_id = get_user_org_id()
      AND get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
    )
  );

-- ─── public.analysis_jobs ──────────────────────────────────────────
DROP POLICY IF EXISTS analysis_jobs_select ON public.analysis_jobs;

CREATE POLICY analysis_jobs_select
  ON public.analysis_jobs
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      organization_id = get_user_org_id()
      AND get_user_roles() && ARRAY['gerente','direccion','agencia','super_admin']
    )
  );
