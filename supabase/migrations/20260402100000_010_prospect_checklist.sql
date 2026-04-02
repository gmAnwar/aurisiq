-- Migration: Add prospect info + checklist results to analyses
-- C3 redesign: show prospect card, checklist visual, coaching by phase

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS prospect_name TEXT,
  ADD COLUMN IF NOT EXISTS prospect_zone TEXT,
  ADD COLUMN IF NOT EXISTS property_type TEXT,
  ADD COLUMN IF NOT EXISTS sale_reason TEXT,
  ADD COLUMN IF NOT EXISTS checklist_results JSONB;
