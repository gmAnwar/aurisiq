-- F46: tabla separada para diagnóstico de partial_extraction (NO columna en
-- analyses — una columna filtraría PII vía PostgREST + RLS org-level a cualquier
-- usuario autenticado de la org). Append-only: un redrive que vuelve a fallar
-- genera una segunda fila (historial, no overwrite). Se puebla SOLO cuando el
-- detector F42 dispara — cero escrituras en el camino feliz.
CREATE TABLE public.analysis_parser_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('missing_lead','phases_mismatch','both')),
  missing_fields jsonb,
  phases_expected int,
  phases_found int,
  phases_found_ids jsonb,
  raw_estado text,
  estado_header_missing boolean NOT NULL DEFAULT false,
  raw_output_capture text,
  raw_output_truncated boolean NOT NULL DEFAULT false,
  edge_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analysis_parser_debug_analysis_id_idx
  ON public.analysis_parser_debug (analysis_id);

-- Seguridad: deny-all. RLS habilitado SIN policies → anon/authenticated bloqueados.
-- service_role bypasea RLS. REVOKE explícito (regla S47: el proyecto no tiene
-- default-deny) — defensa en profundidad sobre el RLS.
ALTER TABLE public.analysis_parser_debug ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.analysis_parser_debug FROM PUBLIC;
REVOKE ALL ON public.analysis_parser_debug FROM anon;
REVOKE ALL ON public.analysis_parser_debug FROM authenticated;
GRANT ALL ON public.analysis_parser_debug TO service_role;

COMMENT ON TABLE public.analysis_parser_debug IS 'F46: diagnóstico de partial_extraction. Contiene output crudo del LLM con PII de prospectos. Solo service_role. NUNCA exponer al cliente ni crear policies de lectura.';
