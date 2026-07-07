# AurisIQ — Claude Code

## Qué es
SaaS de inteligencia conversacional para equipos de venta LATAM. Graba/transcribe/analiza llamadas con IA y da coaching. Next.js (Vercel) + Supabase Pro ekvvsosbwkfyhawywgpn + Cloudflare Worker aurisiq-worker + AssemblyAI. Prod: app.aurisiq.io. Repo PRIVADO gmAnwar/aurisiq, rama main.

## División de trabajo (no negociable)
- El chat web de Claude es el PM: estrategia, prioridades, canvases de Slack, datos de prod vía MCP.
- Claude Code (tú) ejecuta: código, tests, commits, push, deploys cuando se instruyen.
- NUNCA escribas/actualices canvases de Slack. Tu único output a Slack es postear mensajes en #aurisiq (C0AL7UWC1SM): hashes, reportes, hallazgos.
- Si un prompt trae STOP rule (parar tras Fase 0), se respeta LITERAL. Continuar sin OK explícito es la falla más grave.

## Fuentes de verdad (en este orden)
1. PENDIENTES F0AKR4HNNEB — estado operacional, reglas vigentes, producción actual. Léelo si necesitas contexto que el prompt no trae.
2. TÉCNICO F0ALYPV5D16 — arquitectura y schema.
3. SCORECARDS F0AK5T984FM — prompts de análisis.
IDs viejos F0AL1FB4XAN (pendientes) y F0ALHCSA449 (sesiones) están MUERTOS — nunca escribas ahí.

Al leer el TÉCNICO: si hay múltiples definiciones de la misma tabla, usa la más completa; la sección "Gaps conocidos" corrige al cuerpo principal y tiene prioridad. Los supuestos sobre schema/funciones/CHECKs se verifican contra la DB VIVA vía MCP, no contra drafts (`supabase/migrations/_drafts/` no es fuente).

Canvases secundarios (solo lectura para ti): SESIONES v2 F0AU55QKPK3 · RIESGOS F0APJ3P59S4 · ROADMAP F0ANYRKF0QJ · PANTALLAS F0APJ15LFEG · AGENTES F0AQBP4TQ64 · MCPs F0AP872K8FL.

## Stack — datos duros
- Modelo Claude canónico: claude-sonnet-4-6 (en worker/src/index.js y supabase/functions/_shared/env.ts). Un string distinto es bug.
- La API key se llama CLAUDE_API_KEY, no ANTHROPIC_API_KEY.
- Worker deploy: SIEMPRE (cd worker && npx wrangler deploy -c wrangler.toml) — el wrangler.jsonc untracked de la raíz toma precedencia si omites el flag.
- Edge Function deploy: tras CUALQUIER deploy de analyze, recuérdale a Anwar el ritual verify_jwt (Dashboard → Settings → OFF → Save → F5). No es tuyo, es de él, pero tu trabajo es recordarlo.
- Vercel auto-deploya en push a main. Edge Functions y Worker NUNCA se deployan sin instrucción explícita.

## Clientes y orgs
- immobili (Inmobili Internacional, UNA M): V5A telefónico, V5B presencial, V5C seguimiento.
- enpagos: 3 scorecards, sin uso (churn risk).
- bodygreen: onboarding, org smoke canónica para tests (427e2d16...).
- Demo: carone, los-dentistas, momentum-quiro.
- NUNCA insertar datos de prueba en immobili. Smokes van a bodygreen.

