# Migrations drafts

Los 4 archivos Vambe en este directorio (030/031/033/034) son borradores. La versión real aplicada en DB difiere:

- Timestamps reales en `schema_migrations` distintos a los del filename local
- 033 tiene name diferente: `pg_cron_process_queue_schedule` (DB) vs `pg_cron_setup` (filename)
- 033 además contiene placeholder `<PASTE_SERVICE_ROLE_KEY_HERE>` no reemplazado

NO aplicar estos archivos tal cual. SoT del schema = `supabase/snapshots/2026-05-06_full_schema.sql`.
