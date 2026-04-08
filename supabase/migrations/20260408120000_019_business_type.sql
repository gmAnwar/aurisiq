-- =============================================================
-- Migration 019: business_type for financiero vertical (EnPagos)
-- Separate column from property_type so each vertical owns its own
-- extraction field instead of reusing inmobiliario's column.
-- =============================================================

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS business_type TEXT;

-- equipment_type already added in migration 018; re-assert for safety.
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS equipment_type TEXT;

-- Update the active v1 financiero scorecard prompt so Claude returns
-- TIPO_NEGOCIO and TIPO_EQUIPO as separate fields. Migration 018 used
-- TIPO_NEGOCIO to overwrite property_type; we now want it stored in
-- business_type, so we rewrite the appended block.
UPDATE scorecards
SET prompt_template = regexp_replace(
  prompt_template,
  E'\n\n---\nEXTRACCIÓN DE CAMPOS \\(financiero\\):[\\s\\S]*$',
  ''
) || E'\n\n---\nEXTRACCIÓN DE CAMPOS (financiero):\nAl final de tu respuesta incluye, en líneas separadas y en este formato exacto:\nTIPO_NEGOCIO: [tortillería, tienda de abarrotes, taller, ambulante, etc. o "No mencionado"]\nTIPO_EQUIPO: [horno, vitrina, refrigerador, máquina tortilladora, etc. o "No mencionado"]\n'
WHERE vertical = 'financiero'
  AND version = 'v1';
