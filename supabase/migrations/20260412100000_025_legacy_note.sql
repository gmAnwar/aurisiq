-- Migration 025: legacy_note column + mark EnPagos bug analyses
-- 5 analyses of EnPagos were processed with inmobiliario checklist
-- due to missing per-org scorecard before migration 023 (11 abr 2026).

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS legacy_note TEXT;

-- Mark affected analyses: EnPagos org with 26-field inmobiliario checklist
UPDATE analyses
SET legacy_note = 'checklist_inmobiliario_en_enpagos_bug_pre_2026_04_12'
WHERE organization_id = 'a0000000-0000-0000-0000-000000000002'
  AND checklist_results IS NOT NULL
  AND jsonb_array_length(checklist_results) = 26;
