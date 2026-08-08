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
  cohortAvgs,
  deltaLegible,
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
  // F51: 2 llamadas actuales < DELTA_MIN_N → el delta ya no se imprime
  assertStringIncludes(text, "Ana: 2 · prom 55");
  assertEquals(text.includes("Ana: 2 · prom 55 ("), false);
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

Deno.test("weekly: gate POR FASE n>=5 — n=2 no gana aunque sea peor; fase única corona sin comparación", () => {
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
  // F52: puntos perdidos por llamada; sin rival que supere el gate no hay
  // comparación que hacer, así que corona sin declarar empate.
  assertStringIncludes(text, "Fase más cara: Cierre (5.0 pts por llamada)");
  assertEquals(text.includes("empatadas"), false);
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
  // F52: con 2 vs 1 análisis la diferencia no es estimable → coletilla honesta
  assertStringIncludes(text, "Score prom: 62 (jun: 54, sin cambio distinguible) · Mejor: Ana 84");
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

// ================= F50: antídoto de composición (Simpson) =================

Deno.test("cohortAvgs: compara solo a los usuarios presentes en ambos periodos", () => {
  const cur = new Map([
    ["u-ana", [mkAnalysis({ score_general: 60 })]],
    ["u-nuevo", [mkAnalysis({ user_id: "u-nuevo", score_general: 20 })]],
  ]);
  const prev = new Map([
    ["u-ana", [mkAnalysis({ score_general: 50 })]],
    ["u-se-fue", [mkAnalysis({ user_id: "u-se-fue", score_general: 90 })]],
  ]);
  assertEquals(cohortAvgs(cur, prev), { n: 1, prevAvg: 50, curAvg: 60 });
});

Deno.test("cohortAvgs: sin usuarios en común → n=0 y promedios null", () => {
  const cur = new Map([["u-a", [mkAnalysis({})]]]);
  const prev = new Map([["u-b", [mkAnalysis({ user_id: "u-b" })]]]);
  assertEquals(cohortAvgs(cur, prev), { n: 0, prevAvg: null, curAvg: null });
});

Deno.test("monthly F50: caso real Inmobili — el MoM cae por composición, la cohorte sube", () => {
  const users: UserRow[] = [
    { id: "u-miguel", organization_id: "org-a", name: "Miguel Ferrer", email: "miguel@acme.mx", training_mode: false, active: true },
    { id: "u-eli", organization_id: "org-a", name: "Elizabeth Zubiri", email: "eli@acme.mx", training_mode: false, active: true },
    { id: "u-novata", organization_id: "org-a", name: "Novata Prueba", email: "novata@acme.mx", training_mode: false, active: true, created_at: IN_JUL },
  ];
  const text = buildMonthlyDigest(monthlyInput({
    users,
    analyses: [
      mkAnalysis({ user_id: "u-miguel", created_at: IN_JUN, score_general: 50 }),
      mkAnalysis({ user_id: "u-eli", created_at: IN_JUN, score_general: 90 }),
      mkAnalysis({ user_id: "u-miguel", created_at: IN_JUL, score_general: 56 }),
      mkAnalysis({ user_id: "u-novata", created_at: IN_JUL, score_general: 20 }),
    ],
  }));
  assertStringIncludes(text, "Score prom: 38 (jun: 70, sin cambio distinguible)");
  // F51: cohorte de 1 llamada por lado < DELTA_MIN_N → los promedios se
  // muestran pero el delta no es estimable → "(≈)"
  assertStringIncludes(text, "A plantilla comparable (1 usuario en ambos meses): 50 → 56 (≈)");
  assertStringIncludes(text, "Se apagaron: Elizabeth");
  assertStringIncludes(text, "(1 nuevo: Novata)");
});

Deno.test("monthly F50: sin altas ni bajas → cero ruido, la línea de cohorte no aparece", () => {
  const text = buildMonthlyDigest(monthlyInput({
    analyses: [
      mkAnalysis({ created_at: IN_JUN, score_general: 50 }),
      mkAnalysis({ created_at: IN_JUL, score_general: 60 }),
    ],
  }));
  assertStringIncludes(text, "Score prom: 60 (jun: 50, sin cambio distinguible)");
  assertEquals(text.includes("plantilla comparable"), false);
});

Deno.test("monthly F50: recambio total → avisa que el promedio NO es comparable", () => {
  const text = buildMonthlyDigest(monthlyInput({
    analyses: [
      mkAnalysis({ created_at: IN_JUN, score_general: 50 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_JUL, score_general: 30 }),
    ],
  }));
  assertStringIncludes(text, "Cero usuarios en común con jun — el promedio de equipo NO es comparable");
});

// ================= F51: candado estadístico de deltas =================

Deno.test("deltaLegible: caso real jun vs jul del mismo captador → NO legible (t no significativa)", () => {
  const prev = [85, 89, 57, 38];
  const cur = [69, 52, 62, 57, 42, 38, 62, 62, 58, 28, 64, 67, 41, 28, 56, 62, 16, 58, 38, 72];
  const r = deltaLegible(prev, cur);
  assertEquals(r !== null, true);
  assertEquals(r!.legible, false);
});

Deno.test("deltaLegible: separación real y n suficiente → legible", () => {
  const r = deltaLegible([20, 25, 30], [80, 85, 90]);
  assertEquals(r !== null, true);
  assertEquals(r!.legible, true);
});

Deno.test("deltaLegible: menos de 3 llamadas en un periodo → null (varianza no estimable)", () => {
  assertEquals(deltaLegible([50, 50], [80, 80, 80]), null);
  // El gate corta por AMBOS lados: pocas llamadas esta semana es tan poco
  // estimable como pocas la previa (si solo se cubriera na, un usuario con 5
  // llamadas previas y 1 esta semana recibiría delta calculado sobre n=1).
  assertEquals(deltaLegible([50, 50, 50], [80, 80]), null);
});

Deno.test("deltaLegible: frontera del umbral 2·SE — 10 puntos legible, 8 no (misma dispersión)", () => {
  // sd pooled = 5 → SE = 4.08 (el piso de 2 no muerde) → umbral = 8.16.
  // Fija el coeficiente 2 por ambos lados: con 4·SE el primero dejaría de ser
  // legible; con 1.9·SE el segundo pasaría a serlo.
  assertEquals(deltaLegible([20, 25, 30], [30, 35, 40]), { delta: 10, legible: true });
  assertEquals(deltaLegible([20, 25, 30], [28, 33, 38]), { delta: 8, legible: false });
});

Deno.test("deltaLegible: scores idénticos → delta 0, NO legible (piso de SE evita falsa confianza)", () => {
  assertEquals(deltaLegible([60, 60, 60], [60, 60, 60]), { delta: 0, legible: false });
});

Deno.test("weekly F51: 3+ llamadas ambas semanas con diferencia chica → (≈), sin delta numérico", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_WEEK, score_general: 60 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 62 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 58 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 58 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 60 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 59 }),
    ],
  }));
  assertStringIncludes(text, "Ana: 3 · prom 60 (≈)");
  assertEquals(text.includes("Ana: 3 · prom 60 (+"), false);
});

