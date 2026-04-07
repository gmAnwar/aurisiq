-- Migration 014 — role_label_vendedor per organization
-- Add the UI label for the 'captadora' role that varies by niche.
-- The technical role in users.role remains 'captadora'. This is only the
-- string shown in the UI: "Captadora" for Inmobili, "Ejecutivo" for EnPagos.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS role_label_vendedor TEXT DEFAULT 'Captadora';

-- Seed labels for existing organizations
UPDATE organizations SET role_label_vendedor = 'Captadora' WHERE slug = 'immobili';
UPDATE organizations SET role_label_vendedor = 'Ejecutivo' WHERE slug = 'enpagos';
