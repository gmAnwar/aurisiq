# Migrations

## Estado al 2026-05-06

Parcialmente desincronizado vs DB. Para schema actual completo consultar `supabase/snapshots/2026-05-06_full_schema.sql`.

## ⚠️ Cross-project: leer antes de aplicar cualquier migration

El project ref `ekvvsosbwkfyhawywgpn` aloja AurisIQ + Atribuye en el mismo schema `public`. Detalles en `supabase/snapshots/README.md`.

Cuando escribas una migration nueva:
- NO usar `DROP TABLE` ni `ALTER TABLE` sin verificar que la tabla pertenece a AurisIQ (sin prefijo `atribuye_*`)
- Las RLS policies deben filtrar por organización aurisiq de forma estricta
- Si tocás `auth.users` o `supabase_migrations.schema_migrations`, el cambio afecta también a Atribuye

## Subdirectorio `_drafts/`

Borradores de migrations que se aplicaron a DB con SQL distinto vía MCP. NO aplicar tal cual. Mantener como referencia histórica.

## Regla forward (a partir 2026-05-06)

Cualquier migration FUTURA va con archivo `supabase/migrations/NNN_descriptive_name.sql` + aplicación coordinada. CLI o MCP son válidos, pero archivo y tabla `supabase_migrations.schema_migrations` deben matchear.
