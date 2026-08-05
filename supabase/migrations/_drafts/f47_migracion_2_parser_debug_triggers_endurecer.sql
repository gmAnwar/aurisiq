-- F47 Migración 2/2 — endurecer el modelo triggers[] y retirar la columna
-- legacy. BORRADOR: NO aplicada. La aplica Anwar vía MCP SOLO después de que
-- el Edge F47 esté ACTIVE y verificado (el código nuevo ya no menciona
-- trigger, así que el DROP no puede romper ningún insert). Al aplicarla,
-- mover este archivo a supabase/migrations/ con el timestamp registrado.

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
