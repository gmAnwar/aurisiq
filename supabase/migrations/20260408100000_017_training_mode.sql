-- =============================================================
-- Migration 017: training_mode
-- Allows a user to switch role views in the app (no DB role change).
-- =============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS training_mode BOOLEAN DEFAULT false;
