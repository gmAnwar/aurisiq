-- Migration: Add missing columns detected by code-qa
-- speech_versions.funnel_stage_id for multi-stage speech
-- objectives.name and current_value for D1 and G7

-- 1. speech_versions: funnel_stage_id for per-stage speech
ALTER TABLE speech_versions
  ADD COLUMN IF NOT EXISTS funnel_stage_id UUID REFERENCES funnel_stages(id);

-- Update unique index to include funnel_stage_id (allows one published per org+scorecard+stage)
DROP INDEX IF EXISTS idx_speech_published;
CREATE UNIQUE INDEX idx_speech_published
  ON speech_versions (organization_id, scorecard_id, COALESCE(funnel_stage_id, '00000000-0000-0000-0000-000000000000'))
  WHERE published = true;

-- 2. objectives: name and current_value for D1 dashboard and G7 config
ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS current_value DECIMAL DEFAULT 0;