Deno.test("weekly F51: delta legible SÍ se publica como número con signo (candado no sobre-suprime)", () => {
  // Contraparte obligatoria del test de "(≈)": sin esta aserción, una
  // implementación que silenciara TODOS los deltas pasaría la suite en verde.
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 20 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 25 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 30 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 80 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 85 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 90 }),
    ],
  }));
  assertStringIncludes(text, "Ana: 3 · prom 85 (+60)");
});

Deno.test("weekly F51: menos de 3 llamadas en una semana → entrada sin paréntesis de delta", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_WEEK, score_general: 60 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 62 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 58 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 50 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 50 }),
    ],
  }));
  assertStringIncludes(text, "Ana: 3 · prom 60");
  assertEquals(text.includes("Ana: 3 · prom 60 ("), false);
});

Deno.test("weekly F51: (nuevo) gana sobre cualquier delta, aunque fuera legible", () => {
  const users = USERS.map((u) =>
    u.id === "u-luis" ? { ...u, created_at: IN_WEEK } : { ...u, created_at: "2026-01-01T12:00:00Z" }
  );
  const text = buildWeeklyDigest(weeklyInput({
    users,
    analyses: [
      mkAnalysis({ user_id: "u-luis", created_at: IN_WEEK, score_general: 80 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_WEEK, score_general: 85 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_WEEK, score_general: 90 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_PREV_WEEK, score_general: 20 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_PREV_WEEK, score_general: 25 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_PREV_WEEK, score_general: 30 }),
    ],
  }));
  assertStringIncludes(text, "Luis: 3 · prom 85 (nuevo)");
  assertEquals(text.includes("(+60)"), false);
});

