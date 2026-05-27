-- F21: cross-runtime dedupe de alertas Anthropic/AssemblyAI.
-- Compartido entre Worker (worker/src/index.js) y Edge Function
-- (supabase/functions/_shared/alert.ts) via RPC try_alert.

CREATE TABLE public.error_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_type text NOT NULL,
  runtime text NOT NULL,
  -- Convención: siempre UTC. timestamp sin tz para permitir GENERATED
  -- column IMMUTABLE (requisito para unique index downstream).
  sent_at_utc timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  -- Bucket de 5min calculado en UTC. date_bin(interval, timestamp, timestamp)
  -- es IMMUTABLE; requiere pg14+ (Supabase corre pg15+).
  bucket_5min timestamp GENERATED ALWAYS AS (
    date_bin('5 minutes', sent_at_utc, '2000-01-01 00:00:00'::timestamp)
  ) STORED
);

CREATE UNIQUE INDEX error_alerts_dedupe_idx
  ON public.error_alerts (error_type, runtime, bucket_5min);

CREATE INDEX error_alerts_sent_at_idx
  ON public.error_alerts (sent_at_utc DESC);

ALTER TABLE public.error_alerts ENABLE ROW LEVEL SECURITY;
-- Sin policies — acceso solo via RPC SECURITY DEFINER.

-- RPC: dedupe atómico + slug lookup en un único round-trip.
-- Returns (should_alert boolean, organization_slug text).
--   should_alert=true  → no había alerta en bucket actual → caller postea Slack
--   should_alert=false → ya alertamos en bucket → caller skip Slack
--   organization_slug → populado si _organization_id pasa válido, NULL si no
CREATE OR REPLACE FUNCTION public.try_alert(
  _error_type text,
  _runtime text,
  _organization_id uuid DEFAULT NULL
) RETURNS TABLE(should_alert boolean, organization_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inserted_id uuid;
  _slug text;
BEGIN
  -- Intento atómico de insert; ON CONFLICT contra unique index sobre bucket.
  -- Target explícito (no DO NOTHING bare) para evitar surprises si nuevos
  -- constraints se agregan después.
  INSERT INTO public.error_alerts (error_type, runtime)
  VALUES (_error_type, _runtime)
  ON CONFLICT (error_type, runtime, bucket_5min) DO NOTHING
  RETURNING id INTO _inserted_id;

  -- Slug lookup: siempre que org_id pase, incluso si deduped (overhead ~5ms,
  -- predictable contract para caller).
  IF _organization_id IS NOT NULL THEN
    SELECT slug INTO _slug FROM public.organizations WHERE id = _organization_id;
  END IF;

  -- _inserted_id es NULL si ON CONFLICT DO NOTHING no produjo INSERT.
  RETURN QUERY SELECT (_inserted_id IS NOT NULL), _slug;
END;
$$;

-- Acceso restringido: solo service_role llama esta RPC (Worker + Edge Function
-- usan SERVICE_ROLE_KEY). Sin acceso anon/authenticated/PUBLIC.
REVOKE ALL ON FUNCTION public.try_alert(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_alert(text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.try_alert(text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.try_alert(text, text, uuid) TO service_role;
