// Tests del formatter del daily digest. Fixtures 100% sintéticos — sin PII.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AnalysisRow,
  bearerRole,
  buildDigest,
  defaultTargetDate,
  type DigestInput,
  fechaLabel,
  isDemoUser,
  type OrgRow,
  type UserRow,
  windowForDate,
} from "./digest.ts";

const ORG_A: OrgRow = { id: "org-a", name: "Acme Inmuebles", slug: "acme", access_status: "active" };
const ORG_B: OrgRow = { id: "org-b", name: "Beta Pagos", slug: "beta", access_status: "active" };
const ORG_SHELL: OrgRow = { id: "org-shell", name: "Shell Demo", slug: "shell", access_status: "active" };

const USERS: UserRow[] = [
  { id: "u-ana", organization_id: "org-a", name: "Ana López", email: "ana@acme.mx", training_mode: false, active: true },
  { id: "u-luis", organization_id: "org-a", name: "Luis Pérez", email: "luis@acme.mx", training_mode: false, active: true },
  { id: "u-demo", organization_id: "org-a", name: "Demo Captadora", email: "anwarhsg+captadora@gmail.com", training_mode: false, active: true },
  { id: "u-train", organization_id: "org-a", name: "Trainee", email: "trainee@acme.mx", training_mode: true, active: true },
  { id: "u-beto", organization_id: "org-b", name: "Beto Ruiz", email: "beto@beta.mx", training_mode: false, active: true },
  { id: "u-shell", organization_id: "org-shell", name: "Demo Shell", email: "anwarhsg+shell@gmail.com", training_mode: false, active: true },
];

// Día objetivo: 2026-08-05 (ventana CDMX = 06:00Z del 5 a 06:00Z del 6)
const D = "2026-08-05";
const IN_DAY = "2026-08-05T18:00:00Z";

function mkAnalysis(over: Partial<AnalysisRow>): AnalysisRow {
  return {
    organization_id: "org-a",
    user_id: "u-ana",
    status: "completado",
    score_general: 60,
    lead_quality: "calificado",
    lead_outcome: "cerrado_parcial",
    created_at: IN_DAY,
    ...over,
  };
}

function baseInput(over: Partial<DigestInput>): DigestInput {
  return {
    targetDate: D,
    orgs: [ORG_A, ORG_B, ORG_SHELL],
    users: USERS,
    analyses: [],
    alerts: [],
    lastRealAnalysisByOrg: {},
    ...over,
  };
}

Deno.test("windowForDate: día CDMX = 06:00Z a 06:00Z (offset fijo -06:00)", () => {
  const { startUtc, endUtc } = windowForDate(D);
  assertEquals(startUtc.toISOString(), "2026-08-05T06:00:00.000Z");
  assertEquals(endUtc.toISOString(), "2026-08-06T06:00:00.000Z");
});

Deno.test("defaultTargetDate: madrugada UTC del 6 → ayer es 5 en CDMX", () => {
  // 6-ago 13:30Z (hora del cron) = 6-ago 07:30 CDMX → target 5-ago
  assertEquals(defaultTargetDate(new Date("2026-08-06T13:30:00Z")), "2026-08-05");
  // 6-ago 03:00Z = 5-ago 21:00 CDMX → target 4-ago
  assertEquals(defaultTargetDate(new Date("2026-08-06T03:00:00Z")), "2026-08-04");
});

Deno.test("isDemoUser: anwarhsg+ y training_mode son demo; cliente real no", () => {
  assertEquals(isDemoUser(USERS[2]), true);
  assertEquals(isDemoUser(USERS[3]), true);
  assertEquals(isDemoUser(USERS[0]), false);
});

Deno.test("día normal: bloque org, usuarios, leads, outcomes y semana", () => {
  const text = buildDigest(baseInput({
    analyses: [
      mkAnalysis({}),
      mkAnalysis({ user_id: "u-ana", score_general: 50, lead_quality: "descalificado", lead_outcome: "pospuesto_sin_agenda" }),
      mkAnalysis({ user_id: "u-luis", score_general: 40, lead_quality: "indeterminado", lead_outcome: "pospuesto_sin_agenda" }),
    ],
  }));
  assertStringIncludes(text, "*ACME INMUEBLES* — 3 análisis · 2 usuarios");
  assertStringIncludes(text, "Ana: 2 · prom 55");
  assertStringIncludes(text, "Luis: 1 · prom 40");
  assertStringIncludes(text, "Leads: 1 calificado · 1 descalificado · 1 indeterminado");
  assertStringIncludes(text, "Outcomes: 2 pospuesto_sin_agenda · 1 cerrado_parcial");
  assertStringIncludes(text, "Semana: 3 análisis (vs 0 previa)");
});

