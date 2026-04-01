-- Migration: Add audio transcription audit fields to analysis_jobs
-- Etapa 3: Audio recording + AssemblyAI transcription + edit audit

ALTER TABLE analysis_jobs
  ADD COLUMN IF NOT EXISTS transcription_original TEXT,
  ADD COLUMN IF NOT EXISTS transcription_edited TEXT,
  ADD COLUMN IF NOT EXISTS edit_percentage SMALLINT DEFAULT 0;

-- Extend alerts table for edit pattern detection
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check
  CHECK (type IN ('lead_quality_drop', 'conversion_rate_drop', 'fuente_performance', 'volume_anomaly', 'high_edit_pattern'));
