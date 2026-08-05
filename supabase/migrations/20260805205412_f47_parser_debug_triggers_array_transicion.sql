-- F47 Migración 1/2 — transición tolerante del modelo trigger→triggers[].
-- Aplicada vía MCP el 2026-08-05 (versión registrada 20260805205412); este
-- archivo reconcilia el repo con esa versión. Orden duro de release:
-- esta migración ANTES del deploy del Edge F47 (74e4cf6/8ac59e5) — el código
-- nuevo escribe SOLO triggers y sin la columna el insert falla dentro del
-- try/catch, perdiendo el diagnóstico.
-- Ventanas cubiertas: v50 viejo sigue escribiendo trigger (columna intacta,
-- CHECK viejo intacto) y deja triggers NULL (CHECK nuevo lo tolera); el Edge
-- F47 escribe triggers y deja trigger NULL (ya no es NOT NULL). Rollback a
-- v50 posible hasta la Migración 2/2 (endurecer + DROP de la columna vieja).

ALTER TABLE public.analysis_parser_debug ADD COLUMN triggers text[];
ALTER TABLE public.analysis_parser_debug ALTER COLUMN trigger DROP NOT NULL;

-- Backfill por predicado, sin IDs hardcodeados (las filas pueden crecer entre
-- la escritura y el apply).
UPDATE public.analysis_parser_debug
SET triggers = CASE trigger WHEN 'both' THEN ARRAY['missing_lead','phases_mismatch']
                            ELSE ARRAY[trigger] END
WHERE triggers IS NULL AND trigger IS NOT NULL;

ALTER TABLE public.analysis_parser_debug ADD CONSTRAINT analysis_parser_debug_triggers_check
CHECK (
  triggers IS NULL OR (
    triggers <@ ARRAY['missing_lead','phases_mismatch','missing_prospect_extraction','descal_parse_failed']::text[]
    AND array_length(triggers, 1) >= 1
  )
);
