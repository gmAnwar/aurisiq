


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."atribuye_billing_status" AS ENUM (
    'trial',
    'active',
    'past_due',
    'cancelled'
);


ALTER TYPE "public"."atribuye_billing_status" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_conversion_source" AS ENUM (
    'csv',
    'sheet_manual',
    'crm_webhook',
    'crm_sync'
);


ALTER TYPE "public"."atribuye_conversion_source" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_crm_status" AS ENUM (
    'active',
    'paused',
    'error'
);


ALTER TYPE "public"."atribuye_crm_status" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_crm_type" AS ENUM (
    'vambe',
    'kommo',
    'clientify',
    'whaticket',
    'trengo'
);


ALTER TYPE "public"."atribuye_crm_type" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_csv_status" AS ENUM (
    'uploading',
    'parsing',
    'validating',
    'sending',
    'completed',
    'failed'
);


ALTER TYPE "public"."atribuye_csv_status" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_event_status" AS ENUM (
    'pending',
    'sent',
    'failed',
    'rejected',
    'rate_limited'
);


ALTER TYPE "public"."atribuye_event_status" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_event_type" AS ENUM (
    'lead',
    'purchase',
    'add_to_cart',
    'initiate_checkout'
);


ALTER TYPE "public"."atribuye_event_type" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_lfpdppp_meta_status" AS ENUM (
    'not_attempted',
    'success',
    'failed'
);


ALTER TYPE "public"."atribuye_lfpdppp_meta_status" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_lfpdppp_status" AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed'
);


ALTER TYPE "public"."atribuye_lfpdppp_status" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_notification_type" AS ENUM (
    'event_synced',
    'webhook_error',
    'invitation_pending',
    'low_match_quality',
    'billing_change',
    'lfpdppp_request'
);


ALTER TYPE "public"."atribuye_notification_type" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_role" AS ENUM (
    'super_admin',
    'org_owner',
    'org_admin',
    'member'
);


ALTER TYPE "public"."atribuye_role" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_tier" AS ENUM (
    'soil',
    'growth',
    'scale'
);


ALTER TYPE "public"."atribuye_tier" OWNER TO "postgres";


CREATE TYPE "public"."atribuye_user_event_category" AS ENUM (
    'page_view',
    'click',
    'form_submit',
    'feature_use',
    'conversion',
    'error',
    'system'
);


ALTER TYPE "public"."atribuye_user_event_category" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atribuye_accept_invitation"("p_token_hash" "text", "p_user_id" "uuid", "p_user_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_invitation atribuye_invitations%ROWTYPE;
BEGIN
  -- 1. Validar invitation por token (hash) + lock row hasta el commit
  SELECT * INTO v_invitation
  FROM atribuye_invitations
  WHERE token = p_token_hash
    AND expires_at > NOW()
    AND accepted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_invalid_or_expired'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Validar email match (case-insensitive)
  IF lower(v_invitation.invited_email) <> lower(p_user_email) THEN
    RAISE EXCEPTION 'email_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Crear shadow user row (idempotent — el user puede haber existido en auth.users de antes)
  INSERT INTO atribuye_users (id, email)
  VALUES (p_user_id, lower(p_user_email))
  ON CONFLICT (id) DO NOTHING;

  -- 4. Marcar invitation como aceptada
  UPDATE atribuye_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = p_user_id
  WHERE id = v_invitation.id;

  -- 5. Crear membership con el role de la invitation
  INSERT INTO atribuye_memberships (
    user_id, organization_id, role,
    invited_by_user_id, invited_at, accepted_at
  )
  VALUES (
    p_user_id, v_invitation.organization_id, v_invitation.role,
    v_invitation.invited_by_user_id, v_invitation.created_at, NOW()
  );

  -- 6. Audit log inmutable (organization_id NOT NULL en el schema real)
  INSERT INTO atribuye_audit_log (
    organization_id, actor_user_id, action,
    resource_type, resource_id, diff
  )
  VALUES (
    v_invitation.organization_id, p_user_id, 'invitation_accepted',
    'atribuye_invitations', v_invitation.id,
    jsonb_build_object(
      'invited_email', v_invitation.invited_email,
      'role', v_invitation.role::text
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', v_invitation.organization_id,
    'role', v_invitation.role
  );
END;
$$;


ALTER FUNCTION "public"."atribuye_accept_invitation"("p_token_hash" "text", "p_user_id" "uuid", "p_user_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atribuye_compute_event_id"("p_phone" "text", "p_event_type" "text", "p_event_time" timestamp with time zone) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
  SELECT substring(
    encode(
      extensions.digest(
        p_phone || '|' || p_event_type || '|' ||
          to_char(p_event_time AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        'sha256'::text
      ),
      'hex'
    ),
    1, 32
  );
$$;


ALTER FUNCTION "public"."atribuye_compute_event_id"("p_phone" "text", "p_event_type" "text", "p_event_time" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."atribuye_compute_event_id"("p_phone" "text", "p_event_type" "text", "p_event_time" timestamp with time zone) IS 'event_id deterministico para Meta CAPI dedup. Compatible con optix-loops/common/capi_core.py:build_event_id (raw = phone|event_name|YYYY-MM-DD, sha256 hex [:32]). Caller debe pasar event_name capitalizado Meta-style (Purchase, Lead, AddToCart, InitiateCheckout).';



CREATE OR REPLACE FUNCTION "public"."atribuye_current_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT organization_id FROM atribuye_memberships WHERE user_id = auth.uid() AND deleted_at IS NULL LIMIT 1
$$;


ALTER FUNCTION "public"."atribuye_current_org_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."atribuye_current_org_id"() IS 'DEPRECATED desde migration 006. Usar atribuye_user_org_ids() (SETOF uuid), atribuye_user_admin_org_ids() o atribuye_user_owner_org_ids() segun role. Drop planeado en migration 007.';



CREATE OR REPLACE FUNCTION "public"."atribuye_lfpdppp_hard_delete"("p_organization_id" "uuid", "p_phone_hash" "text", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_conversions_deleted int := 0;
  v_events_scrubbed int := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.atribuye_conversions
    WHERE organization_id = p_organization_id AND phone_hash = p_phone_hash
    RETURNING id
  )
  SELECT count(*) INTO v_conversions_deleted FROM del;

  UPDATE public.atribuye_events
  SET payload = payload - 'user_data', updated_at = now()
  WHERE organization_id = p_organization_id
    AND payload->'user_data'->>'ph' = p_phone_hash;
  GET DIAGNOSTICS v_events_scrubbed = ROW_COUNT;

  UPDATE public.atribuye_lfpdppp_requests
  SET status = 'completed'::atribuye_lfpdppp_status,
      completed_at = now(),
      conversions_deleted_count = v_conversions_deleted,
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.atribuye_audit_log (organization_id, actor_user_id, action, resource_type, resource_id, diff)
  VALUES (p_organization_id, auth.uid(), 'lfpdppp.hard_delete', 'lfpdppp_request', p_request_id,
    jsonb_build_object('phone_hash', p_phone_hash, 'conversions_deleted', v_conversions_deleted, 'events_scrubbed', v_events_scrubbed));

  RETURN jsonb_build_object('conversions_deleted', v_conversions_deleted, 'events_scrubbed', v_events_scrubbed, 'request_id', p_request_id);
END;
$$;


ALTER FUNCTION "public"."atribuye_lfpdppp_hard_delete"("p_organization_id" "uuid", "p_phone_hash" "text", "p_request_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."atribuye_lfpdppp_hard_delete"("p_organization_id" "uuid", "p_phone_hash" "text", "p_request_id" "uuid") IS 'LFPDPPP cascade hard delete + scrub events.payload.user_data + audit log. SECURITY DEFINER bypass RLS.';



CREATE OR REPLACE FUNCTION "public"."atribuye_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."atribuye_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atribuye_user_admin_org_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT organization_id
  FROM public.atribuye_memberships
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
    AND role = ANY (ARRAY['super_admin'::atribuye_role, 'org_owner'::atribuye_role, 'org_admin'::atribuye_role]);
$$;


ALTER FUNCTION "public"."atribuye_user_admin_org_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atribuye_user_org_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT organization_id
  FROM public.atribuye_memberships
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL;
$$;


ALTER FUNCTION "public"."atribuye_user_org_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atribuye_user_owner_org_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT organization_id
  FROM public.atribuye_memberships
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
    AND role = ANY (ARRAY['super_admin'::atribuye_role, 'org_owner'::atribuye_role]);
$$;


ALTER FUNCTION "public"."atribuye_user_owner_org_ids"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."atribuye_user_owner_org_ids"() IS 'Orgs donde el user es super_admin u org_owner. Usado por audit_log_select_owner.';



CREATE OR REPLACE FUNCTION "public"."check_and_increment_analysis_count"("org_id" "uuid", "tier_limit" integer) RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE current_count INTEGER;
BEGIN
  -- Sin tier_limit: siempre permite
  IF tier_limit IS NULL THEN RETURN TRUE; END IF;
  
  -- Solo lee (el incremento lo hace el trigger AFTER INSERT)
  SELECT analyses_count INTO current_count 
  FROM public.organizations 
  WHERE id = org_id;
  
  IF current_count >= tier_limit THEN RETURN FALSE; END IF;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."check_and_increment_analysis_count"("org_id" "uuid", "tier_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_and_increment_analysis_count"("org_id" "uuid", "tier_limit" integer) IS 'Refactored 2026-04-29 (Audit 03): now check-only. Increment moved to AFTER INSERT trigger on analyses table for atomicity. Signature preserved for caller compatibility. Name kept legacy; consider rename to check_analysis_count_can_increment in future.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."background_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "payload" "jsonb" NOT NULL,
    "result" "jsonb",
    "error_message" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "max_retries" integer DEFAULT 3 NOT NULL,
    "next_retry_at" timestamp with time zone,
    "processing_started_at" timestamp with time zone,
    "processing_worker_id" "text",
    "quota_consumed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "background_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'error'::"text", 'cancelled'::"text", 'rejected'::"text"]))),
    CONSTRAINT "background_jobs_type_check" CHECK (("type" = ANY (ARRAY['analysis'::"text", 'vambe_sync'::"text"])))
);


ALTER TABLE "public"."background_jobs" OWNER TO "postgres";


COMMENT ON CONSTRAINT "background_jobs_type_check" ON "public"."background_jobs" IS 'Allowed job types. ''analysis'' processes a recording into an analysis row. ''vambe_sync'' pushes a completed analysis into the Vambe CRM for the org.';



CREATE OR REPLACE FUNCTION "public"."claim_next_jobs"("p_limit" integer, "p_worker_id" "text") RETURNS SETOF "public"."background_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  UPDATE background_jobs
  SET
    status = 'processing',
    processing_started_at = NOW(),
    processing_worker_id = p_worker_id,
    updated_at = NOW()
  WHERE id IN (
    SELECT id FROM background_jobs
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_next_jobs"("p_limit" integer, "p_worker_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_grace_periods"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."expire_grace_periods"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_starter_orgs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."expire_starter_orgs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_org_quota"("p_org_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."get_org_quota"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT organization_id FROM users WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT roles[1] FROM public.users WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_roles"() RETURNS "text"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT roles FROM public.users WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_user_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_analyses_count_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.organizations
  SET analyses_count = analyses_count + 1, 
      updated_at = NOW()
  WHERE id = NEW.organization_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."increment_analyses_count_trigger"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."increment_analyses_count_trigger"() IS 'Trigger function for AFTER INSERT on analyses. Increments organizations.analyses_count atomically with the insert. Created 2026-04-29 (Audit 03) to fix drift. SECURITY DEFINER so trigger can update organizations regardless of caller role.';



CREATE OR REPLACE FUNCTION "public"."reset_monthly_analysis_counts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE organizations
  SET analyses_count = 0, updated_at = NOW()
  WHERE analyses_count > 0;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;


ALTER FUNCTION "public"."reset_monthly_analysis_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_grace_period"("p_stripe_customer_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."resolve_grace_period"("p_stripe_customer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_grace_period"("p_stripe_customer_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."start_grace_period"("p_stripe_customer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_users_role_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.roles IS DISTINCT FROM OLD.roles THEN
    NEW.role := NEW.roles[1];
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.roles := ARRAY[NEW.role];
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_users_role_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upgrade_org_plan"("p_stripe_customer_id" "text", "p_plan" "text", "p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."upgrade_org_plan"("p_stripe_customer_id" "text", "p_plan" "text", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_scorecard_phases_schema"("phases" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  phase jsonb;
BEGIN
  -- Permitir NULL
  IF phases IS NULL THEN
    RETURN true;
  END IF;
  
  -- Debe ser array
  IF jsonb_typeof(phases) != 'array' THEN
    RETURN false;
  END IF;
  
  -- Array vacío permitido
  IF jsonb_array_length(phases) = 0 THEN
    RETURN true;
  END IF;
  
  -- Cada fase debe tener phase_id, phase_name, score_max
  FOR phase IN SELECT * FROM jsonb_array_elements(phases)
  LOOP
    IF NOT (phase ? 'phase_id' AND phase ? 'phase_name' AND phase ? 'score_max') THEN
      RETURN false;
    END IF;
  END LOOP;
  
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."validate_scorecard_phases_schema"("phases" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_legacy_user_organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "organization_id" "uuid",
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_organizations_role_check" CHECK (("role" = ANY (ARRAY['captadora'::"text", 'gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"])))
);


ALTER TABLE "public"."_legacy_user_organizations" OWNER TO "postgres";


COMMENT ON TABLE "public"."_legacy_user_organizations" IS 'DEPRECATED 2026-04-29 (Audit 03 P1). Tabla M:N preparada pero nunca usada para autorización. SOT real del tenant es users.organization_id consultada por get_user_org_id(). Su policy permisiva creaba agujero cross-tenant en storage policies del bucket recordings (parchado en migration fix_storage_cross_tenant_via_users_org_id). Renombrada a _legacy_ en vez de DROP para detectar callers en repo (Edge Function, Worker, frontend) sin pérdida irreversible. Pendiente: confirmar 0 callers en código, después DROP TABLE definitivamente.';



CREATE TABLE IF NOT EXISTS "public"."alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "fuente_lead_id" "uuid",
    "threshold_value" numeric,
    "current_value" numeric,
    "status" "text" DEFAULT 'activa'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "description" "text",
    CONSTRAINT "alerts_status_check" CHECK (("status" = ANY (ARRAY['activa'::"text", 'atendida'::"text"]))),
    CONSTRAINT "alerts_type_check" CHECK (("type" = ANY (ARRAY['lead_quality_drop'::"text", 'conversion_rate_drop'::"text", 'fuente_performance'::"text", 'volume_anomaly'::"text", 'high_edit_pattern'::"text"])))
);


