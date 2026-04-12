# AurisIQ — Configuración Maestra Claude Code

## Qué es este proyecto
AurisIQ analiza conversaciones de ventas con IA para equipos comerciales.
Producto independiente de Optix. Repo: github.com/gmAnwar/aurisiq.
Stack: Vercel + Supabase Pro + Cloudflare Worker + AssemblyAI (Etapa 3).

## Regla de prioridad de fuentes
El canvas TÉCNICO (F0ALYPV5D16) es la fuente de verdad para todo lo técnico.
En caso de conflicto entre este CLAUDE.md y el TÉCNICO, el TÉCNICO tiene prioridad.

## Reglas de interpretación del TÉCNICO
- Si encuentras múltiples definiciones de la misma tabla o sección, usa SIEMPRE la más completa (la que tiene más campos).
- Antes de implementar cualquier función RPC, lee la sección "Gaps conocidos" del TÉCNICO — tiene correcciones al código del cuerpo principal.
- Si hay conflicto entre el cuerpo del TÉCNICO y la sección Gaps, la sección Gaps tiene prioridad.
- Si algo no está claro, pregunta antes de decidir. No implementes suposiciones silenciosas.

## Canvases de Slack — IDs fijos
- TÉCNICO: F0ALYPV5D16 — stack, schema, decisiones. FUENTE PRIMARIA.
- PENDIENTES: F0AL1FB4XAN — next steps activos
- SESIONES: F0ALHCSA449 — changelog de sesiones
- RIESGOS: F0APJ3P59S4 — checklist de riesgos completo
- SCORECARDS: F0AK5T984FM — prompts maestros V5A, V5B, v1
- ROADMAP: F0ANYRKF0QJ — etapas y fechas
- PANTALLAS: F0APJ15LFEG — arquitectura completa de UI por rol y sesión
- AGENTES: F0AQBP4TQ64 — este canvas (sistema multi-agente)
- MCPs: F0AP872K8FL — configuración de Supabase + GitHub + Vercel MCPs

## Canal Slack
#aurisiq — ID: C0AL7UWC1SM

## Stack técnico crítico
- Worker Cloudflare actual: optix-proxy.anwarhsg.workers.dev (compartido con Optix — separar en Etapa 1)
- ⚠️ API key se llama CLAUDE_API_KEY, NO ANTHROPIC_API_KEY
- Modelo: claude-sonnet-4-20250514
- Deploy: Vercel (repo privado en GitHub)
- Dominio: aurisiq.io — URL de producción: app.aurisiq.io
- Supabase Pro: proyecto a crear en Sesión 1.1

## Clientes activos (founders — 50 análisis/mes indefinidos)
- Inmobili Internacional — scorecards V5A + V5B — org: immobili_prod / immobili_test
- EnPagos — scorecard v1

## Decisiones cerradas — no reabrir
- localStorage: descartado, todo va a Supabase desde día uno
- analysis_jobs: separado de analyses (no cargar transcription_text en queries de score)
- fases[]: tabla separada analysis_phases con user_id — NO JSONB
- avanzo_a_siguiente_etapa: TEXT con valores converted/lost_captadora/lost_external/pending — NO BOOLEAN
- avanzo_a_siguiente_etapa: NO editable post-análisis — solo gerente vía manager_note
- categoria_descalificacion: JSONB array de strings, max 3 elementos, array vacío = calificado
- lead_calificado boolean: eliminado
- fuente_lead_id: UUID REFERENCES lead_sources(id) — NUNCA guardar el name directamente
- Scorecards globales: organization_id = NULL — es correcto, no es un error
- founder equivale a pro en features. Check: plan IN ('growth','pro','scale','enterprise','founder')
- Stripe período de gracia: 7 días
- Retención de audios: 7 días
- Límite transcripción texto manual: 15,000 caracteres
- organizations.access_status: campo canónico (active/grace/read_only) — no inferir del plan
- organizations tiene: stripe_customer_id TEXT nullable, stripe_grace_started_at TIMESTAMPTZ nullable
- Límites de tier en Worker (hardcoded): {starter:50, growth:200, pro:500, scale:1500, enterprise:null, founder:50}
- Enterprise tier_limit = null → función RPC retorna TRUE (IF tier_limit IS NULL THEN RETURN TRUE)
- current_focus_phase: promedio de últimos 5 análisis del usuario
- analyses.clasificacion: CHECK (excelente/buena/regular/deficiente)
- Queries de analytics: SIEMPRE filtrar WHERE status = 'completado'
- organizations.timezone: canónico para reportes; funnel_config.timezone solo para streak
- conversion_discrepancy: comparar lead_status del output de Claude contra avanzo_a_siguiente_etapa
- Dominio: aurisiq.io (comprado 28 Mar 2026) — app en app.aurisiq.io