Deno.test("monthly F51: cohorte con diferencia no distinguible → la línea termina en (≈)", () => {
  const users: UserRow[] = [
    { id: "u-vet", organization_id: "org-a", name: "Valeria Ferrer", email: "valeria@acme.mx", training_mode: false, active: true },
    { id: "u-baja", organization_id: "org-a", name: "Brenda Zubiri", email: "brenda@acme.mx", training_mode: false, active: true },
  ];
  const text = buildMonthlyDigest(monthlyInput({
    users,
    analyses: [
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUN, score_general: 60 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUN, score_general: 62 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUN, score_general: 58 }),
      mkAnalysis({ user_id: "u-baja", created_at: IN_JUN, score_general: 70 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUL, score_general: 59 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUL, score_general: 61 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUL, score_general: 60 }),
    ],
  }));
  assertStringIncludes(text, "A plantilla comparable (1 usuario en ambos meses): 60 → 60 (≈)");
});

Deno.test("monthly F51: cohorte con mejora distinguible → la línea publica el delta con signo", () => {
  const users: UserRow[] = [
    { id: "u-vet", organization_id: "org-a", name: "Valeria Ferrer", email: "valeria@acme.mx", training_mode: false, active: true },
    { id: "u-baja", organization_id: "org-a", name: "Brenda Zubiri", email: "brenda@acme.mx", training_mode: false, active: true },
  ];
  const text = buildMonthlyDigest(monthlyInput({
    users,
    analyses: [
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUN, score_general: 20 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUN, score_general: 25 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUN, score_general: 30 }),
      mkAnalysis({ user_id: "u-baja", created_at: IN_JUN, score_general: 70 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUL, score_general: 80 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUL, score_general: 85 }),
      mkAnalysis({ user_id: "u-vet", created_at: IN_JUL, score_general: 90 }),
    ],
  }));
  assertStringIncludes(text, "A plantilla comparable (1 usuario en ambos meses): 25 → 85 (+60)");
});

// ================= F52: candado en headline mensual y fase sin corona espuria =================

// Ciclo de valores de "puntos perdidos" con la dispersión REAL de producción
// (SE ~0.7-0.9 sobre 79 llamadas), no una muestra artificialmente apretada:
// con SE de juguete cualquier diferencia parece separación.
function phaseRows(name: string, patron: number[], n = 79): PhaseRow[] {
  return Array.from({ length: n }, (_, i) => ({
    organization_id: "org-a",
    user_id: "u-ana",
    phase_name: name,
    score: 30 - patron[i % patron.length],
    score_max: 30,
    created_at: IN_WEEK,
  }));
}

const PAT_138 = [23, 5, 14, 13]; // media 13.76, SE 0.73
const PAT_133 = [22, 5, 13, 13]; // media 13.25, SE 0.69
const PAT_67 = [15, 0, 7, 5]; //   media 6.77,  SE 0.62

Deno.test("weekly F52: primer lugar por 0.5 pts con SE ~0.7 → NO corona, reporta empate y nombra a las dos", () => {
  // Caso real medido sobre 79 llamadas: 13.81 (SE 0.86) vs 13.28 (SE 0.77),
  // t=0.46. Coronar aquí manda al equipo a entrenar la fase equivocada la
  // mitad de las veces.
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [mkAnalysis({ created_at: IN_WEEK })],
    phases: [...phaseRows("Expectativa y Precio", PAT_138), ...phaseRows("Calificación de la Propiedad", PAT_133)],
  }));
  assertStringIncludes(text, "empatadas");
  assertStringIncludes(text, "Expectativa y Precio");
  assertStringIncludes(text, "Calificación de la Propiedad");
  assertStringIncludes(text, "13.8 y 13.3 pts, empatadas");
  assertEquals(text.includes("Fase más cara:"), false);
});

