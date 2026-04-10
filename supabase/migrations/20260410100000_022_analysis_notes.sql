-- Migration 022: notes column for free-text call notes
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS notes TEXT;
