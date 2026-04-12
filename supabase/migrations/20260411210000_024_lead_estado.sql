-- Migration 024: lead_estado generated column
-- Derives lead status from categoria_descalificacion automatically.
-- descartado = has at least 1 descalification category
-- calificado = empty array

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS lead_estado TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN jsonb_array_length(COALESCE(categoria_descalificacion, '[]'::jsonb)) > 0
      THEN 'descartado'
      ELSE 'calificado'
    END
  ) STORED;