Deno.test("weekly F52: separación real (13.8 vs 6.7) → corona una sola, sin empate", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [mkAnalysis({ created_at: IN_WEEK })],
    phases: [...phaseRows("Expectativa y Precio", PAT_138), ...phaseRows("Avance a Visita", PAT_67)],
  }));
  assertStringIncludes(text, "Fase más cara: Expectativa y Precio (13.8 pts por llamada)");
  assertEquals(text.includes("empatadas"), false);
  assertEquals(text.includes("Avance a Visita"), false);
});

function scoreLine(text: string): string {
  return text.split("\n").find((l) => l.includes("Score prom:")) ?? "";
}

Deno.test("monthly F52: headline con diferencia dentro del ruido → 'sin cambio distinguible', sin insinuar tendencia", () => {
  // Escenario real: 67 → 55 con dispersión de ~18 puntos por llamada. La caída
  // de 12 puntos NO supera el umbral, y era justo la línea que el lector leía
  // como desplome mientras el candado de abajo quedaba de adorno.
  const analyses = [];
  for (const s of [85, 89, 57, 38, 66]) analyses.push(mkAnalysis({ created_at: IN_JUN, score_general: s }));
  for (const s of [69, 52, 62, 28, 64]) analyses.push(mkAnalysis({ created_at: IN_JUL, score_general: s }));
  const text = buildMonthlyDigest(monthlyInput({ analyses }));
  const linea = scoreLine(text);
  assertStringIncludes(linea, "Score prom: 55 (jun: 67, sin cambio distinguible)");
  // Los dos números siguen ahí; lo que no puede aparecer es señal de tendencia.
  assertEquals(linea.includes("%"), false);
  assertEquals(linea.includes("→"), false);
  assertEquals(/\([+-]\d/.test(linea), false);
});

Deno.test("monthly F52: headline con diferencia distinguible → formato actual, sin coletilla", () => {
  const analyses = [];
  for (const s of [20, 25, 30]) analyses.push(mkAnalysis({ created_at: IN_JUN, score_general: s }));
  for (const s of [80, 85, 90]) analyses.push(mkAnalysis({ created_at: IN_JUL, score_general: s }));
  const text = buildMonthlyDigest(monthlyInput({ analyses }));
  const linea = scoreLine(text);
  assertStringIncludes(linea, "Score prom: 85 (jun: 25)");
  assertEquals(linea.includes("sin cambio distinguible"), false);
});

// Golden del daily: F52 no toca buildDigest y este test lo fija byte a byte.
const DAILY_GOLDEN = "📊 *AurisIQ* — miércoles 5 ago\n\n*ACME INMUEBLES* — 3 análisis · 2 usuarios\n• Ana: 2 · prom 55  ·  Luis: 1 · prom 40\n• Leads: 1 calificado · 1 descalificado · 1 indeterminado\n• Outcomes: 2 pospuesto_sin_agenda · 1 cerrado_parcial\n\n🔇 Beta Pagos — sin análisis desde su alta\n\nSemana: 3 análisis (vs 0 previa)";

Deno.test("daily F52: no-regresión byte a byte — el builder diario no se toca", () => {
  const text = buildDigest(baseInput({
    analyses: [
      mkAnalysis({}),
      mkAnalysis({ user_id: "u-ana", score_general: 50, lead_quality: "descalificado", lead_outcome: "pospuesto_sin_agenda" }),
      mkAnalysis({ user_id: "u-luis", score_general: 40, lead_quality: "indeterminado", lead_outcome: "pospuesto_sin_agenda" }),
    ],
  }));
  assertEquals(text, DAILY_GOLDEN);
});

// ================= F52b: el veredicto compara sin redondear =================

// Datos reales de producción (solo scores, sin nombres): jun vs jul de la org
// con más volumen. Es el caso que delataba el defecto.
const ORO_PREV = [30, 38, 38, 41, 57, 64, 72, 75, 77, 85, 85, 89, 91, 92]; // media 66.7143
const ORO_CUR = [16, 28, 28, 34, 38, 38, 38, 41, 42, 52, 52, 53, 56, 57, 58, 58, 62, 62, 62, 62, 62, 64, 65, 67, 67, 69, 70, 72, 74, 75, 75, 78]; // media 55.4688

Deno.test("F52b caso de oro: el redondeo cruzaba el umbral y publicaba una caída inexistente", () => {
  // sd pooled 17.94 · SE 5.7486 · 2·SE 11.4971
  // |mb-ma| = 11.2455 < 11.4971            → NO distinguible (correcto)
  // |round(mb)-round(ma)| = 12 >= 11.4971  → así se veía antes (el defecto)
  const r = deltaLegible(ORO_PREV, ORO_CUR);
  assertEquals(r !== null, true);
  // El delta de RENDER no cambia; lo que cambia es el veredicto.
  assertEquals(r!.delta, -12);
  assertEquals(r!.legible, false);
});

Deno.test("F52b render end-to-end: con el caso de oro el headline usa el fallback, no el número", () => {
  const analyses = [];
  for (const s of ORO_PREV) analyses.push(mkAnalysis({ created_at: IN_JUN, score_general: s }));
  for (const s of ORO_CUR) analyses.push(mkAnalysis({ created_at: IN_JUL, score_general: s }));
  const text = buildMonthlyDigest(monthlyInput({ analyses }));
  assertStringIncludes(scoreLine(text), "Score prom: 55 (jun: 67, sin cambio distinguible)");
});

Deno.test("F52b frontera inversa: el redondeo también SUPRIME señal real", () => {
  // |mb-ma| = 9.8 >= 2·SE 9.06 → distinguible; pero round(20.4)-round(10.6) = 9
  // habría quedado por debajo del umbral y la señal real se habría perdido.
  const r = deltaLegible([2, 6, 10, 14, 21], [12, 16, 20, 24, 30]);
  assertEquals(r, { delta: 9, legible: true });
});

Deno.test("F52b frontera exacta: |diferencia| == 2·SE cuenta como distinguible (>=, no >)", () => {
  // sd = 0 → SE cae al piso de 2 → umbral exacto 4, y la diferencia es 4.
  assertEquals(deltaLegible([10, 10, 10], [14, 14, 14]), { delta: 4, legible: true });
});

Deno.test("F52b: redondear la diferencia cruda tampoco vale — 9.6 no alcanza un umbral de 9.71", () => {
  // Math.round(9.6) = 10 cruzaría el umbral; la diferencia real no lo cruza.
  const r = deltaLegible([0, 5, 10, 15, 20], [10, 15, 20, 24, 29]);
  assertEquals(r!.legible, false);
});

Deno.test("F52b invariante: si el veredicto es legible, el delta renderizado nunca es 0 (jamás '=')", () => {
  // Con el piso de SE en 2 el umbral mínimo es 4, así que un delta legible no
  // puede redondear a 0. Se fija por si alguien toca el piso.
  const bases = [10, 40, 70];
  const spreads = [0, 3, 9, 18];
  const shifts = [0, 1, 2, 4, 7, 12, 25, 40];
  let vistos = 0;
  for (const base of bases) {
    for (const sp of spreads) {
      for (const sh of shifts) {
        const prev = [base - sp, base, base + sp, base - sp / 2, base + sp / 2];
        for (const signo of [1, -1]) {
          const cur = prev.map((x) => x + signo * sh);
          const r = deltaLegible(prev, cur);
          if (r && r.legible) {
            vistos++;
            assertEquals(r.delta === 0, false, `legible con delta 0: base=${base} sp=${sp} sh=${signo * sh}`);
          }
        }
      }
    }
  }
  assertEquals(vistos > 0, true, "el barrido no produjo ningún caso legible");
});
