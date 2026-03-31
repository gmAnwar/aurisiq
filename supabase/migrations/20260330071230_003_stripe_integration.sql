-- =============================================================
-- Session 1.5b — Stripe integration RPCs
-- =============================================================

-- RPC: Upgrade org plan after successful checkout
CREATE OR REPLACE FUNCTION upgrade_org_plan(
  p_stripe_customer_id TEXT,
  p_plan TEXT,
  p_org_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_org_id IS NOT NULL THEN
    UPDATE organizations
    SET plan = p_plan,
        stripe_customer_id = p_stripe_customer_id,
        access_status = 'active',
        stripe_grace_started_at = NULL,
        updated_at = NOW()
    WHERE id = p_org_id;
  ELSE
    UPDATE organizations
    SET plan = p_plan,
        access_status = 'active',
        stripe_grace_started_at = NULL,
        updated_at = NOW()
    WHERE stripe_customer_id = p_stripe_customer_id;
  END IF;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Table: stripe_events (idempotency log)
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
