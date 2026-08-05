-- aurisiq-daily-digest: cron diario que invoca la Edge Function daily-digest.
-- 13:30 UTC = 7:30 AM America/Mexico_City (México sin DST desde 2022 → fijo).
-- Patrón idéntico a aurisiq-process-queue: service key desde vault, net.http_post.
-- Kill switch del digest: vaciar SLACK_ALERT_WEBHOOK_URL en Edge secrets
-- (compartido con F21 a propósito — al rotar webhooks, separar en secret propio).
-- Aplicada vía MCP con versión reconciliada a este archivo (regla forward 2026-05-06).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aurisiq-daily-digest') THEN
    PERFORM cron.unschedule('aurisiq-daily-digest');
  END IF;
END $$;

SELECT cron.schedule(
  'aurisiq-daily-digest',
  '30 13 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://ekvvsosbwkfyhawywgpn.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
