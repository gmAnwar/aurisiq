// Daily digest — módulo puro: agregación + formato del mensaje Slack.
// Sin imports ni I/O: todo lo testeable vive aquí (ver digest.test.ts).
//
// Reglas de producto (sesión 2026-08-05, validadas contra DB viva):
// - "User real" = active, sin training_mode, y email que NO empieza con
//   'anwarhsg' (cuentas demo del founder). Análisis de users demo/training
//   se excluyen del digest y se reportan como línea de transparencia.
// - Una org entra al digest solo si tiene >=1 user real activo.
// - CERO PII de prospectos: este módulo no recibe ni un campo prospect_*.
//   Nombres de pila de vendedores sí (equipo del cliente, Slack interno).
// - Ventana: día calendario en America/Mexico_City. México no tiene DST
//   desde 2022 → offset fijo -06:00. NO usar "now() - 24h".

export const MX_OFFSET = "-06:00";
export const DIGEST_VERSION = "digest-v6";

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  access_status: string | null;
  /** Solo lo usa el mensual (uso del plan). Opcional para no romper daily. */
  plan?: string | null;
}

// Espejo de supabase/functions/_shared/env.ts TIER_LIMITS (esta función es
// autocontenida — MCP no bundlea imports fuera del dir). El drift de
// TIER_LIMITS ya es P2 conocido; este espejo se suma a ese inventario.
export const PLAN_LIMITS: Record<string, number | null> = {
  free: 10,
  starter: 50,
  growth: 200,
  pro: 500,
  scale: 1500,
  enterprise: null,
  founder: 50,
};

export interface UserRow {
  id: string;
  organization_id: string | null;
  name: string | null;
  email: string | null;
  training_mode: boolean | null;
  active: boolean | null;
  /** Solo lo usan weekly/monthly para "(nuevo)". Opcional para no romper daily. */
  created_at?: string | null;
}

export interface PhaseRow {
  organization_id: string;
  user_id: string | null;
  phase_name: string | null;
  score: number | null;
  score_max: number | null;
  created_at: string;
}

export interface AnalysisRow {
  organization_id: string;
  user_id: string | null;
  status: string | null;
  score_general: number | null;
  lead_quality: string | null;
  lead_outcome: string | null;
  created_at: string;
  /** Post-F47: null = "no se pudo leer". Solo lo usan weekly/monthly (top descal). */
  categoria_descalificacion?: string[] | null;
  /** F53: por qué no hay score. 'fragmento' = audio parcial. Lo usa el daily. */
  unscorable_reason?: string | null;
}

export interface AlertCount {
  error_type: string;
  count: number;
}

export interface DigestInput {
  targetDate: string; // YYYY-MM-DD (día ya cerrado en CDMX)
  orgs: OrgRow[];
  users: UserRow[];
  /** Análisis desde el inicio de la semana previa (14 días) hasta fin de ventana. */
  analyses: AnalysisRow[];
  alerts: AlertCount[];
  /** Para orgs en silencio: último análisis REAL por org (ISO) o null si nunca. */
  lastRealAnalysisByOrg: Record<string, string | null>;
}

// ---------- ventana temporal ----------

export function windowForDate(date: string): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(`${date}T00:00:00${MX_OFFSET}`);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000);
  return { startUtc, endUtc };
}

/** Ayer (día calendario CDMX) relativo a `now`. */
export function defaultTargetDate(now: Date): string {
  const mxNow = new Date(now.getTime() - 6 * 3600 * 1000);
  const yesterday = new Date(mxNow.getTime() - 24 * 3600 * 1000);
  return yesterday.toISOString().slice(0, 10);
}

