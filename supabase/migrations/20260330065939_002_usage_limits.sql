-- =============================================================
-- Session 1.5a — Limites de uso y piloto gratuito
-- RPCs para reset mensual, expiracion starter, grace period
-- =============================================================

-- RPC: Reset mensual de analyses_count (llamada por cron dia 1)
CREATE OR REPLACE FUNCTION reset_monthly_analysis_counts()
RETURNS INTEGER AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE organizations
  SET analyses_count = 0, updated_at = NOW()
  WHERE analyses_count > 0;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Expirar orgs Starter despues de 60 dias
CREATE OR REPLACE FUNCTION expire_starter_orgs()
RETURNS INTEGER AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE organizations
  SET access_status = 'read_only', updated_at = NOW()
  WHERE plan = 'starter'
    AND access_status = 'active'
    AND created_at < NOW() - INTERVAL '60 days';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Iniciar grace period (llamada por Stripe webhook invoice.payment_failed)
-- Solo escribe stripe_grace_started_at si aun es null (idempotente)
CREATE OR REPLACE FUNCTION start_grace_period(p_stripe_customer_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE organizations
  SET
    access_status = 'grace',
    stripe_grace_started_at = COALESCE(stripe_grace_started_at, NOW()),
    updated_at = NOW()
  WHERE stripe_customer_id = p_stripe_customer_id
    AND access_status = 'active';
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Expirar grace period (7 dias → read_only)
CREATE OR REPLACE FUNCTION expire_grace_periods()
RETURNS INTEGER AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE organizations
  SET access_status = 'read_only', updated_at = NOW()
  WHERE access_status = 'grace'
    AND stripe_grace_started_at IS NOT NULL
    AND stripe_grace_started_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Resolver grace period (pago exitoso → volver a active)
CREATE OR REPLACE FUNCTION resolve_grace_period(p_stripe_customer_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE organizations
  SET
    access_status = 'active',
    stripe_grace_started_at = NULL,
    updated_at = NOW()
  WHERE stripe_customer_id = p_stripe_customer_id
    AND access_status IN ('grace', 'read_only');
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Obtener info de quota para el frontend
CREATE OR REPLACE FUNCTION get_org_quota(p_org_id UUID)
RETURNS JSON AS $$
DECLARE
  org_row organizations%ROWTYPE;
  tier_limit INTEGER;
  days_remaining INTEGER;
BEGIN
  SELECT * INTO org_row FROM organizations WHERE id = p_org_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Determine tier limit
  tier_limit := CASE org_row.plan
    WHEN 'starter' THEN 50
    WHEN 'growth' THEN 200
    WHEN 'pro' THEN 500
    WHEN 'scale' THEN 1500
    WHEN 'enterprise' THEN NULL
    WHEN 'founder' THEN 50
    ELSE 0
  END;

  -- Days remaining for starter pilot
  IF org_row.plan = 'starter' AND org_row.access_status = 'active' THEN
    days_remaining := GREATEST(0, 60 - EXTRACT(DAY FROM NOW() - org_row.created_at)::INTEGER);
  ELSE
    days_remaining := NULL;
  END IF;

  RETURN json_build_object(
    'plan', org_row.plan,
    'access_status', org_row.access_status,
    'analyses_used', org_row.analyses_count,
    'analyses_limit', tier_limit,
    'analyses_remaining', CASE WHEN tier_limit IS NULL THEN NULL ELSE GREATEST(0, tier_limit - org_row.analyses_count) END,
    'is_unlimited', tier_limit IS NULL,
    'pilot_days_remaining', days_remaining,
    'grace_started_at', org_row.stripe_grace_started_at,
    'founder_account', org_row.founder_account
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