ALTER TABLE "public"."alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analyses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "scorecard_id" "uuid" NOT NULL,
    "funnel_stage_id" "uuid",
    "fuente_lead_id" "uuid",
    "prospect_identifier" "text",
    "score_general" integer,
    "clasificacion" "text",
    "momento_critico" "text",
    "patron_error" "text",
    "objecion_principal" "text",
    "siguiente_accion" "text",
    "manager_note" "text",
    "categoria_descalificacion" "jsonb",
    "avanzo_a_siguiente_etapa" "text" DEFAULT 'pending'::"text",
    "conversion_discrepancy" boolean DEFAULT false,
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "prospect_name" "text",
    "prospect_zone" "text",
    "property_type" "text",
    "sale_reason" "text",
    "checklist_results" "jsonb",
    "related_analysis_id" "uuid",
    "prospect_phone" "text",
    "equipment_type" "text",
    "business_type" "text",
    "vehicle_interest" "text",
    "financing_type" "text",
    "notes" "text",
    "legacy_note" "text",
    "highlights" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "llm_lead_status" "text",
    "lead_estado" "text" GENERATED ALWAYS AS (
CASE
    WHEN ("jsonb_array_length"(COALESCE("categoria_descalificacion", '[]'::"jsonb")) > 0) THEN 'descartado'::"text"
    WHEN ("llm_lead_status" = ANY (ARRAY['lost_captadora'::"text", 'lost_external'::"text"])) THEN 'descartado'::"text"
    WHEN ("llm_lead_status" = 'converted'::"text") THEN 'calificado'::"text"
    ELSE 'pendiente'::"text"
END) STORED,
    "lead_quality" "text",
    "lead_outcome" "text",
    "vambe_sync_status" "text",
    "vambe_sync_at" timestamp with time zone,
    "vambe_sync_error" "text",
    "vambe_ai_contact_id" "text",
    "vambe_metadata_extracted" "jsonb",
    "background_job_id" "uuid",
    "error_message" "text",
    CONSTRAINT "analyses_avanzo_a_siguiente_etapa_check" CHECK (("avanzo_a_siguiente_etapa" = ANY (ARRAY['converted'::"text", 'lost_captadora'::"text", 'lost_external'::"text", 'pending'::"text"]))),
    CONSTRAINT "analyses_clasificacion_check" CHECK (("clasificacion" = ANY (ARRAY['excelente'::"text", 'buena'::"text", 'regular'::"text", 'deficiente'::"text"]))),
    CONSTRAINT "analyses_lead_outcome_check" CHECK (("lead_outcome" = ANY (ARRAY['cerrado_completo'::"text", 'cerrado_parcial'::"text", 'pospuesto_con_agenda'::"text", 'pospuesto_sin_agenda'::"text", 'descalificado'::"text", 'perdido'::"text"]))),
    CONSTRAINT "analyses_lead_quality_check" CHECK (("lead_quality" = ANY (ARRAY['calificado'::"text", 'descalificado'::"text", 'indeterminado'::"text"]))),
    CONSTRAINT "analyses_llm_lead_status_check" CHECK ((("llm_lead_status" IS NULL) OR ("llm_lead_status" = ANY (ARRAY['converted'::"text", 'lost_captadora'::"text", 'lost_external'::"text", 'pending'::"text"])))),
    CONSTRAINT "analyses_status_check" CHECK (("status" = ANY (ARRAY['pendiente'::"text", 'procesando'::"text", 'completado'::"text", 'error'::"text", 'rechazado'::"text"]))),
    CONSTRAINT "analyses_vambe_sync_status_check" CHECK (("vambe_sync_status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'failed'::"text", 'no_phone_match'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."analyses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."analyses"."lead_quality" IS 'Calidad del lead como prospecto (atributo del paciente/cliente). En V1 lo determina el LLM por análisis. V2 deberá derivarse de criterios configurables por org en tabla lead_quality_criteria. Si el mismo prospecto tiene varios análisis, idealmente lead_quality es consistente entre ellos.';



COMMENT ON COLUMN "public"."analyses"."lead_outcome" IS 'Resultado de esta conversación específica. Granular para reporting: cerrado_completo (paquete completo + primer servicio), cerrado_parcial (depósito o fase 1), pospuesto_con_agenda (segunda visita con fecha firme), pospuesto_sin_agenda (te aviso vago = red flag), descalificado (lead no aplica), perdido (lead calificado que no cerró ni agendó).';



COMMENT ON COLUMN "public"."analyses"."vambe_sync_status" IS 'Status of sync to Vambe CRM: pending (queued), success, failed (retry exhausted), no_phone_match (no usable phone), skipped (org.vambe_enabled=false)';



COMMENT ON COLUMN "public"."analyses"."vambe_sync_at" IS 'Timestamp of the last Vambe sync attempt (success or final failure)';



COMMENT ON COLUMN "public"."analyses"."vambe_sync_error" IS 'Error message from the last failed Vambe sync attempt, if any';



COMMENT ON COLUMN "public"."analyses"."vambe_ai_contact_id" IS 'Vambe aiContactId matched/created for this analysis (used to link back to Vambe UI)';



COMMENT ON COLUMN "public"."analyses"."vambe_metadata_extracted" IS 'JSON block extracted by the scorecard LLM with the vambe_metadata key — the 18 custom fields to push to Vambe';



COMMENT ON COLUMN "public"."analyses"."background_job_id" IS 'Idempotency anchor for Edge Function-driven analyses (Plan G, 2026-05-05). NULL for Worker-driven path. UNIQUE constraint added in separate migration after retroactive cleanup of Jenifer duplicates.';



COMMENT ON COLUMN "public"."analyses"."error_message" IS 'Error message for status=error or rejection reason for status=rechazado. Populated by Edge Function path. NULL for completed analyses or Worker path historical rows.';



CREATE TABLE IF NOT EXISTS "public"."analysis_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "analysis_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "processing_started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error_message" "text",
    "transcription_text" "text",
    "has_audio" boolean DEFAULT false,
    "audio_url" "text",
    "audio_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "transcription_original" "text",
    "transcription_edited" "text",
    "edit_percentage" smallint DEFAULT 0,
    "pause_count" smallint DEFAULT 0,
    "total_paused_seconds" integer DEFAULT 0,
    CONSTRAINT "analysis_jobs_status_check" CHECK (("status" = ANY (ARRAY['pendiente'::"text", 'procesando'::"text", 'completado'::"text", 'error'::"text", 'rechazado'::"text"])))
);


ALTER TABLE "public"."analysis_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analysis_phases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "analysis_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "phase_id" "text" NOT NULL,
    "phase_name" "text" NOT NULL,
    "score" integer NOT NULL,
    "score_max" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."analysis_phases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_attribution_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "organization_id" "uuid",
    "anonymous_id" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "utm_term" "text",
    "fbclid" "text",
    "gclid" "text",
    "ttclid" "text",
    "msclkid" "text",
    "landing_page" "text" NOT NULL,
    "referrer" "text",
    "conversion_type" "text",
    "conversion_value" numeric(12,2),
    "conversion_at" timestamp with time zone,
    "user_agent" "text",
    "ip_address" "inet",
    "country_code" "text",
    "is_first_touch" boolean DEFAULT false NOT NULL,
    "is_last_touch" boolean DEFAULT true NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_attribution_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text",
    "resource_id" "uuid",
    "diff" "jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_conversions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "external_id" "text",
    "source" "public"."atribuye_conversion_source" NOT NULL,
    "crm_connection_id" "uuid",
    "crm_contact_id" "text",
    "csv_upload_id" "uuid",
    "ctwa_clid" "text",
    "phone_hash" "text" NOT NULL,
    "email_hash" "text",
    "first_name_hash" "text",
    "last_name_hash" "text",
    "city_hash" "text",
    "country_code" "text" DEFAULT 'mx'::"text" NOT NULL,
    "event_type" "public"."atribuye_event_type" NOT NULL,
    "event_time" timestamp with time zone NOT NULL,
    "value" numeric(12,2),
    "currency" "text" DEFAULT 'MXN'::"text" NOT NULL,
    "product" "text",
    "ad_id" "text",
    "adset_id" "text",
    "campaign_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "match_quality_estimated" numeric(3,1),
    "match_quality_real" numeric(3,1),
    "match_quality_real_received_at" timestamp with time zone,
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "hard_deleted_at" timestamp with time zone,
    "created_by_user_id" "uuid"
);