export function fechaLabel(date: string): string {
  const d = new Date(`${date}T12:00:00${MX_OFFSET}`);
  try {
    const parts = new Intl.DateTimeFormat("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "short",
      timeZone: "America/Mexico_City",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const label = `${get("weekday")} ${get("day")} ${get("month")}`.trim();
    if (label.length > 3) return label.replace(/\.$/, "");
  } catch {
    // ICU incompleto → fallback abajo
  }
  return date;
}

// ---------- periodos semana / mes ----------
// Regla única de re-emisión: `date` (o "ayer" por default) selecciona el
// periodo que lo CONTIENE. El fire del lunes toma ayer=domingo → semana
// completa; el fire del día 1 toma ayer=último día → mes completo.

export interface PeriodWindow {
  startUtc: Date;
  endUtc: Date;
  startDate: string; // YYYY-MM-DD (CDMX)
  endDate: string; // último día INCLUIDO (CDMX)
}

/** Lunes (CDMX) de la semana que contiene `date`. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00${MX_OFFSET}`); // mediodía CDMX = 18:00Z mismo día
  const back = (d.getUTCDay() + 6) % 7; // 0=lun ... 6=dom
  return new Date(d.getTime() - back * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export function weekWindowFor(date: string): PeriodWindow {
  const startDate = mondayOf(date);
  const { startUtc } = windowForDate(startDate);
  const endUtc = new Date(startUtc.getTime() + 7 * 24 * 3600 * 1000);
  const endDate = new Date(endUtc.getTime() - 12 * 3600 * 1000).toISOString().slice(0, 10);
  return { startUtc, endUtc, startDate, endDate };
}

export function monthWindowFor(date: string): PeriodWindow {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const startDate = `${y}-${pad(m)}-01`;
  const nextStart = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const startUtc = windowForDate(startDate).startUtc;
  const endUtc = windowForDate(nextStart).startUtc;
  const endDate = new Date(endUtc.getTime() - 12 * 3600 * 1000).toISOString().slice(0, 10);
  return { startUtc, endUtc, startDate, endDate };
}

/** Primer día del mes ANTERIOR al que contiene `date`. */
export function prevMonthDate(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

function monthShort(date: string): string {
  try {
    const parts = new Intl.DateTimeFormat("es-MX", {
      month: "short",
      timeZone: "America/Mexico_City",
    }).formatToParts(new Date(`${date}T12:00:00${MX_OFFSET}`));
    const v = parts.find((p) => p.type === "month")?.value ?? "";
    if (v) return v.replace(/\.$/, "");
  } catch { /* fallback abajo */ }
  return date.slice(5, 7);
}

export function weekLabel(w: PeriodWindow): string {
  const d1 = Number(w.startDate.slice(8, 10));
  const d2 = Number(w.endDate.slice(8, 10));
  const m1 = monthShort(w.startDate);
  const m2 = monthShort(w.endDate);
  return m1 === m2 ? `${d1}–${d2} ${m1}` : `${d1} ${m1} – ${d2} ${m2}`;
}

export function monthLabel(date: string): string {
  try {
    const parts = new Intl.DateTimeFormat("es-MX", {
      month: "long",
      year: "numeric",
      timeZone: "America/Mexico_City",
    }).formatToParts(new Date(`${date.slice(0, 8)}15T12:00:00${MX_OFFSET}`));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const label = `${get("month")} ${get("year")}`.trim();
    if (label.length > 4) return label;
  } catch { /* fallback abajo */ }
  return date.slice(0, 7);
}

// ---------- auth ----------

/**
 * Rol del Bearer JWT SIN validar firma — la firma ya la validó el gateway
 * (verify_jwt ON). Aquí solo distinguimos service_role vs anon (público).
 * NO usar igualdad de string contra el env SUPABASE_SERVICE_ROLE_KEY: el JWT
 * del vault (edge_function_service_role_key) y el del runtime difieren como
 * tokens aunque comparten rol (descubierto S53 — 401 en el primer smoke).
 */
export function bearerRole(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const parts = authHeader.slice(7).trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

// ---------- clasificación de users/orgs ----------

export function isDemoUser(u: UserRow): boolean {
  const email = (u.email ?? "").toLowerCase();
  return u.training_mode === true || email.startsWith("anwarhsg");
}

export function realActiveUserIds(users: UserRow[], orgId: string): string[] {
  return users
    .filter((u) => u.organization_id === orgId && u.active === true && !isDemoUser(u))
    .map((u) => u.id);
}

interface Eligibility {
  eligibleOrgs: OrgRow[];
  eligibleOrgIds: Set<string>;
  demoUserIds: Set<string>;
  isRealAnalysis: (a: AnalysisRow) => boolean;
}

function computeEligibility(orgs: OrgRow[], users: UserRow[]): Eligibility {
  const demoUserIds = new Set(users.filter(isDemoUser).map((u) => u.id));
  const eligibleOrgs = orgs.filter(
    (o) => (o.access_status ?? "active") === "active" && realActiveUserIds(users, o.id).length > 0,
  );
  const eligibleOrgIds = new Set(eligibleOrgs.map((o) => o.id));
  const isRealAnalysis = (a: AnalysisRow) =>
    eligibleOrgIds.has(a.organization_id) && (a.user_id === null || !demoUserIds.has(a.user_id));
  return { eligibleOrgs, eligibleOrgIds, demoUserIds, isRealAnalysis };
}

function firstName(u: UserRow | undefined): string {
  const n = (u?.name ?? "").trim();
  return n ? n.split(/\s+/)[0] : "(usuario)";
}

// ---------- helpers de formato ----------

function nLabel(n: number, sing: string, plur: string): string {
  return `${n} ${n === 1 ? sing : plur}`;
}

function inWindow(iso: string, startUtc: Date, endUtc: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= startUtc.getTime() && t < endUtc.getTime();
}

function avgScore(rows: AnalysisRow[]): number | null {
  const scores = rows.map((a) => a.score_general).filter((s): s is number => typeof s === "number");
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function daysBetween(fromIso: string, toDate: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(`${toDate}T23:59:59${MX_OFFSET}`).getTime();
  return Math.max(1, Math.floor((to - from) / (24 * 3600 * 1000)));
}

// ---------- F53/F54: cómo se imprime el NIVEL de un conjunto de análisis ----------
//
// El daily imprimía "prom" sobre muestras donde el promedio no describe
// ninguna llamada. Medido contra la DB viva (60 días, usuario-día en CDMX,
// base = los que tienen al menos un score): el 53% tiene UNA sola llamada
// —ahí el "prom" ES esa llamada disfrazada de estadística—, el 76% tiene 2 o
// menos, y solo el 2.6% llega a 4+, que es donde un promedio empieza a
// significar algo. Caso publicado el 6-ago: un usuario con 2 llamadas de 65
// y 28 salió como "2 · prom 47"; el peor, 56/62/16 como "prom 45". Misma
// familia que F51/F52: un número que se lee como desempeño y no lo es.
//
// Regla: <=3 con score → se listan crudos, y los no-scored entran al MISMO
// paréntesis; >=4 → "prom X (min–max)" (el rango NO es opcional: es lo que
// impide que el promedio vuelva a esconder la dispersión) y los no-scored
// pasan a sufijo, porque el paréntesis ya lo ocupa el rango.
//
// INVARIANTE: el número que sigue al nombre es items.length y todo item está
// representado — como score o dentro de un conteo. Nada se evapora: es lo que
// hace la línea auditable contra la DB.
//
// F54: el defecto vivía en dos superficies más — la línea por usuario del
// SEMANAL (el mismo "prom" sobre n<=3) y la rama colapsada de >4 orgs, que
// imprime "prom" para una org aunque tenga una sola llamada. La regla NO se
// copió a cada superficie: vive una sola vez en scoreLevelLine y las tres la
// consumen, así que mover el umbral o el formato es un solo cambio.

const SCORES_INLINE_MAX = 3; // <=3 → scores crudos · >=4 → prom + rango

type OtroTipo = "fragmento" | "rechazado" | "en proceso";

/** Orden fijo de tipos en el render (no por conteo — determinismo del golden). */
const OTRO_ORDEN: OtroTipo[] = ["fragmento", "rechazado", "en proceso"];
const OTRO_PLURAL: Record<OtroTipo, string> = {
  fragmento: "fragmentos",
  rechazado: "rechazados",
  "en proceso": "en proceso", // invariable
};

/** Clasifica un análisis SIN score. 'fragmento' gana sobre el status. */
function otroTipo(a: AnalysisRow): OtroTipo {
  if (a.unscorable_reason === "fragmento") return "fragmento";
  if (a.status === "rechazado") return "rechazado";
  return "en proceso";
}

/**
 * Un score solo cuenta si su análisis está 'completado' — regla dura del
 * proyecto. El pipeline puede dejar un score huérfano en una fila que después
 * pasó a 'error'/'rechazado' (worker: status='error' en el catch posterior a
 * persistir el payload); ese número NO describe una llamada calificada y se
 * reporta por su tipo, no como si fuera un score válido.
 */
function hasScore(a: AnalysisRow): boolean {
  return a.status === "completado" && typeof a.score_general === "number";
}

/** Conteos por tipo, en OTRO_ORDEN y sin entradas en cero. */
function otrosCounts(rows: AnalysisRow[]): Array<[OtroTipo, number]> {
  const m = new Map<OtroTipo, number>();
  for (const a of rows) {
    const t = otroTipo(a);
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return OTRO_ORDEN.filter((t) => (m.get(t) ?? 0) > 0).map((t) => [t, m.get(t)!]);
}

/**
 * FUENTE ÚNICA de la regla — daily, weekly y la rama colapsada de org la
 * consumen (F54). No copiar esta lógica a una superficie nueva: pásale otro
 * `head`.
 *
 * @param head  Sujeto YA renderizado con su conteo: "Wenceslao: 3" en las
 *              líneas por usuario, "5 completados" en la rama de org. El número
 *              que trae es el que la INVARIANTE audita contra lo representado.
 * @param items TODOS los análisis del sujeto en el periodo — el periodo lo
 *              elige el llamador (el weekly manda la semana REPORTADA, no la
 *              previa: la previa solo alimenta el delta).
 * @param badge Etiqueta de cierre — lo único que difiere entre superficies. El
 *              weekly manda ahí su delta ("+12", "≈", "nuevo"); daily y org no
 *              mandan nada. Va en CORCHETES, no en paréntesis, a propósito: en
 *              la rama de crudos el nivel ya cierra con ")" y dos paréntesis
 *              seguidos con significados distintos —los items y la tendencia—
 *              no se distinguen al leer.
 */
export function scoreLevelLine(head: string, items: AnalysisRow[], badge = ""): string {
  const cron = items
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const scored = cron.filter(hasScore);
  const otros = otrosCounts(cron.filter((a) => !hasScore(a)));
  const cierre = badge ? ` [${badge}]` : "";

  if (!items.length) return `${head}${cierre}`;

  if (scored.length <= SCORES_INLINE_MAX) {
    // Todo dentro del paréntesis. Un solo item de un tipo va como palabra;
    // 2+ se colapsan a "N tipo" en plural.
    const dentro = [
      ...scored.map((a) => String(a.score_general)),
      ...otros.map(([t, n]) => (n === 1 ? t : `${n} ${OTRO_PLURAL[t]}`)),
    ];
    return `${head} (${dentro.join(", ")})${cierre}`;
  }

  const nums = scored.map((a) => a.score_general as number);
  const prom = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  // "–" es U+2013 (guion largo), no un guion normal.
  let out = `${head} · prom ${prom} (${Math.min(...nums)}–${Math.max(...nums)})`;
  for (const [t, n] of otros) out += ` · ${n} ${n === 1 ? t : OTRO_PLURAL[t]}`;
  return out + cierre;
}

/**
 * Línea de un usuario para el daily. `items` = TODOS sus análisis del día.
 * Ver INVARIANTE arriba: cada item sale como score o dentro de un conteo.
 */
export function userDayLine(name: string, items: AnalysisRow[]): string {
  return scoreLevelLine(`${name}: ${items.length}`, items);
}

// ---------- digest ----------

const MAX_ORG_DETAIL = 4; // >4 orgs con actividad → colapsar detalle por-usuario
const MAX_USERS_LISTED = 6;

export function buildDigest(input: DigestInput): string {
  const { targetDate, orgs, users, analyses, alerts, lastRealAnalysisByOrg } = input;
  const { startUtc, endUtc } = windowForDate(targetDate);
  const weekStart = new Date(startUtc.getTime() - 6 * 24 * 3600 * 1000);
  const prevWeekStart = new Date(startUtc.getTime() - 13 * 24 * 3600 * 1000);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const { eligibleOrgs, isRealAnalysis } = computeEligibility(orgs, users);

  const inDay = analyses.filter((a) => inWindow(a.created_at, startUtc, endUtc));
  const dayReal = inDay.filter(isRealAnalysis);
  const dayExcluded = inDay.length - dayReal.length;

  const weekReal = analyses.filter(
    (a) => isRealAnalysis(a) && inWindow(a.created_at, weekStart, endUtc),
  );
  const prevWeekReal = analyses.filter(
    (a) => isRealAnalysis(a) && inWindow(a.created_at, prevWeekStart, weekStart),
  );

  // --- bloques por org con actividad ---
  const byOrg = new Map<string, AnalysisRow[]>();
  for (const a of dayReal) {
    if (!byOrg.has(a.organization_id)) byOrg.set(a.organization_id, []);
    byOrg.get(a.organization_id)!.push(a);
  }
  const activeOrgs = eligibleOrgs
    .filter((o) => byOrg.has(o.id))
    .sort((a, b) => byOrg.get(b.id)!.length - byOrg.get(a.id)!.length);
  const collapse = activeOrgs.length > MAX_ORG_DETAIL;

  const lines: string[] = [`📊 *AurisIQ* — ${fechaLabel(targetDate)}`, ""];

  if (!activeOrgs.length) {
    lines.push("Sin análisis.", "");
  }

  for (const org of activeOrgs) {
    const rows = byOrg.get(org.id)!;
    const completados = rows.filter((a) => a.status === "completado");
    const rechazados = rows.filter((a) => a.status === "rechazado").length;
    const enProceso = rows.length - completados.length - rechazados;

    const byUser = new Map<string, AnalysisRow[]>();
    for (const a of rows) {
      const key = a.user_id ?? "?";
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(a);
    }

    let head = `*${org.name.toUpperCase()}* — ${nLabel(rows.length, "análisis", "análisis")}`;
    if (rechazados > 0 || enProceso > 0) {
      const parts = [nLabel(completados.length, "completado", "completados")];
      if (rechazados > 0) parts.push(nLabel(rechazados, "rechazado", "rechazados"));
      if (enProceso > 0) parts.push(`${enProceso} en proceso`);
      head += ` (${parts.join(" · ")})`;
    }
    head += ` · ${nLabel(byUser.size, "usuario", "usuarios")}`;
    lines.push(head);

    if (collapse) {
      // F54: esta rama tenía el mismo defecto que la línea por usuario —imprimía
      // "prom" para una org aunque tuviera una sola llamada— y se corrige con el
      // MISMO helper. El ancla del paréntesis es el conteo de COMPLETADOS, no el
      // total de la org: los rechazados y los en proceso ya los enumera el head,
      // y así el número del ancla sigue siendo auditable contra lo representado.
      const calif = completados.filter((a) => a.lead_quality === "calificado").length;
      const extra = [
        completados.length
          ? scoreLevelLine(nLabel(completados.length, "completado", "completados"), completados)
          : null,
        calif > 0 ? nLabel(calif, "calificado", "calificados") : null,
      ].filter(Boolean).join(" · ");
      if (extra) lines.push(`• ${extra}`);
      lines.push("");
      continue;
    }

    const userEntries = [...byUser.entries()]
      .map(([uid, rs]) => {
        const name = firstName(usersById.get(uid));
        return { name, count: rs.length, line: userDayLine(name, rs) };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const listed = userEntries.slice(0, MAX_USERS_LISTED);
    const extraUsers = userEntries.length - listed.length;
    const userLine = listed.map((e) => e.line).join("  ·  ");
    lines.push(`• ${userLine}${extraUsers > 0 ? `  ·  +${extraUsers} más` : ""}`);

    const buckets: Array<[string, string, number]> = [
      ["calificado", "calificados", completados.filter((a) => a.lead_quality === "calificado").length],
      ["descalificado", "descalificados", completados.filter((a) => a.lead_quality === "descalificado").length],
      ["indeterminado", "indeterminados", completados.filter((a) => a.lead_quality === "indeterminado").length],
      ["sin dato", "sin dato", completados.filter((a) => a.lead_quality == null).length],
    ];
    const leadParts = buckets.filter(([, , n]) => n > 0).map(([s, p, n]) => nLabel(n, s, p));
    if (leadParts.length) lines.push(`• Leads: ${leadParts.join(" · ")}`);

    const outcomeCounts = new Map<string, number>();
    for (const a of completados) {
      if (a.lead_outcome) outcomeCounts.set(a.lead_outcome, (outcomeCounts.get(a.lead_outcome) ?? 0) + 1);
    }
    if (outcomeCounts.size) {
      const parts = [...outcomeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k, n]) => `${n} ${k}`);
      lines.push(`• Outcomes: ${parts.join(" · ")}`);
    }
    lines.push("");
  }

  // --- infra ---
  const totalAlerts = alerts.reduce((s, a) => s + a.count, 0);
  if (totalAlerts > 0) {
    const detail = alerts
      .slice()
      .sort((a, b) => b.count - a.count || a.error_type.localeCompare(b.error_type))
      .map((a) => (a.count === 1 ? a.error_type : `${a.error_type} ×${a.count}`))
      .join(" · ");
    lines.push(`⚠️ Infra: ${nLabel(totalAlerts, "alerta", "alertas")} (${detail})`);
  }

  // --- orgs en silencio ---
  const silentOrgs = eligibleOrgs.filter((o) => !byOrg.has(o.id));
  for (const org of silentOrgs.sort((a, b) => a.name.localeCompare(b.name))) {
    const last = lastRealAnalysisByOrg[org.id] ?? null;
    const suffix = last
      ? `último análisis hace ${nLabel(daysBetween(last, targetDate), "día", "días")}`
      : "sin análisis desde su alta";
    lines.push(`🔇 ${org.name} — ${suffix}`);
  }
  if (totalAlerts > 0 || silentOrgs.length) lines.push("");

  // --- semana ---
  lines.push(`Semana: ${nLabel(weekReal.length, "análisis", "análisis")} (vs ${prevWeekReal.length} previa)`);
  if (dayExcluded > 0) {
    lines.push(`_Excluidos: ${nLabel(dayExcluded, "análisis demo/training", "análisis demo/training")}_`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- helpers compartidos weekly / monthly ----------

function groupByOrgRows(rows: AnalysisRow[]): Map<string, AnalysisRow[]> {
  const m = new Map<string, AnalysisRow[]>();
  for (const a of rows) {
    if (!m.has(a.organization_id)) m.set(a.organization_id, []);
    m.get(a.organization_id)!.push(a);
  }
  return m;
}

function groupByUserRows(rows: AnalysisRow[]): Map<string, AnalysisRow[]> {
  const m = new Map<string, AnalysisRow[]>();
  for (const a of rows) {
    const k = a.user_id ?? "?";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(a);
  }
  return m;
}

function signedDelta(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "=";
}

function deltaPctLabel(cur: number, prev: number): string {
  if (prev <= 0) return "vs 0 previa";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `vs ${prev}, ${pct >= 0 ? "+" : ""}${pct}%`;
}

/** % calificados con denominador honesto (espejo F47): NULL fuera. */
function qualifiedPct(rows: AnalysisRow[]): number | null {
  const denom = rows.filter(
    (a) => a.status === "completado" && a.lead_quality != null,
  ).length;
  if (!denom) return null;
  const calif = rows.filter((a) => a.status === "completado" && a.lead_quality === "calificado").length;
  return Math.round((calif / denom) * 100);
}

function leadsLine(completados: AnalysisRow[]): string | null {
  const calif = completados.filter((a) => a.lead_quality === "calificado").length;
  const descal = completados.filter((a) => a.lead_quality === "descalificado").length;
  const indet = completados.filter((a) => a.lead_quality === "indeterminado").length;
  const sinDato = completados.filter((a) => a.lead_quality == null).length;
  const pct = qualifiedPct(completados);
  const parts: string[] = [];
  if (calif > 0 || pct !== null) {
    parts.push(`${nLabel(calif, "calificado", "calificados")}${pct !== null ? ` (${pct}%)` : ""}`);
  }
  if (descal > 0) parts.push(nLabel(descal, "descalificado", "descalificados"));
  if (indet > 0) parts.push(nLabel(indet, "indeterminado", "indeterminados"));
  if (sinDato > 0) parts.push(`${sinDato} sin dato`);
  return parts.length ? `• Leads: ${parts.join(" · ")}` : null;
}

function outcomesLine(completados: AnalysisRow[]): string | null {
  const counts = new Map<string, number>();
  for (const a of completados) {
    if (a.lead_outcome) counts.set(a.lead_outcome, (counts.get(a.lead_outcome) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${n} ${k}`);
  return `• Outcomes: ${parts.join(" · ")}`;
}

function topDescalLine(completados: AnalysisRow[], top = 3): string | null {
  const counts = new Map<string, number>();
  for (const a of completados) {
    for (const code of a.categoria_descalificacion ?? []) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  if (!counts.size) return null;
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([k, n]) => `${k} ×${n}`);
  return `• Top descalificación: ${parts.join(" · ")}`;
}

function infraLine(alerts: AlertCount[], prefix: string): string | null {
  const total = alerts.reduce((s, a) => s + a.count, 0);
  if (!total) return null;
  const detail = alerts
    .slice()
    .sort((a, b) => b.count - a.count || a.error_type.localeCompare(b.error_type))
    .map((a) => (a.count === 1 ? a.error_type : `${a.error_type} ×${a.count}`))
    .join(" · ");
  return `⚠️ ${prefix}: ${nLabel(total, "alerta", "alertas")} (${detail})`;
}

function excludedLine(n: number): string | null {
  return n > 0 ? `_Excluidos: ${nLabel(n, "análisis demo/training", "análisis demo/training")}_` : null;
}

function weeksSilentFrom(lastIso: string, endUtc: Date): number {
  return Math.max(1, Math.floor((endUtc.getTime() - new Date(lastIso).getTime()) / (7 * 24 * 3600 * 1000)));
}

function cdmxYearMonthIndex(iso: string): number {
  const d = new Date(new Date(iso).getTime() - 6 * 3600 * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthsSilentFrom(lastIso: string, monthStartDate: string): number {
  const target = Number(monthStartDate.slice(0, 4)) * 12 + (Number(monthStartDate.slice(5, 7)) - 1);
  return Math.max(1, target - cdmxYearMonthIndex(lastIso));
}

function createdInWindow(u: UserRow | undefined, startUtc: Date, endUtc: Date): boolean {
  if (!u?.created_at) return false;
  return inWindow(u.created_at, startUtc, endUtc);
}

// Antídoto de composición (F50 — Simpson's paradox verificado en prod): el
// promedio de equipo mezcla a quien entró y a quien dejó de usar el sistema —
// puede caer 11 puntos mientras TODOS los individuos mejoran (Inmobili:
// 63.1 → 52.4 de equipo con el único usuario de volumen real subiendo
// 50 → 57, porque la mejor usuaria se apagó y entraron novatas). Esta función
// compara SOLO a los usuarios presentes en ambos periodos: mismo denominador
// humano, tendencia real de desempeño.
export function cohortAvgs(
  curUsers: Map<string, AnalysisRow[]>,
  prevUsers: Map<string, AnalysisRow[]>,
): { n: number; prevAvg: number | null; curAvg: number | null } {
  const comunes = [...curUsers.keys()].filter((uid) => prevUsers.has(uid));
  if (!comunes.length) return { n: 0, prevAvg: null, curAvg: null };
  const curRows = comunes.flatMap((uid) => curUsers.get(uid)!).filter((a) => a.status === "completado");
  const prevRows = comunes.flatMap((uid) => prevUsers.get(uid)!).filter((a) => a.status === "completado");
  return { n: comunes.length, prevAvg: avgScore(prevRows), curAvg: avgScore(curRows) };
}

/** Scores numéricos de las filas completadas — insumo de deltaLegible. */
function completedScores(rows: AnalysisRow[]): number[] {
  return rows
    .filter((a) => a.status === "completado")
    .map((a) => a.score_general)
    .filter((s): s is number => typeof s === "number");
}

// F51: candado estadístico de los deltas. La desviación POR LLAMADA medida en
// prod es ~18 puntos (48 llamadas del mismo captador; un solo día produjo
// 52/72/72/28/66) — con ~10 llamadas/semana el error estándar de un promedio
// es ~6 puntos y los deltas que publicábamos caben dentro del ruido (jun vs
// jul del mismo captador: t=1.25, no significativo). Un delta solo se imprime
// como número si supera 2 errores estándar; la sd se ESTIMA de los propios
// datos (auto-calibrante, no un número mágico), con piso de 2 puntos en el SE
// para que una muestra degenerada — todos los scores idénticos — no produzca
// falsa confianza, y mínimo DELTA_MIN_N llamadas por periodo porque debajo de
// eso ni la varianza es estimable.
export const DELTA_MIN_N = 3;

// Une en español: "A y B" con dos, "A, B y C" con tres.
function joinEs(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

// F52: separación mínima, en errores estándar de la DIFERENCIA, para coronar
// una fase por encima de la siguiente.
const PHASE_TIE_SE = 2;

export interface PhaseCost {
  name: string;
  /** Promedio de (score_max - score) por llamada: lo que esa fase CUESTA. */
  avgLost: number;
  /** Error estándar del promedio: sd/raíz(n). */
  se: number;
  n: number;
}

/**
 * F52: la fase se reporta en PUNTOS PERDIDOS por llamada, no en % del máximo.
 * Dos razones: el gerente entiende "esta fase te cuesta 13.8 puntos de cada
 * llamada", y la métrica ya pondera por el peso de la fase (una fase de 35
 * puntos al 60% pierde 14.0 por llamada y una de 10 al 60% pierde 4.0: 3.5
 * veces más, que es la razón de sus máximos).
 * Devuelve las fases que superan el gate n>=PHASE_MIN_N, de más cara a más
 * barata. sd muestral (n-1); el gate garantiza n>=5, así que nunca divide por 0.
 */
export function phaseCosts(rows: PhaseRow[]): PhaseCost[] {
  const byPhase = new Map<string, number[]>();
  for (const p of rows) {
    if (!p.phase_name || typeof p.score !== "number" || typeof p.score_max !== "number") continue;
    const arr = byPhase.get(p.phase_name) ?? [];
    arr.push(p.score_max - p.score);
    byPhase.set(p.phase_name, arr);
  }
  return [...byPhase.entries()]
    .filter(([, xs]) => xs.length >= PHASE_MIN_N)
    .map(([name, xs]) => {
      const n = xs.length;
      const mean = xs.reduce((a, b) => a + b, 0) / n;
      const varianza = xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / (n - 1);
      return { name, avgLost: mean, se: Math.sqrt(varianza / n), n };
    })
    .sort((a, b) => b.avgLost - a.avgLost || a.name.localeCompare(b.name));
}

/**
 * F52: corona SOLO si la fase más cara se separa de la siguiente por más de
 * PHASE_TIE_SE errores estándar de la diferencia. Medido sobre 79 llamadas
 * reales, el primer lugar era un volado: Expectativa y Precio (13.81, SE 0.86)
 * vs Calificación de la Propiedad (13.28, SE 0.77) → t=0.46. Publicar "la fase
 * más débil es X" con ese empate manda al equipo a entrenar la fase equivocada
 * la mitad de las veces; reportar el empate es la lectura honesta.
 */
export function phaseCostLine(rows: PhaseRow[]): string | null {
  const costs = phaseCosts(rows);
  if (!costs.length) return null;
  const fmt = (x: number) => x.toFixed(1);
  const first = costs[0];

  // Grupo empatado: las que NO se separan de la primera. La lista viene
  // ordenada descendente, así que la primera separada corta el grupo.
  const tied = [first];
  for (const c of costs.slice(1)) {
    const seDiff = Math.sqrt(first.se * first.se + c.se * c.se);
    if (first.avgLost - c.avgLost > PHASE_TIE_SE * seDiff) break;
    tied.push(c);
  }

  if (tied.length === 1) {
    return `• Fase más cara: ${first.name} (${fmt(first.avgLost)} pts por llamada)`;
  }
  const shown = tied.slice(0, 3);
  return `• Fases más caras: ${joinEs(shown.map((c) => c.name))} (${joinEs(shown.map((c) => fmt(c.avgLost)))} pts, empatadas)`;
}

export function deltaLegible(
  prevScores: number[],
  curScores: number[],
): { delta: number; legible: boolean } | null {
  const na = prevScores.length, nb = curScores.length;
  if (na < DELTA_MIN_N || nb < DELTA_MIN_N) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ma = mean(prevScores), mb = mean(curScores);
  const ss = (xs: number[], m: number) => xs.reduce((a, x) => a + (x - m) * (x - m), 0);
  const sd = Math.sqrt((ss(prevScores, ma) + ss(curScores, mb)) / (na + nb - 2));
  const se = Math.max(sd * Math.sqrt(1 / na + 1 / nb), 2);
  // F52b: el veredicto compara la diferencia SIN redondear; el delta redondeado
  // es solo para render. Redondear cada media antes de restar mueve la cantidad
  // comparada hasta ±1 punto y voltea el veredicto en la frontera. Caso real de
  // prod (jun vs jul de immobili, n=14 y n=32): |mb-ma| = 11.2455 queda por
  // DEBAJO del umbral 2·SE = 11.4971 → no distinguible; pero
  // |round(mb)-round(ma)| = 12 lo cruzaba y publicaba una caída como si fuera
  // real. El defecto corta en ambos sentidos: también suprime señal legítima.
  const rawDelta = mb - ma;
  const delta = Math.round(mb) - Math.round(ma);
  return { delta, legible: Math.abs(rawDelta) >= 2 * se };
}

// ---------- digest SEMANAL ----------
// Vista de coaching: deltas por usuario, fase más débil, top descalificación.

export interface WeeklyInput {
  targetDate: string; // cualquier día dentro de la semana a reportar
  orgs: OrgRow[];
  users: UserRow[];
  /** Análisis desde el lunes de la semana PREVIA hasta el fin de la reportada. */
  analyses: AnalysisRow[];
  /** Filas de analysis_phases SOLO de la semana reportada. */
  phases: PhaseRow[];
  alerts: AlertCount[];
  lastRealAnalysisByOrg: Record<string, string | null>;
}

const PHASE_MIN_N = 5; // gate POR FASE: sin n>=5 no se reporta (evita ganadores con n=2)

export function buildWeeklyDigest(input: WeeklyInput): string {
  const { orgs, users, analyses, phases, alerts, lastRealAnalysisByOrg } = input;
  const w = weekWindowFor(input.targetDate);
  const prevStartUtc = new Date(w.startUtc.getTime() - 7 * 24 * 3600 * 1000);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const { eligibleOrgs, demoUserIds, isRealAnalysis } = computeEligibility(orgs, users);

  const inCurAll = analyses.filter((a) => inWindow(a.created_at, w.startUtc, w.endUtc));
  const cur = inCurAll.filter(isRealAnalysis);
  const prev = analyses.filter((a) => isRealAnalysis(a) && inWindow(a.created_at, prevStartUtc, w.startUtc));
  const excluded = inCurAll.length - cur.length;

  const curByOrg = groupByOrgRows(cur);
  const prevByOrg = groupByOrgRows(prev);
  const activeOrgs = eligibleOrgs
    .filter((o) => curByOrg.has(o.id))
    .sort((a, b) => curByOrg.get(b.id)!.length - curByOrg.get(a.id)!.length);

  const lines: string[] = [`📈 *AurisIQ* — semana ${weekLabel(w)}`, ""];
  if (!activeOrgs.length) lines.push("Sin análisis en la semana.", "");

  for (const org of activeOrgs) {
    const rows = curByOrg.get(org.id)!;
    const prevRows = prevByOrg.get(org.id) ?? [];
    const completados = rows.filter((a) => a.status === "completado");
    const rechazados = rows.filter((a) => a.status === "rechazado").length;
    const curUsers = groupByUserRows(rows);
    const prevUsers = groupByUserRows(prevRows);

    let head = `*${org.name.toUpperCase()}* — ${nLabel(rows.length, "análisis", "análisis")} (${deltaPctLabel(rows.length, prevRows.length)})`;
    head += ` · ${nLabel(curUsers.size, "usuario", "usuarios")}${prevRows.length ? ` (vs ${prevUsers.size})` : ""}`;
    if (rechazados > 0) head += ` · ${nLabel(rechazados, "rechazado", "rechazados")}`;
    lines.push(head);

    // Por usuario: NIVEL con el mismo helper que el daily (F54 — antes esta
    // línea imprimía "prom" sobre 1 o 2 llamadas) + delta vs SU semana previa.
    // F51 queda intacto: el delta numérico solo se imprime si es
    // estadísticamente legible; diferencia dentro del ruido → "≈"; menos de
    // DELTA_MIN_N llamadas en algún periodo → sin etiqueta. Lo que cambió es
    // dónde vive el delta: en CORCHETES, porque el nivel ya puede cerrar con
    // paréntesis y dos paréntesis seguidos no se distinguen (ver scoreLevelLine).
    const entries = [...curUsers.entries()]
      .map(([uid, rs]) => {
        const u = usersById.get(uid);
        let badge = "";
        if (createdInWindow(u, w.startUtc, w.endUtc)) {
          badge = "nuevo";
        } else {
          const dl = deltaLegible(completedScores(prevUsers.get(uid) ?? []), completedScores(rs));
          if (dl) badge = dl.legible ? signedDelta(dl.delta) : "≈";
        }
        const name = firstName(u);
        // `rs` = semana REPORTADA. La previa solo alimenta el delta de arriba;
        // pasarla al nivel publicaría los scores de la semana equivocada.
        return { name, count: rs.length, line: scoreLevelLine(`${name}: ${rs.length}`, rs, badge) };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const listed = entries.slice(0, MAX_USERS_LISTED);
    const extra = entries.length - listed.length;
    lines.push(`• ${listed.map((e) => e.line).join("  ·  ")}${extra > 0 ? `  ·  +${extra} más` : ""}`);

    const leads = leadsLine(completados);
    if (leads) lines.push(leads);
    const descal = topDescalLine(completados);
    if (descal) lines.push(descal);

    // F52: fase en PUNTOS PERDIDOS por llamada, y sin corona cuando la primera
    // no se separa de la segunda (ver phaseCostLine). Gate POR FASE n>=PHASE_MIN_N.
    const orgPhases = phases.filter(
      (p) =>
        p.organization_id === org.id &&
        (p.user_id === null || !demoUserIds.has(p.user_id)) &&
        inWindow(p.created_at, w.startUtc, w.endUtc) &&
        p.phase_name && typeof p.score === "number" && typeof p.score_max === "number" && p.score_max > 0,
    );
    const faseLine = phaseCostLine(orgPhases);
    if (faseLine) lines.push(faseLine);

    const outs = outcomesLine(completados);
    if (outs) lines.push(outs);
    lines.push("");
  }

  const silent = eligibleOrgs.filter((o) => !curByOrg.has(o.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const org of silent) {
    const last = lastRealAnalysisByOrg[org.id] ?? null;
    const suffix = last
      ? `${weeksSilentFrom(last, w.endUtc)}ª semana consecutiva sin actividad`
      : "sin análisis desde su alta";
    lines.push(`🔇 ${org.name} — ${suffix}`);
  }
  const infra = infraLine(alerts, "Infra semana");
  if (infra) lines.push(infra);
  if (silent.length || infra) lines.push("");

  lines.push(`Total: ${nLabel(cur.length, "análisis", "análisis")} (vs ${prev.length} previa)`);
  const excl = excludedLine(excluded);
  if (excl) lines.push(excl);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- digest MENSUAL ----------
// Vista de negocio: MoM, uso del plan, mejores del mes, churn interno de usuarios.

export interface MonthlyInput {
  targetDate: string; // cualquier día dentro del mes a reportar
  orgs: OrgRow[];
  users: UserRow[];
  /** Análisis desde el día 1 del mes PREVIO hasta el fin del reportado. */
  analyses: AnalysisRow[];
  alerts: AlertCount[];
  lastRealAnalysisByOrg: Record<string, string | null>;
}

export function buildMonthlyDigest(input: MonthlyInput): string {
  const { orgs, users, analyses, alerts, lastRealAnalysisByOrg } = input;
  const m = monthWindowFor(input.targetDate);
  const pm = monthWindowFor(prevMonthDate(m.startDate));
  const prevTag = monthShort(pm.startDate);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const { eligibleOrgs, isRealAnalysis } = computeEligibility(orgs, users);

  const inCurAll = analyses.filter((a) => inWindow(a.created_at, m.startUtc, m.endUtc));
  const cur = inCurAll.filter(isRealAnalysis);
  const prev = analyses.filter((a) => isRealAnalysis(a) && inWindow(a.created_at, pm.startUtc, pm.endUtc));
  const excluded = inCurAll.length - cur.length;

  const curByOrg = groupByOrgRows(cur);
  const prevByOrg = groupByOrgRows(prev);
  const activeOrgs = eligibleOrgs
    .filter((o) => curByOrg.has(o.id))
    .sort((a, b) => curByOrg.get(b.id)!.length - curByOrg.get(a.id)!.length);

  const lines: string[] = [`🗓️ *AurisIQ* — resumen mensual · ${monthLabel(m.startDate)}`, ""];
  if (!activeOrgs.length) lines.push("Sin análisis en el mes.", "");

  for (const org of activeOrgs) {
    const rows = curByOrg.get(org.id)!;
    const prevRows = prevByOrg.get(org.id) ?? [];
    const completados = rows.filter((a) => a.status === "completado");
    const prevCompletados = prevRows.filter((a) => a.status === "completado");
    const rechazados = rows.filter((a) => a.status === "rechazado").length;
    const curUsers = groupByUserRows(rows);
    const prevUsers = groupByUserRows(prevRows);

    // Nuevos: cuenta creada este mes Y real (no demo)
    const newUsers = [...curUsers.keys()]
      .map((uid) => usersById.get(uid))
      .filter((u): u is UserRow => !!u && createdInWindow(u, m.startUtc, m.endUtc));
    let head = `*${org.name.toUpperCase()}* — ${nLabel(rows.length, "análisis", "análisis")} (${prevTag}: ${prevRows.length}${prevRows.length > 0 ? `, ${Math.round(((rows.length - prevRows.length) / prevRows.length) * 100) >= 0 ? "+" : ""}${Math.round(((rows.length - prevRows.length) / prevRows.length) * 100)}%` : ""})`;
    head += ` · ${nLabel(curUsers.size, "usuario", "usuarios")}`;
    if (newUsers.length) {
      const names = newUsers.slice(0, 2).map((u) => firstName(u)).join(", ");
      head += ` (${nLabel(newUsers.length, "nuevo", "nuevos")}${newUsers.length <= 2 ? `: ${names}` : ""})`;
    }
    lines.push(head);

    // Uso del plan: cuenta TODO el mes de la org (demo incluido — consume cuota)
    const totalOrgMonth = inCurAll.filter((a) => a.organization_id === org.id).length;
    const demoOrgMonth = totalOrgMonth - rows.length;
    const limit = PLAN_LIMITS[org.plan ?? ""] ?? null;
    if (typeof limit === "number" && limit > 0) {
      const pct = Math.round((totalOrgMonth / limit) * 100);
      const flag = pct >= 100 ? " 🔴" : pct >= 80 ? " ⚠️" : "";
      lines.push(`• Uso del plan: ${totalOrgMonth}/${limit} (${pct}%)${flag}${demoOrgMonth > 0 ? " — incluye pruebas" : ""}`);
    }

    // Churn interno: reales con actividad el mes previo y 0 este mes (solo
    // transición). F50: calculado ANTES del bloque de score — la línea de
    // cohorte comparable necesita saber si hubo bajas.
    const offUsers = [...prevUsers.entries()]
      .filter(([uid]) => !curUsers.has(uid))
      .map(([uid, rs]) => ({ name: firstName(usersById.get(uid)), n: rs.length }))
      .sort((a, b) => b.n - a.n);

    const prom = avgScore(completados);
    const promPrev = avgScore(prevCompletados);
    let best: { name: string; score: number } | null = null;
    for (const a of completados) {
      if (typeof a.score_general === "number" && (!best || a.score_general > best.score)) {
        best = { name: firstName(usersById.get(a.user_id ?? "")), score: a.score_general };
      }
    }
    if (prom !== null) {
      // F52: el headline es la línea MÁS leída del mensual y hasta ahora era la
      // única sin candado — el lector se anclaba en ella y el candado de la
      // línea de cohorte quedaba de adorno. Ironía que lo empeoraba: el
      // headline es MENOS confiable que la cohorte, porque mezclar personas
      // distintas infla la varianza. Los dos números siguen mostrándose
      // siempre: lo que se suprime es la insinuación de tendencia.
      let comparativo = "";
      if (promPrev !== null) {
        const dlOrg = deltaLegible(completedScores(prevRows), completedScores(rows));
        const distinguible = dlOrg !== null && dlOrg.legible;
        comparativo = ` (${prevTag}: ${promPrev}${distinguible ? "" : ", sin cambio distinguible"})`;
      }
      let line = `• Score prom: ${prom}${comparativo}`;
      if (best) line += ` · Mejor: ${best.name} ${best.score}`;
      lines.push(line);
      // F50: si la plantilla cambió (altas o bajas), el MoM de arriba mezcla
      // composición con desempeño — esta línea aísla la tendencia real
      // comparando solo a quienes trabajaron ambos meses. Sin altas ni bajas
      // no aparece (cero ruido); sin usuarios en común, avisa en vez de
      // fingir una tendencia.
      if (promPrev !== null && (newUsers.length > 0 || offUsers.length > 0)) {
        const cohorte = cohortAvgs(curUsers, prevUsers);
        if (cohorte.n === 0) {
          lines.push(`• ⚠️ Cero usuarios en común con ${prevTag} — el promedio de equipo NO es comparable`);
        } else if (cohorte.prevAvg !== null && cohorte.curAvg !== null) {
          // F51: los dos promedios se muestran siempre (informan aunque la
          // diferencia no sea distinguible), pero el delta solo va en número
          // si supera el umbral de ruido — si no, "(≈)".
          const comunes = [...curUsers.keys()].filter((uid) => prevUsers.has(uid)); // misma definición de cohorte que cohortAvgs
          const dl = deltaLegible(
            completedScores(comunes.flatMap((uid) => prevUsers.get(uid)!)),
            completedScores(comunes.flatMap((uid) => curUsers.get(uid)!)),
          );
          const deltaTxt = dl && dl.legible ? signedDelta(dl.delta) : "≈";
          lines.push(`• A plantilla comparable (${nLabel(cohorte.n, "usuario", "usuarios")} en ambos meses): ${cohorte.prevAvg} → ${cohorte.curAvg} (${deltaTxt})`);
        }
      }
    }

    const pctPrev = qualifiedPct(prevCompletados);
    const leads = leadsLine(completados);
    if (leads) {
      lines.push(pctPrev !== null ? leads.replace(/%\)/, `%, ${prevTag}: ${pctPrev}%)`) : leads);
    }
    const descal = topDescalLine(completados);
    if (descal) lines.push(descal);

    if (offUsers.length) {
      const shown = offUsers.slice(0, 3).map((e) => `${e.name} (${e.n} en ${prevTag} → 0)`).join(" · ");
      lines.push(`• Se apagaron: ${shown}${offUsers.length > 3 ? ` · +${offUsers.length - 3} más` : ""}`);
    }

    if (rechazados > 0) {
      lines.push(`• Rechazados: ${rechazados} (${Math.round((rechazados / rows.length) * 100)}%)`);
    }
    lines.push("");
  }

  const silent = eligibleOrgs.filter((o) => !curByOrg.has(o.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const org of silent) {
    const last = lastRealAnalysisByOrg[org.id] ?? null;
    const suffix = last
      ? `${monthsSilentFrom(last, m.startDate)}º mes sin actividad`
      : "sin análisis desde su alta";
    lines.push(`🔇 ${org.name} — ${suffix}`);
  }
  const infra = infraLine(alerts, "Infra del mes");
  if (infra) lines.push(infra);
  if (silent.length || infra) lines.push("");

  lines.push(`Total: ${nLabel(cur.length, "análisis", "análisis")} (${prevTag}: ${prev.length}) · orgs con actividad: ${activeOrgs.length}`);
  const excl = excludedLine(excluded);
  if (excl) lines.push(excl);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
