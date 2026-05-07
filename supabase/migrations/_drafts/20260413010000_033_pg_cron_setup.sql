-- 033: pg_cron setup — invoke process-queue every 5 seconds
-- Prerequisites: pg_cron 1.6.4 and pg_net 0.20.0 already enabled

-- Store service role key in Vault for pg_cron HTTP calls
-- TODO: Replace <PASTE_SERVICE_ROLE_KEY_HERE> with actual service role key before applying
SELECT vault.create_secret(
  '<PASTE_SERVICE_ROLE_KEY_HERE>',
  'edge_function_service_role_key',
  'Service role key for pg_cron HTTP calls to Edge Functions'
);

-- Schedule process-queue every 5 seconds
SELECT cron.schedule(
  'aurisiq-process-queue',
  '5 seconds',
  $$
  SELECT net.http_post(
    url := 'https://ekvvsosbwkfyhawywgpn.supabase.co/functions/v1/process-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 3000
  );
  $$
);
