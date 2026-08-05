-- Crons semanal y mensual del digest — misma Edge Function daily-digest,
-- body con mode. Patrón idéntico a aurisiq-daily-digest (vault + net.http_post).
-- weekly:  lunes 13:35 UTC = 7:35 AM CDMX, semana lun–dom previa
-- monthly: día 1 13:40 UTC = 7:40 AM CDMX, mes anterior
-- Aplicada vía MCP con versión reconciliada a este archivo (regla forward 2026-05-06).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aurisiq-weekly-digest') THEN
    PERFORM cron.unschedule('aurisiq-weekly-digest');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aurisiq-monthly-digest') THEN
    PERFORM cron.unschedule('aurisiq-monthly-digest');
  END IF;
END $$;

SELECT cron.schedule(
  'aurisiq-weekly-digest',
  '35 13 * * 1',
  $cron$
  SELECT net.http_post(
    url := 'https://ekvvsosbwkfyhawywgpn.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"mode":"weekly"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

SELECT cron.schedule(
  'aurisiq-monthly-digest',
  '40 13 1 * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ekvvsosbwkfyhawywgpn.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"mode":"monthly"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
