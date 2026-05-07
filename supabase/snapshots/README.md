# Schema snapshots

Snapshots periódicos del schema `public` como source-of-truth alternativa cuando migrations se aplicaron vía Supabase MCP sin archivo individual en `supabase/migrations/`.

## Cómo regenerar

```
npx supabase db dump --linked --schema public -f supabase/snapshots/YYYY-MM-DD_full_schema.sql
```

## Última snapshot

`2026-05-06_full_schema.sql`

## ⚠️ DB cross-project: aurisiq + atribuye comparten schema public

Decisión consciente al 2026-05-06: el project ref `ekvvsosbwkfyhawywgpn` aloja **dos productos** en el mismo schema `public`:

- **AurisIQ** (este repo): tablas sin prefijo (`analyses`, `users`, `organizations`, `background_jobs`, `funnel_stages`, `scorecards`, etc.)
- **Atribuye** (Optix-loops, repo separado): tablas con prefijo `atribuye_*`

Razón: evitar duplicar costo de Supabase Pro mientras Atribuye no justifica project ref propio.

### Implicaciones

- El snapshot incluye legítimamente las ~16 tablas `atribuye_*` y sus migrations en `supabase_migrations.schema_migrations`. NO son basura.
- Ambos productos comparten `auth.users` (un solo pool de usuarios) y `supabase_migrations.schema_migrations`.
- Cualquier migration debe ser cuidadosa con tablas del otro producto. NUNCA usar `DROP TABLE` o `ALTER TABLE` sin prefix-check explícito.
- RLS policies deben ser estrictas — un policy mal escrita puede leakear datos del otro producto.

### Deuda sistémica agendada

Cuando Atribuye justifique project ref propio (volumen de uso, contratos enterprise, separación de PII por compliance), migrar `atribuye_*` a Supabase project independiente. No hay deadline al 2026-05-06.

## Delta documentado al 2026-05-06

~34 migrations aplicadas en DB no tienen archivo individual en `supabase/migrations/` (mezcla de migrations aurisiq aplicadas vía MCP + migrations atribuye aplicadas desde el otro repo). El snapshot las captura como estado consolidado.
