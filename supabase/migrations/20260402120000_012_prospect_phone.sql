-- Migration: Add prospect phone extracted from transcription
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS prospect_phone TEXT;
