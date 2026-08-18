// daily-digest — resúmenes de actividad AurisIQ a Slack (#aurisiq).
// Modos: daily (default) · weekly · monthly — body {"mode":"weekly"}.
// Crons pg_cron (service key desde vault, patrón aurisiq-process-queue):
//   aurisiq-daily-digest    30 13 * * *  → 7:30 AM CDMX, día anterior
//   aurisiq-weekly-digest   35 13 * * 1  → lunes 7:35, semana lun–dom previa
//   aurisiq-monthly-digest  40 13 1 * *  → día 1 7:40, mes anterior
//
// Seguridad: verify_jwt ON (gateway valida firma) + guard interno bearerRole
// que exige claim service_role — el anon key público no basta.
// Kill switch: SLACK_ALERT_WEBHOOK_URL vacío → no postea (patrón F21).
// Re-emisión: body {"date":"YYYY-MM-DD"} = cualquier día DENTRO del periodo
// (se normaliza a su semana/mes). Testing sin postear: {"dry":true} → devuelve text.
// Sin PII de prospectos: no se selecciona ningún campo prospect_*.
// Salud (solo daily): RPC get_daily_health — cuota por org, tamaño de DB y jobs
// atorados. Best-effort: si el RPC falla se loguea y el digest sale sin ellas.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  type AlertCount,
  type AnalysisRow,
  bearerRole,
  buildDigest,
  buildMonthlyDigest,
  buildWeeklyDigest,
  type DailyHealth,
  defaultTargetDate,
  DIGEST_VERSION,
  isDemoUser,
  monthWindowFor,
  type OrgRow,
  type PhaseRow,
  prevMonthDate,
  type UserRow,
  weekWindowFor,
  windowForDate,
} from "./digest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ROW_LIMIT = 2000;
const PHASE_ROW_LIMIT = 5000;
const MODES = ["daily", "weekly", "monthly"] as const;
type Mode = (typeof MODES)[number];

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  // Guard: el gateway (verify_jwt ON) ya validó la firma del JWT; aquí solo
  // exigimos rol service_role — el anon key (público, role=anon) no pasa.
  if (bearerRole(req.headers.get("Authorization")) !== "service_role") {
    console.error("[digest] unauthorized_call");
    return json(401, { error: "unauthorized" });
  }

  const webhookUrl = Deno.env.get("SLACK_ALERT_WEBHOOK_URL");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // body vacío del cron → defaults
  }

  // Modo: fail-loud ante un valor desconocido (nada de fallback silencioso).
  const rawMode = body.mode ?? "daily";
  if (typeof rawMode !== "string" || !MODES.includes(rawMode as Mode)) {
    console.error(`[digest] invalid_mode ${String(rawMode)}`);
    return json(400, { error: "invalid_mode", valid: MODES });
  }
  const mode = rawMode as Mode;
  const dry = body.dry === true;

  if (!webhookUrl && !dry) {
    console.log("[digest] webhook_not_configured, skipping");
    return json(200, { sent: false, reason: "not_configured" });
  }

  const dateOverride = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : null;
  // `date` (o ayer) selecciona el periodo que lo contiene.
  const refDate = dateOverride ?? defaultTargetDate(new Date());

  // Ventana del periodo + inicio del rango a traer (periodo previo incluido).
  let periodStartUtc: Date;
  let periodEndUtc: Date;
  let fetchStartUtc: Date;
  if (mode === "weekly") {
    const w = weekWindowFor(refDate);
    periodStartUtc = w.startUtc;
    periodEndUtc = w.endUtc;
    fetchStartUtc = new Date(w.startUtc.getTime() - 7 * 24 * 3600 * 1000);
  } else if (mode === "monthly") {
    const m = monthWindowFor(refDate);
    periodStartUtc = m.startUtc;
    periodEndUtc = m.endUtc;
    fetchStartUtc = monthWindowFor(prevMonthDate(m.startDate)).startUtc;
  } else {
    const d = windowForDate(refDate);
    periodStartUtc = d.startUtc;
    periodEndUtc = d.endUtc;
    fetchStartUtc = new Date(d.startUtc.getTime() - 13 * 24 * 3600 * 1000); // semana previa completa
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const phasesPromise = mode === "weekly"
      ? db
        .from("analysis_phases")
        .select("organization_id,user_id,phase_name,score,score_max,created_at")
        .gte("created_at", periodStartUtc.toISOString())
        .lt("created_at", periodEndUtc.toISOString())
        .limit(PHASE_ROW_LIMIT)
      : Promise.resolve({ data: [], error: null });

    // Salud: solo daily. Envuelto en Promise.resolve().catch() porque el builder
    // de postgrest no expone .catch — y un rechazo aquí tumbaría el Promise.all
    // entero, que es justo lo que este health check no puede permitirse.
    const healthPromise: Promise<{ data: unknown; error: { message: string } | null }> = mode === "daily"
      ? Promise.resolve(db.rpc("get_daily_health")).catch((e: unknown) => ({
        data: null,
        error: { message: (e as Error)?.message ?? String(e) },
      }))
      : Promise.resolve({ data: null, error: null });

    const [orgsRes, usersRes, analysesRes, alertsRes, phasesRes, healthRes] = await Promise.all([
      db.from("organizations").select("id,name,slug,access_status,plan"),
      db.from("users").select("id,organization_id,name,email,training_mode,active,created_at"),
      db
        .from("analyses")
        .select(
          "organization_id,user_id,status,score_general,lead_quality,lead_outcome,created_at,categoria_descalificacion,unscorable_reason",
        )
        .gte("created_at", fetchStartUtc.toISOString())
        .lt("created_at", periodEndUtc.toISOString())
        .limit(ROW_LIMIT),
      // error_alerts.sent_at_utc es timestamp SIN tz (naive UTC) → comparar
      // con instantes UTC sin sufijo Z.
      db
        .from("error_alerts")
        .select("error_type")
        .gte("sent_at_utc", periodStartUtc.toISOString().slice(0, 19))
        .lt("sent_at_utc", periodEndUtc.toISOString().slice(0, 19)),
      phasesPromise,
      healthPromise,
    ]);

    for (const [label, res] of [
      ["organizations", orgsRes],
      ["users", usersRes],
      ["analyses", analysesRes],
      ["error_alerts", alertsRes],
      ["analysis_phases", phasesRes],
    ] as const) {
      if (res.error) {
        console.error(`[digest] query_failed ${label}: ${res.error.message}`);
        return json(500, { sent: false, reason: `query_failed:${label}` });
      }
    }

    // health queda FUERA del fail-loud de arriba a propósito: es una señal
    // secundaria y su caída no justifica perder el reporte de actividad.
    let health: DailyHealth | null = null;
    if (healthRes.error) {
      console.error(`[digest] health_rpc_failed ${healthRes.error.message}`);
    } else if (healthRes.data && typeof healthRes.data === "object") {
      health = healthRes.data as DailyHealth;
    }

    const orgs = (orgsRes.data ?? []) as OrgRow[];
    const users = (usersRes.data ?? []) as UserRow[];
    const analyses = (analysesRes.data ?? []) as AnalysisRow[];
    const phases = (phasesRes.data ?? []) as PhaseRow[];
    if (analyses.length >= ROW_LIMIT) {
      console.warn(`[digest] analyses_window_truncated_at_${ROW_LIMIT}`);
    }
    if (phases.length >= PHASE_ROW_LIMIT) {
      console.warn(`[digest] phases_window_truncated_at_${PHASE_ROW_LIMIT}`);
    }

    const alertMap = new Map<string, number>();
    for (const a of (alertsRes.data ?? []) as Array<{ error_type: string }>) {
      alertMap.set(a.error_type, (alertMap.get(a.error_type) ?? 0) + 1);
    }
    const alerts: AlertCount[] = [...alertMap.entries()].map(([error_type, count]) => ({ error_type, count }));

    // Último análisis REAL por org (solo para orgs sin actividad en el periodo).
    const demoIds = new Set(users.filter(isDemoUser).map((u) => u.id));
    const activeInWindow = new Set(
      analyses
        .filter((a) => {
          const t = new Date(a.created_at).getTime();
          return t >= periodStartUtc.getTime() && t < periodEndUtc.getTime() &&
            (a.user_id === null || !demoIds.has(a.user_id));
        })
        .map((a) => a.organization_id),
    );
    const lastRealAnalysisByOrg: Record<string, string | null> = {};
    for (const org of orgs) {
      if (activeInWindow.has(org.id)) continue;
      const realIds = users
        .filter((u) => u.organization_id === org.id && u.active === true && !isDemoUser(u))
        .map((u) => u.id);
      if (!realIds.length) continue; // org shell demo — no entra al digest
      const { data, error } = await db
        .from("analyses")
        .select("created_at")
        .eq("organization_id", org.id)
        .in("user_id", realIds)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) {
        console.error(`[digest] query_failed last_analysis ${org.slug}: ${error.message}`);
        lastRealAnalysisByOrg[org.id] = null;
        continue;
      }
      lastRealAnalysisByOrg[org.id] = data?.[0]?.created_at ?? null;
    }

    let text: string;
    if (mode === "weekly") {
      text = buildWeeklyDigest({ targetDate: refDate, orgs, users, analyses, phases, alerts, lastRealAnalysisByOrg });
    } else if (mode === "monthly") {
      text = buildMonthlyDigest({ targetDate: refDate, orgs, users, analyses, alerts, lastRealAnalysisByOrg });
    } else {
      text = buildDigest({ targetDate: refDate, orgs, users, analyses, alerts, lastRealAnalysisByOrg, health });
    }

    if (dry) {
      console.log(`[digest] dry ${DIGEST_VERSION} mode=${mode} date=${refDate} chars=${text.length}`);
      return json(200, { sent: false, reason: "dry", mode, date: refDate, text });
    }

    const slackRes = await fetch(webhookUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!slackRes.ok) {
      console.error(`[digest] slack_post_failed ${slackRes.status}`);
      return json(500, { sent: false, reason: "slack_error", status: slackRes.status });
    }

    console.log(`[digest] sent ${DIGEST_VERSION} mode=${mode} date=${refDate} chars=${text.length}`);
    return json(200, { sent: true, mode, date: refDate });
  } catch (err) {
    console.error(`[digest] exception ${(err as Error).message}`);
    return json(500, { sent: false, reason: "exception" });
  }
});