ALTER TABLE "public"."atribuye_conversions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."atribuye_conversions"."created_by_user_id" IS 'User que creo la conversion (member-can-delete-own RLS). NULL si fue creada por service_role o si el user fue borrado.';



CREATE TABLE IF NOT EXISTS "public"."atribuye_crm_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "type" "public"."atribuye_crm_type" NOT NULL,
    "name" "text",
    "workspace_id" "text",
    "pipeline_id" "text",
    "pipeline_name" "text",
    "trigger_stage_id" "text" NOT NULL,
    "trigger_stage_name" "text",
    "webhook_secret" "text" NOT NULL,
    "webhook_url" "text",
    "last_webhook_received_at" timestamp with time zone,
    "status" "public"."atribuye_crm_status" DEFAULT 'active'::"public"."atribuye_crm_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "api_key_secret_id" "uuid" NOT NULL
);


ALTER TABLE "public"."atribuye_crm_connections" OWNER TO "postgres";


COMMENT ON COLUMN "public"."atribuye_crm_connections"."api_key_secret_id" IS 'Vault secret ID con la API key del CRM. Resolver via vault.decrypted_secrets.';



CREATE TABLE IF NOT EXISTS "public"."atribuye_csv_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "uploaded_by_user_id" "uuid" NOT NULL,
    "filename" "text" NOT NULL,
    "file_size_bytes" integer NOT NULL,
    "total_rows" integer,
    "valid_rows" integer,
    "error_rows" integer,
    "column_mapping" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "public"."atribuye_csv_status" DEFAULT 'uploading'::"public"."atribuye_csv_status" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_csv_uploads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "conversion_id" "uuid" NOT NULL,
    "event_id" "text" NOT NULL,
    "meta_dataset_id" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "response" "jsonb",
    "status" "public"."atribuye_event_status" DEFAULT 'pending'::"public"."atribuye_event_status" NOT NULL,
    "attempt_count" smallint DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "error_code" "text",
    "error_message" "text",
    "is_test_event" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "invited_email" "text" NOT NULL,
    "invited_by_user_id" "uuid" NOT NULL,
    "role" "public"."atribuye_role" DEFAULT 'member'::"public"."atribuye_role" NOT NULL,
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "accepted_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_lfpdppp_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "requester_email" "text" NOT NULL,
    "target_phone_hash" "text" NOT NULL,
    "target_email_hash" "text",
    "status" "public"."atribuye_lfpdppp_status" DEFAULT 'pending'::"public"."atribuye_lfpdppp_status" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "conversions_deleted_count" integer DEFAULT 0 NOT NULL,
    "meta_deletion_status" "public"."atribuye_lfpdppp_meta_status" DEFAULT 'not_attempted'::"public"."atribuye_lfpdppp_meta_status" NOT NULL,
    "meta_deletion_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_lfpdppp_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "role" "public"."atribuye_role" DEFAULT 'member'::"public"."atribuye_role" NOT NULL,
    "invited_by_user_id" "uuid",
    "invited_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."atribuye_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_meta_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "business_manager_id" "text" NOT NULL,
    "business_manager_name" "text",
    "facebook_page_id" "text" NOT NULL,
    "facebook_page_name" "text",
    "ad_account_id" "text" NOT NULL,
    "ad_account_name" "text",
    "waba_id" "text",
    "waba_phone_number" "text",
    "dataset_id" "text" NOT NULL,
    "dataset_name" "text",
    "access_token_expires_at" timestamp with time zone,
    "connected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_validated_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "access_token_secret_id" "uuid" NOT NULL
);


ALTER TABLE "public"."atribuye_meta_connections" OWNER TO "postgres";


COMMENT ON COLUMN "public"."atribuye_meta_connections"."access_token_secret_id" IS 'Vault secret ID con el access token de Meta Graph API. Resolver via vault.decrypted_secrets.';



CREATE TABLE IF NOT EXISTS "public"."atribuye_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "type" "public"."atribuye_notification_type" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "action_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "tier" "public"."atribuye_tier" DEFAULT 'soil'::"public"."atribuye_tier" NOT NULL,
    "max_seats" smallint DEFAULT 3 NOT NULL,
    "max_events_per_month" integer DEFAULT 5000 NOT NULL,
    "billing_status" "public"."atribuye_billing_status" DEFAULT 'trial'::"public"."atribuye_billing_status" NOT NULL,
    "trial_ends_at" timestamp with time zone,
    "onboarding_step" smallint DEFAULT 1 NOT NULL,
    "onboarding_completed_at" timestamp with time zone,
    "legal_accepted_at" timestamp with time zone,
    "legal_accepted_ip" "inet",
    "timezone" "text" DEFAULT 'America/Mexico_City'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "atribuye_organizations_onboarding_step_check" CHECK ((("onboarding_step" >= 1) AND ("onboarding_step" <= 9)))
);


ALTER TABLE "public"."atribuye_organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_system_health" (
    "cron_job_name" "text" NOT NULL,
    "last_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'ok'::"text" NOT NULL,
    "error_message" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "atribuye_system_health_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'failed'::"text", 'stale'::"text"])))
);


ALTER TABLE "public"."atribuye_system_health" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_user_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "user_id" "uuid",
    "anonymous_id" "text",
    "event_name" "text" NOT NULL,
    "event_category" "public"."atribuye_user_event_category" NOT NULL,
    "page_path" "text",
    "page_url" "text",
    "referrer" "text",
    "user_agent" "text",
    "ip_address" "inet",
    "properties" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "session_id" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."atribuye_user_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atribuye_users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."atribuye_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "name" "text",
    "description" "text",
    "icon_code" "text",
    "condition_type" "text",
    "condition_value" numeric,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_trackers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "description" "text" NOT NULL,
    "speaker" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "conversation_trackers_speaker_check" CHECK (("speaker" = ANY (ARRAY['prospect'::"text", 'seller'::"text", 'any'::"text"])))
);


ALTER TABLE "public"."conversation_trackers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."descalification_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."descalification_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."funnel_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "working_days" integer[] DEFAULT ARRAY[1, 2, 3, 4, 5],
    "timezone" "text" DEFAULT 'America/Mexico_City'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."funnel_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."funnel_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "scorecard_id" "uuid",
    "name" "text" NOT NULL,
    "stage_type" "text" NOT NULL,
    "order_index" integer NOT NULL,
    "min_score_to_advance" integer,
    "avg_cycle_days" integer,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "funnel_stages_stage_type_check" CHECK (("stage_type" = ANY (ARRAY['llamada'::"text", 'visita'::"text", 'cierre'::"text"])))
);