## Reglas duras de código
- typecheck + build ANTES de cada commit. Sin excepción.
- Strings de UI: español México (tú, tienes), CON acentos, CERO voseo (elegí/completá = bug).
- Multi-tenant: toda query nueva filtra organization_id o se apoya en RLS documentada. Roles canónicos: ['gerente','direccion','agencia','super_admin'].
- Toda función SECURITY DEFINER nueva incluye su REVOKE (PUBLIC, anon, authenticated según caso) en la MISMA migración — el proyecto no tiene default-deny.
- Migraciones aplicadas vía MCP generan su propio timestamp — reconciliar nombres de archivo con la versión registrada.
- Orden FK para borrar análisis: xp_events → analysis_phases → analysis_jobs → background_jobs → analyses, en transacción.
- quota_consumed en background_jobs NUNCA se resetea al cambiar estados de jobs.
- Aritmética de scores en CÓDIGO, no en el LLM: score_general vía deriveScoreFromPhases, clasificacion vía deriveClasificacion (fuentes únicas — no crear copias inline).
- Cambios a prompts de scorecards: NUNCA "exactamente N bloques" sin enumerar los N completos incluyendo ESTADO DEL LEAD (causa raíz de F42, pérdida silenciosa de datos).
- Paridad Edge/Worker: si tocas lógica de scoring o escritura que existe en ambos paths, replica en ambos o declara la divergencia explícita en tu reporte.
- Secrets: nunca en código, commits ni logs (hooks.slack.com/services, tokens sbp_, service_role keys). Nunca console.log con transcripciones, nombres de prospectos o PII.
- Deuda conocida (no "arreglar" de paso sin instrucción): el Worker recibe organization_id/user_id del body sin verificar JWT.

## Reglas de UI
- REGLA DE IDIOMA — UI STRINGS: Todo texto visible al usuario se escribe en español mexicano neutro con tuteo (completa, agrega, elige, sube). NUNCA voseo argentino (completá, agregá, elegí, subí, podés, tenés). Antes de cada commit que agregue o modifique strings de UI, verificar contra esta regla.
- La ÚNICA fuente del proyecto es DM Sans (400, 500, 600, 700). No se permite ninguna otra fuente. Nunca usar Syne, Playfair, Montserrat, ni ninguna fuente display o decorativa.

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
- Límites de transcripción (F45): frontend telefónico 20,000 chars / 25 min; presencial 60,000 chars / 90 min. El Worker legacy conserva su gate de 15,000 chars (path flag=false, no aplica a presencial que va por Edge).
- organizations.access_status: campo canónico (active/grace/read_only) — no inferir del plan
- organizations tiene: stripe_customer_id TEXT nullable, stripe_grace_started_at TIMESTAMPTZ nullable
- Límites de tier en Worker (hardcoded): {starter:50, growth:200, pro:500, scale:1500, enterprise:null, founder:50}
- Enterprise tier_limit = null → función RPC retorna TRUE (IF tier_limit IS NULL THEN RETURN TRUE)
- current_focus_phase: promedio de últimos 5 análisis del usuario
- analyses.clasificacion: CHECK (excelente/buena/regular/deficiente) — umbrales canónicos 85/65/45 solo en código (deriveClasificacion)
- Queries de analytics: SIEMPRE filtrar WHERE status = 'completado'
- organizations.timezone: canónico para reportes; funnel_config.timezone solo para streak
- conversion_discrepancy: comparar lead_status del output de Claude contra avanzo_a_siguiente_etapa
- Dominio: aurisiq.io (comprado 28 Mar 2026) — app en app.aurisiq.io

## Reglas operacionales críticas
- NUNCA borrar de auth.users directamente — solo users.active = false
- NUNCA guardar el name de fuente_lead directamente — siempre UUID reference
- NUNCA separar check de cuota y decremento en dos llamadas — usar función RPC atómica
- Después de cada commit, hacer git push origin main ANTES de reportar el hash en Slack — el hash local no sirve si no está en remote y Vercel no despliega sin push

## Al arrancar una sesión — protocolo
1. Lanzar pm-agent: verifica drift entre estado documentado (canvases) y estado real (git). No decide prioridades.
2. Si el cambio toca schema, funciones de DB, pipeline de análisis o paths duales Edge/Worker: lanzar architecture-qa ANTES de escribir código.
3. Antes del commit final de una sesión con código: lanzar code-qa sobre los archivos modificados.

## Al terminar cualquier tarea
Commit descriptivo con prefijo del feature (ej. "F45: ..."), push si se instruyó, postear hash + resumen breve en #aurisiq, y PARAR. No encadenes tareas no pedidas.

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
Credenciales en variables de entorno del sistema, nunca en este archivo.
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