Deno.test("demo y training se excluyen + línea de transparencia", () => {
  const text = buildDigest(baseInput({
    analyses: [
      mkAnalysis({}),
      mkAnalysis({ user_id: "u-demo" }),
      mkAnalysis({ user_id: "u-train" }),
    ],
  }));
  assertStringIncludes(text, "1 análisis · 1 usuario");
  assertStringIncludes(text, "Excluidos: 2 análisis demo/training");
  assertEquals(text.includes("Demo"), false);
});

Deno.test("org shell (solo user demo) jamás aparece — ni activa ni en silencio", () => {
  const text = buildDigest(baseInput({ analyses: [mkAnalysis({})] }));
  assertEquals(text.includes("Shell"), false);
});

Deno.test("rechazados y en proceso aparecen solo cuando existen", () => {
  const conMezcla = buildDigest(baseInput({
    analyses: [
      mkAnalysis({}),
      mkAnalysis({ status: "rechazado", score_general: null, lead_quality: null }),
      mkAnalysis({ status: "pending", score_general: null, lead_quality: null }),
    ],
  }));
  assertStringIncludes(conMezcla, "(1 completado · 1 rechazado · 1 en proceso)");
  const soloOk = buildDigest(baseInput({ analyses: [mkAnalysis({})] }));
  assertEquals(soloOk.includes("completado)"), false);
});

Deno.test("lead_quality null en completado → bucket 'sin dato' (detector F47 manual)", () => {
  const text = buildDigest(baseInput({
    analyses: [mkAnalysis({ lead_quality: null, lead_outcome: null })],
  }));
  assertStringIncludes(text, "Leads: 1 sin dato");
});

Deno.test("día vacío: 'Sin análisis' + orgs en silencio con historial honesto", () => {
  const text = buildDigest(baseInput({
    lastRealAnalysisByOrg: { "org-a": "2026-08-02T18:00:00Z", "org-b": null },
  }));
  assertStringIncludes(text, "Sin análisis.");
  assertStringIncludes(text, "🔇 Acme Inmuebles — último análisis hace 3 días");
  assertStringIncludes(text, "🔇 Beta Pagos — sin análisis desde su alta");
});

Deno.test("alertas de infra agregadas por tipo", () => {
  const text = buildDigest(baseInput({
    analyses: [mkAnalysis({})],
    alerts: [
      { error_type: "parser:partial_extraction", count: 2 },
      { error_type: "anthropic:overloaded", count: 1 },
    ],
  }));
  assertStringIncludes(text, "⚠️ Infra: 3 alertas (parser:partial_extraction ×2 · anthropic:overloaded)");
});

Deno.test(">4 orgs con actividad → detalle por usuario colapsado", () => {
  const orgs: OrgRow[] = [];
  const users: UserRow[] = [];
  const analyses: AnalysisRow[] = [];
  for (let i = 0; i < 5; i++) {
    orgs.push({ id: `o${i}`, name: `Org ${i}`, slug: `o${i}`, access_status: "active" });
    users.push({ id: `v${i}`, organization_id: `o${i}`, name: `Vendedor ${i}`, email: `v${i}@x.mx`, training_mode: false, active: true });
    analyses.push(mkAnalysis({ organization_id: `o${i}`, user_id: `v${i}` }));
  }
  const text = buildDigest(baseInput({ orgs, users, analyses }));
  assertStringIncludes(text, "*ORG 0* — 1 análisis · 1 usuario");
  assertEquals(text.includes("Vendedor"), false);
});

