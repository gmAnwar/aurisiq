-- Migration 042: llm_lead_status + lead_estado ternario
-- Adds llm_lead_status (persisted from Claude output) and rebuilds
-- lead_estado generated column with 3-source cascade:
--   1. categoria_descalificacion non-empty → 'descartado'
--   2. llm_lead_status in (lost_captadora, lost_external) → 'descartado'
--   3. llm_lead_status = 'converted' → 'calificado'
--   4. else → 'pendiente'

-- 1. Add llm_lead_status column
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS llm_lead_status TEXT
  CHECK (llm_lead_status IN ('converted', 'lost_captadora', 'lost_external', 'pending'));

-- 2. Drop old binary generated column and recreate with ternary logic
ALTER TABLE analyses DROP COLUMN IF EXISTS lead_estado;
ALTER TABLE analyses ADD COLUMN lead_estado TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN jsonb_array_length(COALESCE(categoria_descalificacion, '[]'::jsonb)) > 0
        THEN 'descartado'
      WHEN llm_lead_status IN ('lost_captadora', 'lost_external')
        THEN 'descartado'
      WHEN llm_lead_status = 'converted'
        THEN 'calificado'
      ELSE 'pendiente'
    END
  ) STORED;
