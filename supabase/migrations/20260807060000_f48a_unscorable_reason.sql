-- F48a: marca de no-medibilidad en analyses.
--
-- RECONCILIACIÓN: esta migración YA FUE APLICADA en prod vía MCP por el chat
-- (7-ago-2026, version 20260807060000 registrada como f48a_unscorable_reason)
-- ANTES del push del código — el orden fue deliberado: Vercel auto-deploya en
-- push a main y un SELECT de columna inexistente devuelve 400 de PostgREST.
-- Este archivo solo reconcilia el repo con la DB viva. NO re-aplicar.
-- DDL copiado verbatim de la DB viva (information_schema.columns +
-- pg_get_constraintdef + col_description).

ALTER TABLE analyses ADD COLUMN unscorable_reason text;

ALTER TABLE analyses ADD CONSTRAINT analyses_unscorable_reason_check
  CHECK (((unscorable_reason IS NULL) OR (unscorable_reason = ANY (ARRAY['fragmento'::text]))));

COMMENT ON COLUMN analyses.unscorable_reason IS 'F48a. NULL = analisis medible (score_general y clasificacion validos). ''fragmento'' = transcript por debajo de FRAGMENT_MIN_CHARS (1500): score_general y clasificacion son NULL POR DISENO, no por fallo — el desempeno no se pudo medir. Los datos del prospecto (lead_quality, categoria_descalificacion, prospect_*) SI son validos y se conservan. Precedencia: status=rechazado gana sobre fragmento. Extensible a futuras razones de no-medibilidad; ampliar el CHECK al agregar una.';
