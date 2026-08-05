-- F47 Migración 2/2 — endurecer el modelo triggers[] y retirar la columna
-- legacy. Aplicada por Anwar vía MCP el 2026-08-05 (versión registrada
-- 20260805210338) con el Edge F47 v51 ACTIVE verificado — el código nuevo ya
-- no menciona la columna, así que el DROP no pudo romper ningún insert.
-- Este archivo reconcilia el repo con esa versión.

-- Filas que v50 haya escrito en la ventana M1→deploy (trigger poblado,
-- triggers NULL) — sin esto el SET NOT NULL fallaría sobre ellas.
UPDATE public.analysis_parser_debug
SET triggers = CASE trigger WHEN 'both' THEN ARRAY['missing_lead','phases_mismatch']
                            ELSE ARRAY[trigger] END
WHERE triggers IS NULL AND trigger IS NOT NULL;

ALTER TABLE public.analysis_parser_debug ALTER COLUMN triggers SET NOT NULL;
ALTER TABLE public.analysis_parser_debug DROP CONSTRAINT analysis_parser_debug_triggers_check;
ALTER TABLE public.analysis_parser_debug ADD CONSTRAINT analysis_parser_debug_triggers_check
CHECK (
  triggers <@ ARRAY['missing_lead','phases_mismatch','missing_prospect_extraction','descal_parse_failed']::text[]
  AND array_length(triggers, 1) >= 1
);
ALTER TABLE public.analysis_parser_debug DROP COLUMN trigger;  -- su CHECK viejo muere con ella