Deno.test("header con fecha en español", () => {
  const label = fechaLabel(D);
  assertStringIncludes(label.toLowerCase(), "5");
  const text = buildDigest(baseInput({}));
  assertStringIncludes(text, `📊 *AurisIQ* — ${label}`);
});

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: Record<string, unknown>) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma-fake`;
}

Deno.test("bearerRole: service_role pasa, anon no, basura no", () => {
  assertEquals(bearerRole(`Bearer ${fakeJwt({ role: "service_role" })}`), "service_role");
  assertEquals(bearerRole(`Bearer ${fakeJwt({ role: "anon" })}`), "anon");
  assertEquals(bearerRole(`Bearer ${fakeJwt({})}`), null);
  assertEquals(bearerRole("Bearer no-es-jwt"), null);
  assertEquals(bearerRole("Bearer a.b"), null);
  assertEquals(bearerRole(null), null);
  assertEquals(bearerRole(""), null);
});

Deno.test("cero PII de prospectos en el mensaje (tipos no lo permiten, doble check)", () => {
  const text = buildDigest(baseInput({ analyses: [mkAnalysis({})] }));
  assertEquals(/prospect|teléfono|phone/i.test(text), false);
});

// ================= WEEKLY / MONTHLY =================
import {
  buildMonthlyDigest,
  buildWeeklyDigest,
  mondayOf,
  type MonthlyInput,
  monthLabel,
  monthWindowFor,
  type PhaseRow,
  prevMonthDate,
  type WeeklyInput,
  weekWindowFor,
} from "./digest.ts";

// Semana objetivo: 3–9 ago 2026 (contiene el 2026-08-05). Previa: 27 jul – 2 ago.
const WD = "2026-08-05";
const IN_WEEK = "2026-08-04T18:00:00Z";
const IN_PREV_WEEK = "2026-07-29T18:00:00Z";

function weeklyInput(over: Partial<WeeklyInput>): WeeklyInput {
  return {
    targetDate: WD,
    orgs: [ORG_A, ORG_B, ORG_SHELL],
    users: USERS,
    analyses: [],
    phases: [],
    alerts: [],
    lastRealAnalysisByOrg: {},
    ...over,
  };
}

Deno.test("mondayOf: miércoles, domingo y lunes de la misma semana → mismo lunes", () => {
  assertEquals(mondayOf("2026-08-05"), "2026-08-03");
  assertEquals(mondayOf("2026-08-09"), "2026-08-03");
  assertEquals(mondayOf("2026-08-03"), "2026-08-03");
});

Deno.test("weekWindowFor: lun 06:00Z → lun siguiente 06:00Z, endDate domingo", () => {
  const w = weekWindowFor("2026-08-05");
  assertEquals(w.startUtc.toISOString(), "2026-08-03T06:00:00.000Z");
  assertEquals(w.endUtc.toISOString(), "2026-08-10T06:00:00.000Z");
  assertEquals(w.endDate, "2026-08-09");
});

Deno.test("monthWindowFor + prevMonthDate: julio completo y cruce de año", () => {
  const m = monthWindowFor("2026-07-15");
  assertEquals(m.startUtc.toISOString(), "2026-07-01T06:00:00.000Z");
  assertEquals(m.endUtc.toISOString(), "2026-08-01T06:00:00.000Z");
  assertEquals(m.endDate, "2026-07-31");
  assertEquals(prevMonthDate("2026-01-15"), "2025-12-01");
  assertStringIncludes(monthLabel("2026-07-01").toLowerCase(), "julio");
});

Deno.test("weekly: delta por usuario vs SU semana previa; sin previa → sin paréntesis", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_WEEK, score_general: 60 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 50 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 50 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_WEEK, score_general: 40 }),
    ],
  }));
  assertStringIncludes(text, "Ana: 2 · prom 55 (+5)");
  assertStringIncludes(text, "Luis: 1 · prom 40");
  assertEquals(text.includes("Luis: 1 · prom 40 ("), false);
  assertStringIncludes(text, "(vs 1, +200%)");
  assertStringIncludes(text, "Total: 3 análisis (vs 1 previa)");
});

Deno.test("weekly: (nuevo) solo si la cuenta se creó dentro de la semana", () => {
  const users = USERS.map((u) => u.id === "u-luis" ? { ...u, created_at: IN_WEEK } : { ...u, created_at: "2026-01-01T12:00:00Z" });
  const text = buildWeeklyDigest(weeklyInput({
    users,
    analyses: [
      mkAnalysis({ created_at: IN_WEEK }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_WEEK, score_general: 40 }),
    ],
  }));
  assertStringIncludes(text, "Luis: 1 · prom 40 (nuevo)");
  assertEquals(text.includes("Ana: 1 · prom 60 (nuevo)"), false);
});

Deno.test("weekly: % calificados excluye 'sin dato' del denominador (espejo F47)", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_WEEK, lead_quality: "calificado" }),
      mkAnalysis({ created_at: IN_WEEK, lead_quality: "calificado" }),
      mkAnalysis({ created_at: IN_WEEK, lead_quality: "descalificado" }),
      mkAnalysis({ created_at: IN_WEEK, lead_quality: null }),
    ],
  }));
  assertStringIncludes(text, "2 calificados (67%)");
  assertStringIncludes(text, "1 sin dato");
});

Deno.test("weekly: fase más débil con gate POR FASE n>=5 — n=2 no gana aunque sea peor", () => {
  const phases: PhaseRow[] = [];
  for (let i = 0; i < 5; i++) {
    phases.push({ organization_id: "org-a", user_id: "u-ana", phase_name: "Cierre", score: 5, score_max: 10, created_at: IN_WEEK });
  }
  phases.push({ organization_id: "org-a", user_id: "u-ana", phase_name: "Rara", score: 1, score_max: 10, created_at: IN_WEEK });
  phases.push({ organization_id: "org-a", user_id: "u-ana", phase_name: "Rara", score: 1, score_max: 10, created_at: IN_WEEK });
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [mkAnalysis({ created_at: IN_WEEK })],
    phases,
  }));
  assertStringIncludes(text, "Fase más débil: Cierre (50% del máximo)");
  assertEquals(text.includes("Rara"), false);
});

Deno.test("weekly: racha de silencio con ordinal y top descalificación", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_WEEK, categoria_descalificacion: ["adeudo_alto", "juridico"] }),
      mkAnalysis({ created_at: IN_WEEK, categoria_descalificacion: ["adeudo_alto"] }),
    ],
    lastRealAnalysisByOrg: { "org-b": "2026-07-26T18:00:00Z" }, // 15 días antes del fin → 2ª semana
  }));
  assertStringIncludes(text, "Top descalificación: adeudo_alto ×2 · juridico ×1");
  assertStringIncludes(text, "🔇 Beta Pagos — 2ª semana consecutiva sin actividad");
});

// Mes objetivo: julio 2026. Previo: junio.
const IN_JUL = "2026-07-10T18:00:00Z";
const IN_JUN = "2026-06-10T18:00:00Z";

function monthlyInput(over: Partial<MonthlyInput>): MonthlyInput {
  return {
    targetDate: "2026-07-15",
    orgs: [{ ...ORG_A, plan: "founder" }, { ...ORG_B, plan: "founder" }, ORG_SHELL],
    users: USERS,
    analyses: [],
    alerts: [],
    lastRealAnalysisByOrg: {},
    ...over,
  };
}

Deno.test("monthly: MoM, uso del plan con demo incluido y ⚠️ desde 80%", () => {
  const analyses = [];
  for (let i = 0; i < 40; i++) analyses.push(mkAnalysis({ created_at: IN_JUL }));
  for (let i = 0; i < 3; i++) analyses.push(mkAnalysis({ user_id: "u-demo", created_at: IN_JUL }));
  for (let i = 0; i < 28; i++) analyses.push(mkAnalysis({ created_at: IN_JUN }));
  const text = buildMonthlyDigest(monthlyInput({ analyses }));
  assertStringIncludes(text, "40 análisis (jun: 28, +43%)");
  assertStringIncludes(text, "Uso del plan: 43/50 (86%) ⚠️ — incluye pruebas");
  assertStringIncludes(text, "Total: 40 análisis (jun: 28) · orgs con actividad: 1");
  assertStringIncludes(text, "Excluidos: 3 análisis demo/training");
});

Deno.test("monthly: score prom MoM, mejor del mes y % calificados con referencia MoM", () => {
  const text = buildMonthlyDigest(monthlyInput({
    analyses: [
      mkAnalysis({ created_at: IN_JUL, score_general: 84, lead_quality: "calificado" }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_JUL, score_general: 40, lead_quality: "descalificado" }),
      mkAnalysis({ created_at: IN_JUN, score_general: 54, lead_quality: "descalificado" }),
    ],
  }));
  assertStringIncludes(text, "Score prom: 62 (jun: 54) · Mejor: Ana 84");
  assertStringIncludes(text, "1 calificado (50%, jun: 0%)");
});

Deno.test("monthly: 'se apagaron' solo en el mes de transición + meses de silencio ordinal", () => {
  const text = buildMonthlyDigest(monthlyInput({
    analyses: [
      mkAnalysis({ created_at: IN_JUL }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_JUN, score_general: 50 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_JUN, score_general: 50 }),
    ],
    lastRealAnalysisByOrg: { "org-b": "2026-05-20T18:00:00Z" }, // mayo → julio = 2º mes
  }));
  assertStringIncludes(text, "Se apagaron: Luis (2 en jun → 0)");
  assertStringIncludes(text, "🔇 Beta Pagos — 2º mes sin actividad");
});

Deno.test("monthly: rechazados con % y sin línea de plan si el plan no tiene límite", () => {
  const orgs = [{ ...ORG_A, plan: "enterprise" }, { ...ORG_B, plan: "founder" }, ORG_SHELL];
  const text = buildMonthlyDigest(monthlyInput({
    orgs,
    analyses: [
      mkAnalysis({ created_at: IN_JUL }),
      mkAnalysis({ created_at: IN_JUL, status: "rechazado", score_general: null, lead_quality: null }),
    ],
  }));
  assertStringIncludes(text, "Rechazados: 1 (50%)");
  assertEquals(text.includes("Uso del plan"), false);
});