## Reglas de UI
- La ÚNICA fuente del proyecto es DM Sans (400, 500, 600, 700). No se permite ninguna otra fuente. Nunca usar Syne, Playfair, Montserrat, ni ninguna fuente display o decorativa.

## Reglas operacionales críticas
- NUNCA borrar de auth.users directamente — solo users.active = false
- NUNCA guardar el name de fuente_lead directamente — siempre UUID reference
- NUNCA separar check de cuota y decremento en dos llamadas — usar función RPC atómica
- El Worker no verifica JWT hoy — organization_id y user_id vienen del body (MVP, deuda documentada)
- Después de cada commit, hacer git push origin main ANTES de reportar el hash en Slack — el hash local no sirve si no está en remote y Vercel no despliega sin push

## Al arrancar una sesión — protocolo obligatorio
1. Verificar que MCPs de Supabase, GitHub y Vercel estén conectados
2. Lanzar pm-agent: genera briefing de sesión desde canvases
3. Si hay código nuevo: lanzar architecture-qa antes de escribir
4. Al cerrar: lanzar code-qa si hubo commits, actualizar canvases SESIONES y PENDIENTES

## Al cerrar sesión — obligatorio sin preguntar
1. Actualizar SESIONES (F0ALHCSA449) con prepend — nueva entrada arriba
2. Actualizar PENDIENTES (F0AL1FB4XAN) con replace — mover completados
3. Postear resumen en #aurisiq (C0AL7UWC1SM)

## Criterios de aceptación — Sesión 1.1 (Schema Supabase)
La sesión está completa SOLO cuando:
1. Las 19 tablas existen en Supabase en el orden documentado en el TÉCNICO
2. organizations tiene access_status, stripe_customer_id, stripe_grace_started_at
3. analyses.clasificacion tiene CHECK (excelente/buena/regular/deficiente)
4. La función RPC check_and_increment_analysis_count existe y maneja tier_limit = NULL
5. Los índices documentados en el TÉCNICO existen
6. Dos usuarios de organizaciones distintas no pueden ver datos del otro (prueba básica de RLS)
7. Las tablas vacías de gamificación y objetivos existen

## Herramientas disponibles y autonomía de Claude Code

### PERMITIDO SIN PEDIR PERMISO:
- npm install de paquetes nuevos en el proyecto cuando un feature lo requiera (reportar cuál paquete y por qué)
- Verificar deploys con `npx vercel ls`, `npx vercel inspect`, `npx vercel logs` (usar siempre `--token=$VERCEL_TOKEN`)
- Verificar estado del Worker con `wrangler deployments list`, `wrangler tail` (desde directorio worker/)
- Verificar estado de DB con queries vía Supabase MCP (solo SELECT — para DDL siempre pasa por Anwar)
- git push origin main después de cada commit — reportar siempre el hash + confirmación del push
- Crear archivos de configuración menores (.eslintrc, .prettierrc, tsconfig tweaks) si mejoran DX
- Auto-retry de builds que fallen por flakiness (máximo 2 retries antes de reportar)

### REQUIERE PERMISO EXPLÍCITO DE ANWAR:
- Aplicar migraciones DDL a DB (solo Anwar via MCP)
- Instalar dependencias de sistema (brew, apt-get, etc.)
- Cambiar variables de entorno en Vercel o Cloudflare
- Borrar commits, forzar push, rewrite history
- Crear branches nuevos
- Merge de PRs
- Cambios en RLS policies o security-sensitive code

## MCPs — variables de entorno requeridas
⚠️ El repo es PÚBLICO. Credenciales en variables de entorno del sistema, nunca en este archivo.
Seguir canvas MCPs (F0AP872K8FL) para configuración completa.

{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest",
               "--supabase-url", "${SUPABASE_URL}",
               "--supabase-service-role-key", "${SUPABASE_SERVICE_ROLE_KEY}"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}" }
    },
    "vercel": {
      "command": "npx",
      "args": ["-y", "@vercel/mcp-adapter"],
      "env": { "VERCEL_TOKEN": "${VERCEL_TOKEN}" }
    }
  }
}
