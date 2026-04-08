-- =============================================================
-- Migration 018: equipment_type for financiero vertical
-- Stores the equipment the prospect wants to finance
-- (horno, vitrina, refrigerador, máquina tortilladora, etc.)
-- =============================================================

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS equipment_type TEXT;

-- Append extraction instructions to the active v1 financiero scorecard
-- prompt so Claude returns TIPO_NEGOCIO and TIPO_EQUIPO. Safe to re-run.
UPDATE scorecards
SET prompt_template = prompt_template || E'\n\n---\nEXTRACCIÓN DE CAMPOS (financiero):\nAl final de tu respuesta incluye, en líneas separadas y en este formato exacto:\nTIPO_NEGOCIO: [tortillería, tienda de abarrotes, taller, ambulante, etc. o "No mencionado"]\nTIPO_EQUIPO: [horno, vitrina, refrigerador, máquina tortilladora, etc. o "No mencionado"]\n'
WHERE vertical = 'financiero'
  AND version = 'v1'
  AND prompt_template NOT LIKE '%TIPO_EQUIPO%';