ALTER TABLE "public"."funnel_stages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "token" "text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "roles" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    CONSTRAINT "invitations_role_check" CHECK (("role" = ANY (ARRAY['captadora'::"text", 'gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]))),
    CONSTRAINT "invitations_roles_valid" CHECK (("roles" <@ ARRAY['captadora'::"text", 'gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_quality_criteria" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "scorecard_id" "uuid",
    "criteria" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_quality_criteria" OWNER TO "postgres";


COMMENT ON TABLE "public"."lead_quality_criteria" IS 'V2: criterios configurables por org/scorecard para derivar lead_quality automáticamente. V1 vacía, lead_quality lo determina el LLM directamente.';



CREATE TABLE IF NOT EXISTS "public"."lead_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "cost_per_lead" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."lead_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."objective_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "objective_id" "uuid",
    "organization_id" "uuid" NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "current_value" numeric,
    "completion_pct" numeric,
    "on_track" boolean,
    "projected_final" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."objective_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."objectives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "target_user_id" "uuid",
    "type" "text",
    "target_phase_id" "text",
    "target_value" numeric NOT NULL,
    "period_type" "text",
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "is_active" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" "text",
    "current_value" numeric DEFAULT 0,
    CONSTRAINT "objectives_period_type_check" CHECK (("period_type" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'custom'::"text"]))),
    CONSTRAINT "objectives_type_check" CHECK (("type" = ANY (ARRAY['volume'::"text", 'score'::"text", 'phase_score'::"text", 'consistency'::"text"])))
);


ALTER TABLE "public"."objectives" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'starter'::"text" NOT NULL,
    "founder_account" boolean DEFAULT false,
    "analyses_count" integer DEFAULT 0 NOT NULL,
    "timezone" "text" DEFAULT 'America/Mexico_City'::"text",
    "access_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_grace_started_at" timestamp with time zone,
    "conversion_baseline" numeric,
    "ticket_promedio" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "role_label_vendedor" "text" DEFAULT 'Captadora'::"text",
    "invite_token" "uuid" DEFAULT "gen_random_uuid"(),
    "vocabulary" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "vertical" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "vambe_enabled" boolean DEFAULT false NOT NULL,
    "vambe_api_key" "text",
    "vambe_tag_ids" "jsonb",
    CONSTRAINT "organizations_access_status_check" CHECK (("access_status" = ANY (ARRAY['active'::"text", 'grace'::"text", 'read_only'::"text"]))),
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['starter'::"text", 'growth'::"text", 'pro'::"text", 'scale'::"text", 'enterprise'::"text", 'founder'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."organizations"."vertical" IS 'Verticales del org. Valores válidos: inmobiliario, financiero, presencial_salud, automotriz. Array para soportar orgs multi-vertical.';



COMMENT ON COLUMN "public"."organizations"."vambe_enabled" IS 'Feature flag: if true, analyses for this org are queued for Vambe sync post-analysis';



COMMENT ON COLUMN "public"."organizations"."vambe_api_key" IS 'Vambe write-scope API key for this org. MUST be read only via service_role (see RLS policy vambe_api_key_service_role_only). Encryption deferred to pgsodium when we scale beyond single-tenant Vambe use.';



COMMENT ON COLUMN "public"."organizations"."vambe_tag_ids" IS 'Cached Vambe tag IDs for this org to avoid GET /tags per sync. Shape: { "aurisiq_analizado": "tag_xxx", "lead_calificado_aurisiq": "tag_yyy", "lead_descalificado_aurisiq": "tag_zzz" }';



CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "generated_by" "uuid",
    "tipo" "text" NOT NULL,
    "destinatario_tipo" "text" NOT NULL,
    "content" "jsonb",
    "sent_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reports_destinatario_tipo_check" CHECK (("destinatario_tipo" = ANY (ARRAY['equipo'::"text", 'agencia'::"text", 'direccion'::"text", 'todos'::"text"]))),
    CONSTRAINT "reports_tipo_check" CHECK (("tipo" = ANY (ARRAY['semanal'::"text", 'mensual'::"text"])))
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scorecard_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "vertical_slug" "text" NOT NULL,
    "description" "text",
    "structure" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_vocabulary" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "default_categories" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scorecard_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scorecards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "name" "text" NOT NULL,
    "version" "text" NOT NULL,
    "vertical" "text" NOT NULL,
    "phases" "jsonb" NOT NULL,
    "prompt_template" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "template_id" "uuid",
    "structure" "jsonb",
    CONSTRAINT "scorecards_phases_schema_a" CHECK ("public"."validate_scorecard_phases_schema"("phases")),
    CONSTRAINT "scorecards_phases_valid_schema" CHECK ("public"."validate_scorecard_phases_schema"("phases"))
);


ALTER TABLE "public"."scorecards" OWNER TO "postgres";


COMMENT ON CONSTRAINT "scorecards_phases_schema_a" ON "public"."scorecards" IS 'Schema A canónico: cada fase debe tener phase_id, phase_name, score_max. Rechaza Schema B {name, criteria, max_score}. Ver TÉCNICO F0ALYPV5D16.';



CREATE TABLE IF NOT EXISTS "public"."speech_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "scorecard_id" "uuid",
    "version_number" integer NOT NULL,
    "content" "jsonb" NOT NULL,
    "published" boolean DEFAULT true,
    "published_by" "uuid",
    "published_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "funnel_stage_id" "uuid",
    "is_provisional" boolean DEFAULT false
);


ALTER TABLE "public"."speech_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stage_checklist_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "funnel_stage_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 100,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stage_checklist_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "processed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tracker_org_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "tracker_id" "uuid" NOT NULL,
    "disabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tracker_org_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transcript_edits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "analysis_job_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "previous_text" "text" NOT NULL,
    "new_text" "text" NOT NULL,
    "edit_percentage" numeric(5,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transcript_edits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "badge_id" "uuid",
    "earned_at" timestamp with time zone,
    "notified" boolean DEFAULT false
);


ALTER TABLE "public"."user_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "photo_url" "text",
    "active" boolean DEFAULT true,
    "last_sign_in_at" timestamp with time zone,
    "xp_total" integer DEFAULT 0,
    "level" integer DEFAULT 1,
    "current_streak" integer DEFAULT 0,
    "longest_streak" integer DEFAULT 0,
    "last_analysis_date" "date",
    "current_focus_phase" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "city" "text",
    "training_mode" boolean DEFAULT false,
    "roles" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['captadora'::"text", 'gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]))),
    CONSTRAINT "users_roles_not_empty" CHECK (("array_length"("roles", 1) >= 1)),
    CONSTRAINT "users_roles_valid" CHECK (("roles" <@ ARRAY['captadora'::"text", 'gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xp_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "organization_id" "uuid" NOT NULL,
    "event_type" "text",
    "xp_earned" integer,
    "analysis_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."xp_events" OWNER TO "postgres";


ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_background_job_id_unique" UNIQUE ("background_job_id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analysis_jobs"
    ADD CONSTRAINT "analysis_jobs_analysis_id_key" UNIQUE ("analysis_id");



ALTER TABLE ONLY "public"."analysis_jobs"
    ADD CONSTRAINT "analysis_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analysis_phases"
    ADD CONSTRAINT "analysis_phases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_attribution_events"
    ADD CONSTRAINT "atribuye_attribution_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_audit_log"
    ADD CONSTRAINT "atribuye_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_conversions"
    ADD CONSTRAINT "atribuye_conversions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_crm_connections"
    ADD CONSTRAINT "atribuye_crm_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_csv_uploads"
    ADD CONSTRAINT "atribuye_csv_uploads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_events"
    ADD CONSTRAINT "atribuye_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_invitations"
    ADD CONSTRAINT "atribuye_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_invitations"
    ADD CONSTRAINT "atribuye_invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."atribuye_lfpdppp_requests"
    ADD CONSTRAINT "atribuye_lfpdppp_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_memberships"
    ADD CONSTRAINT "atribuye_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_meta_connections"
    ADD CONSTRAINT "atribuye_meta_connections_organization_id_key" UNIQUE ("organization_id");



ALTER TABLE ONLY "public"."atribuye_meta_connections"
    ADD CONSTRAINT "atribuye_meta_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_notifications"
    ADD CONSTRAINT "atribuye_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_organizations"
    ADD CONSTRAINT "atribuye_organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_organizations"
    ADD CONSTRAINT "atribuye_organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."atribuye_organizations"
    ADD CONSTRAINT "atribuye_organizations_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."atribuye_organizations"
    ADD CONSTRAINT "atribuye_organizations_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."atribuye_system_health"
    ADD CONSTRAINT "atribuye_system_health_pkey" PRIMARY KEY ("cron_job_name");



ALTER TABLE ONLY "public"."atribuye_user_events"
    ADD CONSTRAINT "atribuye_user_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atribuye_users"
    ADD CONSTRAINT "atribuye_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."atribuye_users"
    ADD CONSTRAINT "atribuye_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."background_jobs"
    ADD CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."badges"
    ADD CONSTRAINT "badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_trackers"
    ADD CONSTRAINT "conversation_trackers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."descalification_categories"
    ADD CONSTRAINT "descalification_categories_organization_id_code_key" UNIQUE ("organization_id", "code");



ALTER TABLE ONLY "public"."descalification_categories"
    ADD CONSTRAINT "descalification_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."funnel_config"
    ADD CONSTRAINT "funnel_config_organization_id_key" UNIQUE ("organization_id");



ALTER TABLE ONLY "public"."funnel_config"
    ADD CONSTRAINT "funnel_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."funnel_stages"
    ADD CONSTRAINT "funnel_stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."lead_quality_criteria"
    ADD CONSTRAINT "lead_quality_criteria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."objective_progress"
    ADD CONSTRAINT "objective_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."objectives"
    ADD CONSTRAINT "objectives_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_invite_token_key" UNIQUE ("invite_token");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scorecard_templates"
    ADD CONSTRAINT "scorecard_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scorecards"
    ADD CONSTRAINT "scorecards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speech_versions"
    ADD CONSTRAINT "speech_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stage_checklist_items"
    ADD CONSTRAINT "stage_checklist_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tracker_org_overrides"
    ADD CONSTRAINT "tracker_org_overrides_organization_id_tracker_id_key" UNIQUE ("organization_id", "tracker_id");



ALTER TABLE ONLY "public"."tracker_org_overrides"
    ADD CONSTRAINT "tracker_org_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transcript_edits"
    ADD CONSTRAINT "transcript_edits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."_legacy_user_organizations"
    ADD CONSTRAINT "user_organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."_legacy_user_organizations"
    ADD CONSTRAINT "user_organizations_user_id_organization_id_key" UNIQUE ("user_id", "organization_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xp_events"
    ADD CONSTRAINT "xp_events_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_alerts_org_status" ON "public"."alerts" USING "btree" ("organization_id", "status");



CREATE INDEX "idx_analyses_conversion" ON "public"."analyses" USING "btree" ("organization_id", "avanzo_a_siguiente_etapa");



CREATE INDEX "idx_analyses_lead_estado" ON "public"."analyses" USING "btree" ("organization_id", "lead_estado");



CREATE INDEX "idx_analyses_prospect" ON "public"."analyses" USING "btree" ("organization_id", "prospect_identifier") WHERE ("prospect_identifier" IS NOT NULL);



CREATE INDEX "idx_analyses_user" ON "public"."analyses" USING "btree" ("organization_id", "user_id", "created_at" DESC);



CREATE INDEX "idx_analyses_vambe_sync_status_pending" ON "public"."analyses" USING "btree" ("vambe_sync_status") WHERE ("vambe_sync_status" = ANY (ARRAY['pending'::"text", 'failed'::"text"]));



CREATE INDEX "idx_atribuye_attribution_anon" ON "public"."atribuye_attribution_events" USING "btree" ("anonymous_id", "occurred_at" DESC) WHERE ("anonymous_id" IS NOT NULL);



CREATE INDEX "idx_atribuye_attribution_conversion" ON "public"."atribuye_attribution_events" USING "btree" ("conversion_type", "conversion_at") WHERE ("conversion_at" IS NOT NULL);



CREATE INDEX "idx_atribuye_attribution_user" ON "public"."atribuye_attribution_events" USING "btree" ("user_id", "occurred_at" DESC) WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_atribuye_attribution_utm_source_campaign" ON "public"."atribuye_attribution_events" USING "btree" ("utm_source", "utm_campaign");



CREATE INDEX "idx_atribuye_audit_log_actor" ON "public"."atribuye_audit_log" USING "btree" ("actor_user_id", "created_at" DESC);



CREATE INDEX "idx_atribuye_audit_log_org_created" ON "public"."atribuye_audit_log" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "idx_atribuye_conversions_created_by" ON "public"."atribuye_conversions" USING "btree" ("created_by_user_id") WHERE ("created_by_user_id" IS NOT NULL);



CREATE INDEX "idx_atribuye_conversions_crm" ON "public"."atribuye_conversions" USING "btree" ("crm_connection_id") WHERE ("crm_connection_id" IS NOT NULL);



CREATE INDEX "idx_atribuye_conversions_csv" ON "public"."atribuye_conversions" USING "btree" ("csv_upload_id") WHERE ("csv_upload_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_atribuye_conversions_dedup_webhook" ON "public"."atribuye_conversions" USING "btree" ("crm_connection_id", "crm_contact_id", "event_type", "event_time") WHERE (("source" = 'crm_webhook'::"public"."atribuye_conversion_source") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_atribuye_conversions_org_event_time" ON "public"."atribuye_conversions" USING "btree" ("organization_id", "event_time" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_atribuye_conversions_org_event_type" ON "public"."atribuye_conversions" USING "btree" ("organization_id", "event_type") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_atribuye_conversions_org_phone" ON "public"."atribuye_conversions" USING "btree" ("organization_id", "phone_hash");



CREATE INDEX "idx_atribuye_crm_connections_org" ON "public"."atribuye_crm_connections" USING "btree" ("organization_id");



CREATE INDEX "idx_atribuye_crm_connections_org_type" ON "public"."atribuye_crm_connections" USING "btree" ("organization_id", "type");



CREATE INDEX "idx_atribuye_crm_connections_secret" ON "public"."atribuye_crm_connections" USING "btree" ("webhook_secret");



CREATE INDEX "idx_atribuye_csv_uploads_org" ON "public"."atribuye_csv_uploads" USING "btree" ("organization_id");



CREATE INDEX "idx_atribuye_csv_uploads_org_status" ON "public"."atribuye_csv_uploads" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE INDEX "idx_atribuye_events_conversion" ON "public"."atribuye_events" USING "btree" ("conversion_id");



CREATE INDEX "idx_atribuye_events_event_id" ON "public"."atribuye_events" USING "btree" ("event_id");



CREATE INDEX "idx_atribuye_events_mq_polling" ON "public"."atribuye_events" USING "btree" ("created_at") WHERE ("status" = 'sent'::"public"."atribuye_event_status");



CREATE INDEX "idx_atribuye_events_org_status_created" ON "public"."atribuye_events" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE INDEX "idx_atribuye_invitations_email_org" ON "public"."atribuye_invitations" USING "btree" ("invited_email", "organization_id");



CREATE INDEX "idx_atribuye_invitations_org" ON "public"."atribuye_invitations" USING "btree" ("organization_id");



CREATE INDEX "idx_atribuye_invitations_token" ON "public"."atribuye_invitations" USING "btree" ("token");



CREATE INDEX "idx_atribuye_lfpdppp_requests_org_status" ON "public"."atribuye_lfpdppp_requests" USING "btree" ("organization_id", "status");



CREATE INDEX "idx_atribuye_lfpdppp_requests_phone" ON "public"."atribuye_lfpdppp_requests" USING "btree" ("target_phone_hash");



CREATE INDEX "idx_atribuye_memberships_org" ON "public"."atribuye_memberships" USING "btree" ("organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_atribuye_memberships_org_role" ON "public"."atribuye_memberships" USING "btree" ("organization_id", "role") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "idx_atribuye_memberships_unique_active" ON "public"."atribuye_memberships" USING "btree" ("user_id", "organization_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_atribuye_memberships_user" ON "public"."atribuye_memberships" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_atribuye_meta_connections_dataset" ON "public"."atribuye_meta_connections" USING "btree" ("dataset_id");



CREATE INDEX "idx_atribuye_meta_connections_org" ON "public"."atribuye_meta_connections" USING "btree" ("organization_id");



CREATE INDEX "idx_atribuye_notifications_org_type" ON "public"."atribuye_notifications" USING "btree" ("organization_id", "type");



CREATE INDEX "idx_atribuye_notifications_user_read" ON "public"."atribuye_notifications" USING "btree" ("user_id", "read_at", "created_at" DESC);



CREATE INDEX "idx_atribuye_organizations_active" ON "public"."atribuye_organizations" USING "btree" ("id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_atribuye_organizations_billing" ON "public"."atribuye_organizations" USING "btree" ("billing_status", "trial_ends_at");



CREATE INDEX "idx_atribuye_organizations_slug" ON "public"."atribuye_organizations" USING "btree" ("slug");



CREATE INDEX "idx_atribuye_user_events_anon_occurred" ON "public"."atribuye_user_events" USING "btree" ("anonymous_id", "occurred_at" DESC) WHERE ("anonymous_id" IS NOT NULL);



CREATE INDEX "idx_atribuye_user_events_name_category" ON "public"."atribuye_user_events" USING "btree" ("event_name", "event_category");



CREATE INDEX "idx_atribuye_user_events_org_occurred" ON "public"."atribuye_user_events" USING "btree" ("organization_id", "occurred_at" DESC);



CREATE INDEX "idx_atribuye_user_events_session" ON "public"."atribuye_user_events" USING "btree" ("session_id", "occurred_at" DESC) WHERE ("session_id" IS NOT NULL);



CREATE INDEX "idx_atribuye_user_events_user_occurred" ON "public"."atribuye_user_events" USING "btree" ("user_id", "occurred_at" DESC);



CREATE INDEX "idx_atribuye_users_email" ON "public"."atribuye_users" USING "btree" ("email");



CREATE INDEX "idx_checklist_items_org" ON "public"."stage_checklist_items" USING "btree" ("organization_id");



CREATE INDEX "idx_checklist_items_stage" ON "public"."stage_checklist_items" USING "btree" ("funnel_stage_id", "active", "sort_order");



CREATE UNIQUE INDEX "idx_checklist_items_unique" ON "public"."stage_checklist_items" USING "btree" ("funnel_stage_id", "label") WHERE ("active" = true);



CREATE INDEX "idx_descalification_org" ON "public"."descalification_categories" USING "btree" ("organization_id", "active");



CREATE INDEX "idx_funnel_stages_org" ON "public"."funnel_stages" USING "btree" ("organization_id", "order_index");



CREATE INDEX "idx_invitations_org" ON "public"."invitations" USING "btree" ("organization_id", "accepted_at");



CREATE INDEX "idx_invitations_token" ON "public"."invitations" USING "btree" ("token");



CREATE INDEX "idx_jobs_org_status" ON "public"."background_jobs" USING "btree" ("organization_id", "status");



CREATE INDEX "idx_jobs_polling" ON "public"."background_jobs" USING "btree" ("status", "priority" DESC, "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_jobs_stale" ON "public"."background_jobs" USING "btree" ("processing_started_at") WHERE ("status" = 'processing'::"text");



CREATE INDEX "idx_jobs_status" ON "public"."analysis_jobs" USING "btree" ("organization_id", "status");



CREATE INDEX "idx_jobs_user" ON "public"."analysis_jobs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_lead_quality_criteria_org" ON "public"."lead_quality_criteria" USING "btree" ("organization_id");



CREATE INDEX "idx_lead_quality_criteria_scorecard" ON "public"."lead_quality_criteria" USING "btree" ("scorecard_id");



CREATE INDEX "idx_lead_sources_org" ON "public"."lead_sources" USING "btree" ("organization_id", "active");



CREATE INDEX "idx_objectives_org" ON "public"."objectives" USING "btree" ("organization_id", "is_active");



CREATE INDEX "idx_objectives_user" ON "public"."objectives" USING "btree" ("target_user_id", "is_active");



CREATE INDEX "idx_organizations_slug" ON "public"."organizations" USING "btree" ("slug");



CREATE INDEX "idx_phases_analysis" ON "public"."analysis_phases" USING "btree" ("analysis_id");



CREATE INDEX "idx_phases_org_phase" ON "public"."analysis_phases" USING "btree" ("organization_id", "phase_id");



CREATE INDEX "idx_phases_user_phase" ON "public"."analysis_phases" USING "btree" ("organization_id", "user_id", "phase_id", "created_at" DESC);



CREATE INDEX "idx_primary_category" ON "public"."analyses" USING "btree" ((("categoria_descalificacion" ->> 0))) WHERE (("categoria_descalificacion" IS NOT NULL) AND ("jsonb_typeof"("categoria_descalificacion") = 'array'::"text") AND ("jsonb_array_length"("categoria_descalificacion") > 0));



CREATE INDEX "idx_progress_date" ON "public"."objective_progress" USING "btree" ("objective_id", "snapshot_date" DESC);



CREATE INDEX "idx_progress_org" ON "public"."objective_progress" USING "btree" ("organization_id", "snapshot_date" DESC);



CREATE INDEX "idx_reports_org_tipo" ON "public"."reports" USING "btree" ("organization_id", "destinatario_tipo", "created_at" DESC);



CREATE INDEX "idx_scorecards_org" ON "public"."scorecards" USING "btree" ("organization_id", "active");



CREATE UNIQUE INDEX "idx_speech_published" ON "public"."speech_versions" USING "btree" ("organization_id", "scorecard_id", COALESCE("funnel_stage_id", '00000000-0000-0000-0000-000000000000'::"uuid")) WHERE ("published" = true);



CREATE INDEX "idx_tracker_overrides_org" ON "public"."tracker_org_overrides" USING "btree" ("organization_id");



CREATE UNIQUE INDEX "idx_trackers_global_code" ON "public"."conversation_trackers" USING "btree" ("code") WHERE ("organization_id" IS NULL);



CREATE INDEX "idx_trackers_org_active" ON "public"."conversation_trackers" USING "btree" ("organization_id", "active", "sort_order");



CREATE UNIQUE INDEX "idx_trackers_org_code" ON "public"."conversation_trackers" USING "btree" ("organization_id", "code") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "idx_transcript_edits_job" ON "public"."transcript_edits" USING "btree" ("analysis_job_id", "created_at" DESC);



CREATE INDEX "idx_transcript_edits_user" ON "public"."transcript_edits" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_users_org" ON "public"."users" USING "btree" ("organization_id", "active");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("organization_id", "role");



CREATE INDEX "idx_users_roles" ON "public"."users" USING "gin" ("roles");



CREATE OR REPLACE TRIGGER "analyses_increment_count" AFTER INSERT ON "public"."analyses" FOR EACH ROW EXECUTE FUNCTION "public"."increment_analyses_count_trigger"();



CREATE OR REPLACE TRIGGER "invitations_sync_role_roles" BEFORE UPDATE ON "public"."invitations" FOR EACH ROW EXECUTE FUNCTION "public"."sync_users_role_roles"();



CREATE OR REPLACE TRIGGER "trg_atribuye_conversions_updated_at" BEFORE UPDATE ON "public"."atribuye_conversions" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_crm_connections_updated_at" BEFORE UPDATE ON "public"."atribuye_crm_connections" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_csv_uploads_updated_at" BEFORE UPDATE ON "public"."atribuye_csv_uploads" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_events_updated_at" BEFORE UPDATE ON "public"."atribuye_events" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_lfpdppp_requests_updated_at" BEFORE UPDATE ON "public"."atribuye_lfpdppp_requests" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_memberships_updated_at" BEFORE UPDATE ON "public"."atribuye_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_meta_connections_updated_at" BEFORE UPDATE ON "public"."atribuye_meta_connections" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_notifications_updated_at" BEFORE UPDATE ON "public"."atribuye_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_organizations_updated_at" BEFORE UPDATE ON "public"."atribuye_organizations" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atribuye_users_updated_at" BEFORE UPDATE ON "public"."atribuye_users" FOR EACH ROW EXECUTE FUNCTION "public"."atribuye_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_background_jobs_updated_at" BEFORE UPDATE ON "public"."background_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "users_sync_role_roles" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."sync_users_role_roles"();



ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_fuente_lead_id_fkey" FOREIGN KEY ("fuente_lead_id") REFERENCES "public"."lead_sources"("id");



ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_background_job_id_fkey" FOREIGN KEY ("background_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_fuente_lead_id_fkey" FOREIGN KEY ("fuente_lead_id") REFERENCES "public"."lead_sources"("id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_funnel_stage_id_fkey" FOREIGN KEY ("funnel_stage_id") REFERENCES "public"."funnel_stages"("id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_related_analysis_id_fkey" FOREIGN KEY ("related_analysis_id") REFERENCES "public"."analyses"("id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_scorecard_id_fkey" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id");



ALTER TABLE ONLY "public"."analyses"
    ADD CONSTRAINT "analyses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."analysis_jobs"
    ADD CONSTRAINT "analysis_jobs_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id");



ALTER TABLE ONLY "public"."analysis_jobs"
    ADD CONSTRAINT "analysis_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."analysis_jobs"
    ADD CONSTRAINT "analysis_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."analysis_phases"
    ADD CONSTRAINT "analysis_phases_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id");



ALTER TABLE ONLY "public"."analysis_phases"
    ADD CONSTRAINT "analysis_phases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."analysis_phases"
    ADD CONSTRAINT "analysis_phases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."atribuye_attribution_events"
    ADD CONSTRAINT "atribuye_attribution_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."atribuye_attribution_events"
    ADD CONSTRAINT "atribuye_attribution_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."atribuye_audit_log"
    ADD CONSTRAINT "atribuye_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."atribuye_audit_log"
    ADD CONSTRAINT "atribuye_audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_conversions"
    ADD CONSTRAINT "atribuye_conversions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."atribuye_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."atribuye_conversions"
    ADD CONSTRAINT "atribuye_conversions_crm_connection_id_fkey" FOREIGN KEY ("crm_connection_id") REFERENCES "public"."atribuye_crm_connections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."atribuye_conversions"
    ADD CONSTRAINT "atribuye_conversions_csv_upload_id_fkey" FOREIGN KEY ("csv_upload_id") REFERENCES "public"."atribuye_csv_uploads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."atribuye_conversions"
    ADD CONSTRAINT "atribuye_conversions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_crm_connections"
    ADD CONSTRAINT "atribuye_crm_connections_api_key_secret_id_fkey" FOREIGN KEY ("api_key_secret_id") REFERENCES "vault"."secrets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."atribuye_crm_connections"
    ADD CONSTRAINT "atribuye_crm_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_csv_uploads"
    ADD CONSTRAINT "atribuye_csv_uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_csv_uploads"
    ADD CONSTRAINT "atribuye_csv_uploads_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."atribuye_events"
    ADD CONSTRAINT "atribuye_events_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "public"."atribuye_conversions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_events"
    ADD CONSTRAINT "atribuye_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_invitations"
    ADD CONSTRAINT "atribuye_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."atribuye_invitations"
    ADD CONSTRAINT "atribuye_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."atribuye_invitations"
    ADD CONSTRAINT "atribuye_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_lfpdppp_requests"
    ADD CONSTRAINT "atribuye_lfpdppp_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_memberships"
    ADD CONSTRAINT "atribuye_memberships_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."atribuye_memberships"
    ADD CONSTRAINT "atribuye_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_memberships"
    ADD CONSTRAINT "atribuye_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_meta_connections"
    ADD CONSTRAINT "atribuye_meta_connections_access_token_secret_id_fkey" FOREIGN KEY ("access_token_secret_id") REFERENCES "vault"."secrets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."atribuye_meta_connections"
    ADD CONSTRAINT "atribuye_meta_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_notifications"
    ADD CONSTRAINT "atribuye_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_notifications"
    ADD CONSTRAINT "atribuye_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_user_events"
    ADD CONSTRAINT "atribuye_user_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."atribuye_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atribuye_user_events"
    ADD CONSTRAINT "atribuye_user_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."atribuye_users"
    ADD CONSTRAINT "atribuye_users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."background_jobs"
    ADD CONSTRAINT "background_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."background_jobs"
    ADD CONSTRAINT "background_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."conversation_trackers"
    ADD CONSTRAINT "conversation_trackers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."descalification_categories"
    ADD CONSTRAINT "descalification_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."funnel_config"
    ADD CONSTRAINT "funnel_config_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."funnel_stages"
    ADD CONSTRAINT "funnel_stages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."funnel_stages"
    ADD CONSTRAINT "funnel_stages_scorecard_id_fkey" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."lead_quality_criteria"
    ADD CONSTRAINT "lead_quality_criteria_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_quality_criteria"
    ADD CONSTRAINT "lead_quality_criteria_scorecard_id_fkey" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."objective_progress"
    ADD CONSTRAINT "objective_progress_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id");



ALTER TABLE ONLY "public"."objective_progress"
    ADD CONSTRAINT "objective_progress_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."objectives"
    ADD CONSTRAINT "objectives_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."objectives"
    ADD CONSTRAINT "objectives_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."scorecards"
    ADD CONSTRAINT "scorecards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."scorecards"
    ADD CONSTRAINT "scorecards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."scorecards"
    ADD CONSTRAINT "scorecards_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."scorecard_templates"("id");



ALTER TABLE ONLY "public"."speech_versions"
    ADD CONSTRAINT "speech_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."speech_versions"
    ADD CONSTRAINT "speech_versions_funnel_stage_id_fkey" FOREIGN KEY ("funnel_stage_id") REFERENCES "public"."funnel_stages"("id");



ALTER TABLE ONLY "public"."speech_versions"
    ADD CONSTRAINT "speech_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."speech_versions"
    ADD CONSTRAINT "speech_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."speech_versions"
    ADD CONSTRAINT "speech_versions_scorecard_id_fkey" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id");



ALTER TABLE ONLY "public"."stage_checklist_items"
    ADD CONSTRAINT "stage_checklist_items_funnel_stage_id_fkey" FOREIGN KEY ("funnel_stage_id") REFERENCES "public"."funnel_stages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stage_checklist_items"
    ADD CONSTRAINT "stage_checklist_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."tracker_org_overrides"
    ADD CONSTRAINT "tracker_org_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tracker_org_overrides"
    ADD CONSTRAINT "tracker_org_overrides_tracker_id_fkey" FOREIGN KEY ("tracker_id") REFERENCES "public"."conversation_trackers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transcript_edits"
    ADD CONSTRAINT "transcript_edits_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transcript_edits"
    ADD CONSTRAINT "transcript_edits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."_legacy_user_organizations"
    ADD CONSTRAINT "user_organizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."_legacy_user_organizations"
    ADD CONSTRAINT "user_organizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."xp_events"
    ADD CONSTRAINT "xp_events_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id");



ALTER TABLE ONLY "public"."xp_events"
    ADD CONSTRAINT "xp_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE "public"."_legacy_user_organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alerts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alerts_org" ON "public"."alerts" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."analyses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analyses_insert" ON "public"."analyses" FOR INSERT WITH CHECK (("organization_id" = "public"."get_user_org_id"()));



CREATE POLICY "analyses_org" ON "public"."analyses" FOR SELECT USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "analyses_update" ON "public"."analyses" FOR UPDATE USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."analysis_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analysis_jobs_delete" ON "public"."analysis_jobs" FOR DELETE USING (('super_admin'::"text" = ANY ("public"."get_user_roles"())));



CREATE POLICY "analysis_jobs_insert" ON "public"."analysis_jobs" FOR INSERT WITH CHECK ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "analysis_jobs_select" ON "public"."analysis_jobs" FOR SELECT USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "analysis_jobs_update" ON "public"."analysis_jobs" FOR UPDATE USING (
CASE
    WHEN ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]) THEN ("organization_id" = "public"."get_user_org_id"())
    ELSE ("user_id" = "auth"."uid"())
END);



ALTER TABLE "public"."analysis_phases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analysis_phases_org" ON "public"."analysis_phases" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."atribuye_attribution_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_attribution_events_select_org" ON "public"."atribuye_attribution_events" FOR SELECT USING (("organization_id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL) AND ("atribuye_memberships"."role" = ANY (ARRAY['org_owner'::"public"."atribuye_role", 'org_admin'::"public"."atribuye_role"]))))));



CREATE POLICY "atribuye_attribution_events_select_super_admin" ON "public"."atribuye_attribution_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL) AND ("atribuye_memberships"."role" = 'super_admin'::"public"."atribuye_role")))));



ALTER TABLE "public"."atribuye_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_audit_log_insert_admin" ON "public"."atribuye_audit_log" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_audit_log_select_owner" ON "public"."atribuye_audit_log" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_owner_org_ids"() AS "atribuye_user_owner_org_ids")));



ALTER TABLE "public"."atribuye_conversions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_conversions_delete_admin" ON "public"."atribuye_conversions" FOR DELETE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_conversions_delete_member" ON "public"."atribuye_conversions" FOR DELETE TO "authenticated" USING ((("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")) AND ("created_by_user_id" = "auth"."uid"())));



CREATE POLICY "atribuye_conversions_insert" ON "public"."atribuye_conversions" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



CREATE POLICY "atribuye_conversions_select" ON "public"."atribuye_conversions" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



CREATE POLICY "atribuye_conversions_update" ON "public"."atribuye_conversions" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids"))) WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



ALTER TABLE "public"."atribuye_crm_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_crm_connections_delete_admin" ON "public"."atribuye_crm_connections" FOR DELETE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_crm_connections_insert_admin" ON "public"."atribuye_crm_connections" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_crm_connections_select" ON "public"."atribuye_crm_connections" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



CREATE POLICY "atribuye_crm_connections_update_admin" ON "public"."atribuye_crm_connections" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids"))) WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



ALTER TABLE "public"."atribuye_csv_uploads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_csv_uploads_insert" ON "public"."atribuye_csv_uploads" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



CREATE POLICY "atribuye_csv_uploads_select" ON "public"."atribuye_csv_uploads" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



CREATE POLICY "atribuye_csv_uploads_update_admin" ON "public"."atribuye_csv_uploads" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids"))) WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_csv_uploads_update_uploader" ON "public"."atribuye_csv_uploads" FOR UPDATE TO "authenticated" USING ((("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")) AND ("uploaded_by_user_id" = "auth"."uid"()))) WITH CHECK ((("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")) AND ("uploaded_by_user_id" = "auth"."uid"())));



ALTER TABLE "public"."atribuye_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_events_insert_admin" ON "public"."atribuye_events" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_events_select" ON "public"."atribuye_events" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



CREATE POLICY "atribuye_events_update_admin" ON "public"."atribuye_events" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids"))) WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



ALTER TABLE "public"."atribuye_invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_invitations_delete" ON "public"."atribuye_invitations" FOR DELETE USING ((("invited_by_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."organization_id" = "atribuye_invitations"."organization_id") AND ("atribuye_memberships"."role" = 'super_admin'::"public"."atribuye_role") AND ("atribuye_memberships"."deleted_at" IS NULL))))));



CREATE POLICY "atribuye_invitations_insert" ON "public"."atribuye_invitations" FOR INSERT WITH CHECK (("organization_id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL) AND ("atribuye_memberships"."role" = ANY (ARRAY['super_admin'::"public"."atribuye_role", 'org_owner'::"public"."atribuye_role", 'org_admin'::"public"."atribuye_role"]))))));



CREATE POLICY "atribuye_invitations_select" ON "public"."atribuye_invitations" FOR SELECT USING (("organization_id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL) AND ("atribuye_memberships"."role" = ANY (ARRAY['super_admin'::"public"."atribuye_role", 'org_owner'::"public"."atribuye_role", 'org_admin'::"public"."atribuye_role"]))))));



ALTER TABLE "public"."atribuye_lfpdppp_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_lfpdppp_requests_insert_admin" ON "public"."atribuye_lfpdppp_requests" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_lfpdppp_requests_select_admin" ON "public"."atribuye_lfpdppp_requests" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_lfpdppp_requests_update_admin" ON "public"."atribuye_lfpdppp_requests" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids"))) WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



ALTER TABLE "public"."atribuye_memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_memberships_select" ON "public"."atribuye_memberships" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids"))));



CREATE POLICY "atribuye_memberships_update" ON "public"."atribuye_memberships" FOR UPDATE USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



ALTER TABLE "public"."atribuye_meta_connections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_meta_connections_delete_admin" ON "public"."atribuye_meta_connections" FOR DELETE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_meta_connections_insert_admin" ON "public"."atribuye_meta_connections" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



CREATE POLICY "atribuye_meta_connections_select" ON "public"."atribuye_meta_connections" FOR SELECT TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_org_ids"() AS "atribuye_user_org_ids")));



CREATE POLICY "atribuye_meta_connections_update_admin" ON "public"."atribuye_meta_connections" FOR UPDATE TO "authenticated" USING (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids"))) WITH CHECK (("organization_id" IN ( SELECT "public"."atribuye_user_admin_org_ids"() AS "atribuye_user_admin_org_ids")));



ALTER TABLE "public"."atribuye_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_notifications_select" ON "public"."atribuye_notifications" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (("user_id" IS NULL) AND ("organization_id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL)))))));



CREATE POLICY "atribuye_notifications_update_read" ON "public"."atribuye_notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."atribuye_organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_organizations_delete" ON "public"."atribuye_organizations" FOR DELETE USING (("id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL) AND ("atribuye_memberships"."role" = ANY (ARRAY['super_admin'::"public"."atribuye_role", 'org_owner'::"public"."atribuye_role"]))))));



CREATE POLICY "atribuye_organizations_select" ON "public"."atribuye_organizations" FOR SELECT USING (("id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL)))));



CREATE POLICY "atribuye_organizations_update" ON "public"."atribuye_organizations" FOR UPDATE USING (("id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL) AND ("atribuye_memberships"."role" = ANY (ARRAY['super_admin'::"public"."atribuye_role", 'org_owner'::"public"."atribuye_role", 'org_admin'::"public"."atribuye_role"]))))));



ALTER TABLE "public"."atribuye_system_health" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."atribuye_user_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_user_events_select" ON "public"."atribuye_user_events" FOR SELECT USING ((("organization_id" IS NULL) OR ("organization_id" IN ( SELECT "atribuye_memberships"."organization_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."user_id" = "auth"."uid"()) AND ("atribuye_memberships"."deleted_at" IS NULL) AND ("atribuye_memberships"."role" = ANY (ARRAY['super_admin'::"public"."atribuye_role", 'org_owner'::"public"."atribuye_role", 'org_admin'::"public"."atribuye_role"])))))));



ALTER TABLE "public"."atribuye_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "atribuye_users_select_org_members" ON "public"."atribuye_users" FOR SELECT USING (("id" IN ( SELECT "atribuye_memberships"."user_id"
   FROM "public"."atribuye_memberships"
  WHERE (("atribuye_memberships"."organization_id" IN ( SELECT "atribuye_memberships_1"."organization_id"
           FROM "public"."atribuye_memberships" "atribuye_memberships_1"
          WHERE (("atribuye_memberships_1"."user_id" = "auth"."uid"()) AND ("atribuye_memberships_1"."deleted_at" IS NULL)))) AND ("atribuye_memberships"."deleted_at" IS NULL)))));



CREATE POLICY "atribuye_users_select_self" ON "public"."atribuye_users" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "atribuye_users_update_self" ON "public"."atribuye_users" FOR UPDATE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."background_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "background_jobs_delete" ON "public"."background_jobs" FOR DELETE USING (('super_admin'::"text" = ANY ("public"."get_user_roles"())));



CREATE POLICY "background_jobs_insert" ON "public"."background_jobs" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("organization_id" = "public"."get_user_org_id"())));



CREATE POLICY "background_jobs_select" ON "public"."background_jobs" FOR SELECT USING (
CASE
    WHEN ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]) THEN ("organization_id" = "public"."get_user_org_id"())
    ELSE ("user_id" = "auth"."uid"())
END);



ALTER TABLE "public"."badges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "badges_select" ON "public"."badges" FOR SELECT USING ((("organization_id" IS NULL) OR ("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."conversation_trackers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_trackers_delete" ON "public"."conversation_trackers" FOR DELETE USING (('super_admin'::"text" = ANY ("public"."get_user_roles"())));



CREATE POLICY "conversation_trackers_insert" ON "public"."conversation_trackers" FOR INSERT WITH CHECK (('super_admin'::"text" = ANY ("public"."get_user_roles"())));



CREATE POLICY "conversation_trackers_select" ON "public"."conversation_trackers" FOR SELECT USING ((("organization_id" IS NULL) OR ("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "conversation_trackers_update" ON "public"."conversation_trackers" FOR UPDATE USING (('super_admin'::"text" = ANY ("public"."get_user_roles"())));



ALTER TABLE "public"."descalification_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "descalification_categories_org" ON "public"."descalification_categories" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."funnel_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "funnel_config_org" ON "public"."funnel_config" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."funnel_stages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "funnel_stages_org" ON "public"."funnel_stages" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_org" ON "public"."invitations" USING ((("organization_id" = "public"."get_user_org_id"()) AND ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'super_admin'::"text"])));



ALTER TABLE "public"."lead_quality_criteria" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_sources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_sources_org" ON "public"."lead_sources" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "managers_write_tracker_overrides" ON "public"."tracker_org_overrides" USING (("organization_id" IN ( SELECT "users"."organization_id"
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['gerente'::"text", 'direccion'::"text", 'super_admin'::"text"]))))));



ALTER TABLE "public"."objective_progress" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "objective_progress_org" ON "public"."objective_progress" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."objectives" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "objectives_manage" ON "public"."objectives" USING ((("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'super_admin'::"text"]) AND (("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"())))));



CREATE POLICY "objectives_select" ON "public"."objectives" FOR SELECT USING (
CASE
    WHEN ('super_admin'::"text" = ANY ("public"."get_user_roles"())) THEN true
    WHEN (('captadora'::"text" = ANY ("public"."get_user_roles"())) AND (NOT ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]))) THEN (("organization_id" = "public"."get_user_org_id"()) AND (("target_user_id" = "auth"."uid"()) OR ("target_user_id" IS NULL)))
    ELSE ("organization_id" = "public"."get_user_org_id"())
END);



CREATE POLICY "org_members_read_tracker_overrides" ON "public"."tracker_org_overrides" FOR SELECT USING (("organization_id" IN ( SELECT "users"."organization_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reports_org" ON "public"."reports" FOR SELECT USING (((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))) AND (("destinatario_tipo" = 'todos'::"text") OR (('agencia'::"text" = ANY ("public"."get_user_roles"())) AND ("destinatario_tipo" = 'agencia'::"text")) OR (('direccion'::"text" = ANY ("public"."get_user_roles"())) AND ("destinatario_tipo" = ANY (ARRAY['direccion'::"text", 'equipo'::"text"]))) OR (('gerente'::"text" = ANY ("public"."get_user_roles"())) AND ("destinatario_tipo" = 'equipo'::"text")) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"())))));



ALTER TABLE "public"."scorecard_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scorecard_templates_modify" ON "public"."scorecard_templates" USING (('super_admin'::"text" = ANY ("public"."get_user_roles"()))) WITH CHECK (('super_admin'::"text" = ANY ("public"."get_user_roles"())));



CREATE POLICY "scorecard_templates_select" ON "public"."scorecard_templates" FOR SELECT USING (('super_admin'::"text" = ANY ("public"."get_user_roles"())));



ALTER TABLE "public"."scorecards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scorecards_modify_global" ON "public"."scorecards" USING (
CASE
    WHEN ("organization_id" IS NULL) THEN ('super_admin'::"text" = ANY ("public"."get_user_roles"()))
    ELSE ("organization_id" = "public"."get_user_org_id"())
END);



CREATE POLICY "scorecards_select" ON "public"."scorecards" FOR SELECT USING ((("organization_id" IS NULL) OR ("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."speech_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "speech_versions_org" ON "public"."speech_versions" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."stage_checklist_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stage_checklist_items_delete" ON "public"."stage_checklist_items" FOR DELETE USING (((("organization_id" = "public"."get_user_org_id"()) AND ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text"])) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "stage_checklist_items_insert" ON "public"."stage_checklist_items" FOR INSERT WITH CHECK (((("organization_id" = "public"."get_user_org_id"()) AND ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text"])) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "stage_checklist_items_select" ON "public"."stage_checklist_items" FOR SELECT USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



CREATE POLICY "stage_checklist_items_update" ON "public"."stage_checklist_items" FOR UPDATE USING (((("organization_id" = "public"."get_user_org_id"()) AND ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text"])) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracker_org_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transcript_edits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transcript_edits_insert" ON "public"."transcript_edits" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "transcript_edits_select" ON "public"."transcript_edits" FOR SELECT USING (
CASE
    WHEN ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'agencia'::"text", 'super_admin'::"text"]) THEN (EXISTS ( SELECT 1
       FROM "public"."analysis_jobs" "aj"
      WHERE (("aj"."id" = "transcript_edits"."analysis_job_id") AND ("aj"."organization_id" = "public"."get_user_org_id"()))))
    ELSE ("user_id" = "auth"."uid"())
END);



ALTER TABLE "public"."user_badges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_badges_select" ON "public"."user_badges" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'super_admin'::"text"])));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING (
CASE
    WHEN ('super_admin'::"text" = ANY ("public"."get_user_roles"())) THEN true
    WHEN ("public"."get_user_roles"() && ARRAY['gerente'::"text", 'direccion'::"text", 'agencia'::"text"]) THEN ("organization_id" = "public"."get_user_org_id"())
    ELSE ("id" = "auth"."uid"())
END);



CREATE POLICY "users_view_own_org" ON "public"."organizations" FOR SELECT USING ((("id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



ALTER TABLE "public"."xp_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "xp_events_org" ON "public"."xp_events" USING ((("organization_id" = "public"."get_user_org_id"()) OR ('super_admin'::"text" = ANY ("public"."get_user_roles"()))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_accept_invitation"("p_token_hash" "text", "p_user_id" "uuid", "p_user_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_accept_invitation"("p_token_hash" "text", "p_user_id" "uuid", "p_user_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_accept_invitation"("p_token_hash" "text", "p_user_id" "uuid", "p_user_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_compute_event_id"("p_phone" "text", "p_event_type" "text", "p_event_time" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_compute_event_id"("p_phone" "text", "p_event_type" "text", "p_event_time" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_compute_event_id"("p_phone" "text", "p_event_type" "text", "p_event_time" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_current_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_current_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_current_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_lfpdppp_hard_delete"("p_organization_id" "uuid", "p_phone_hash" "text", "p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_lfpdppp_hard_delete"("p_organization_id" "uuid", "p_phone_hash" "text", "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_lfpdppp_hard_delete"("p_organization_id" "uuid", "p_phone_hash" "text", "p_request_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_user_admin_org_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_user_admin_org_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_user_admin_org_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_user_org_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_user_org_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_user_org_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."atribuye_user_owner_org_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."atribuye_user_owner_org_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."atribuye_user_owner_org_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_increment_analysis_count"("org_id" "uuid", "tier_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_increment_analysis_count"("org_id" "uuid", "tier_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_increment_analysis_count"("org_id" "uuid", "tier_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."background_jobs" TO "anon";
GRANT ALL ON TABLE "public"."background_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."background_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_jobs"("p_limit" integer, "p_worker_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_jobs"("p_limit" integer, "p_worker_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_grace_periods"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_grace_periods"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_grace_periods"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_starter_orgs"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_starter_orgs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_starter_orgs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_org_quota"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_org_quota"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_org_quota"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_analyses_count_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_analyses_count_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_analyses_count_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_monthly_analysis_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."reset_monthly_analysis_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_monthly_analysis_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_grace_period"("p_stripe_customer_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_grace_period"("p_stripe_customer_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_grace_period"("p_stripe_customer_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."start_grace_period"("p_stripe_customer_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."start_grace_period"("p_stripe_customer_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_grace_period"("p_stripe_customer_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_users_role_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_users_role_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_users_role_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upgrade_org_plan"("p_stripe_customer_id" "text", "p_plan" "text", "p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."upgrade_org_plan"("p_stripe_customer_id" "text", "p_plan" "text", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upgrade_org_plan"("p_stripe_customer_id" "text", "p_plan" "text", "p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_scorecard_phases_schema"("phases" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_scorecard_phases_schema"("phases" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_scorecard_phases_schema"("phases" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."_legacy_user_organizations" TO "anon";
GRANT ALL ON TABLE "public"."_legacy_user_organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."_legacy_user_organizations" TO "service_role";



GRANT ALL ON TABLE "public"."alerts" TO "anon";
GRANT ALL ON TABLE "public"."alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."alerts" TO "service_role";



GRANT ALL ON TABLE "public"."analyses" TO "anon";
GRANT ALL ON TABLE "public"."analyses" TO "authenticated";
GRANT ALL ON TABLE "public"."analyses" TO "service_role";



GRANT ALL ON TABLE "public"."analysis_jobs" TO "anon";
GRANT ALL ON TABLE "public"."analysis_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."analysis_phases" TO "anon";
GRANT ALL ON TABLE "public"."analysis_phases" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_phases" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_attribution_events" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_attribution_events" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_attribution_events" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_conversions" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_conversions" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_conversions" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_crm_connections" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_crm_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_crm_connections" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_csv_uploads" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_csv_uploads" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_csv_uploads" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_events" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_events" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_events" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_invitations" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_lfpdppp_requests" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_lfpdppp_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_lfpdppp_requests" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_memberships" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_meta_connections" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_meta_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_meta_connections" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_notifications" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_organizations" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_organizations" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_system_health" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_system_health" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_system_health" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_user_events" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_user_events" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_user_events" TO "service_role";



GRANT ALL ON TABLE "public"."atribuye_users" TO "anon";
GRANT ALL ON TABLE "public"."atribuye_users" TO "authenticated";
GRANT ALL ON TABLE "public"."atribuye_users" TO "service_role";



GRANT ALL ON TABLE "public"."badges" TO "anon";
GRANT ALL ON TABLE "public"."badges" TO "authenticated";
GRANT ALL ON TABLE "public"."badges" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_trackers" TO "anon";
GRANT ALL ON TABLE "public"."conversation_trackers" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_trackers" TO "service_role";



GRANT ALL ON TABLE "public"."descalification_categories" TO "anon";
GRANT ALL ON TABLE "public"."descalification_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."descalification_categories" TO "service_role";



GRANT ALL ON TABLE "public"."funnel_config" TO "anon";
GRANT ALL ON TABLE "public"."funnel_config" TO "authenticated";
GRANT ALL ON TABLE "public"."funnel_config" TO "service_role";



GRANT ALL ON TABLE "public"."funnel_stages" TO "anon";
GRANT ALL ON TABLE "public"."funnel_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."funnel_stages" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."lead_quality_criteria" TO "anon";
GRANT ALL ON TABLE "public"."lead_quality_criteria" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_quality_criteria" TO "service_role";



GRANT ALL ON TABLE "public"."lead_sources" TO "anon";
GRANT ALL ON TABLE "public"."lead_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_sources" TO "service_role";



GRANT ALL ON TABLE "public"."objective_progress" TO "anon";
GRANT ALL ON TABLE "public"."objective_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."objective_progress" TO "service_role";



GRANT ALL ON TABLE "public"."objectives" TO "anon";
GRANT ALL ON TABLE "public"."objectives" TO "authenticated";
GRANT ALL ON TABLE "public"."objectives" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT SELECT("vambe_api_key") ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."scorecard_templates" TO "anon";
GRANT ALL ON TABLE "public"."scorecard_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."scorecard_templates" TO "service_role";



GRANT ALL ON TABLE "public"."scorecards" TO "anon";
GRANT ALL ON TABLE "public"."scorecards" TO "authenticated";
GRANT ALL ON TABLE "public"."scorecards" TO "service_role";



GRANT ALL ON TABLE "public"."speech_versions" TO "anon";
GRANT ALL ON TABLE "public"."speech_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."speech_versions" TO "service_role";



GRANT ALL ON TABLE "public"."stage_checklist_items" TO "anon";
GRANT ALL ON TABLE "public"."stage_checklist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."stage_checklist_items" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";



GRANT ALL ON TABLE "public"."tracker_org_overrides" TO "anon";
GRANT ALL ON TABLE "public"."tracker_org_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."tracker_org_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."transcript_edits" TO "anon";
GRANT ALL ON TABLE "public"."transcript_edits" TO "authenticated";
GRANT ALL ON TABLE "public"."transcript_edits" TO "service_role";



GRANT ALL ON TABLE "public"."user_badges" TO "anon";
GRANT ALL ON TABLE "public"."user_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."user_badges" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."xp_events" TO "anon";
GRANT ALL ON TABLE "public"."xp_events" TO "authenticated";
GRANT ALL ON TABLE "public"."xp_events" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







