-- Migration: Link analyses from the same prospect
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS related_analysis_id UUID REFERENCES analyses(id);
