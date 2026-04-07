-- Migration 016 — users.city
-- Captured during the /join/[token] onboarding flow.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS city TEXT;
