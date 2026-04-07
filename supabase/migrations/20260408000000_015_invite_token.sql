-- Migration 015 — TeamLink invite_token
-- Each organization gets a unique invite token used in /join/[token].
-- New users land on that link, complete 3 onboarding questions, and
-- get assigned to that organization.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS invite_token UUID DEFAULT gen_random_uuid() UNIQUE;

UPDATE organizations
  SET invite_token = gen_random_uuid()
  WHERE invite_token IS NULL;
