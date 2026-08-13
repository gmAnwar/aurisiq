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
  scoreLevelLine,
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
  assertStringIncludes(text, "Ana: 2 (60, 50)"); // F53: scores crudos, sin "prom"
  assertStringIncludes(text, "Luis: 1 (40)");
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

Deno.test("weekly: delta por usuario vs SU semana previa; sin previa → sin corchete", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_WEEK, score_general: 60 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 50 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 50 }),
      mkAnalysis({ user_id: "u-luis", created_at: IN_WEEK, score_general: 40 }),
    ],
  }));
  // F51: 2 llamadas actuales < DELTA_MIN_N → el delta ya no se imprime.
  // F54: el nivel son los scores crudos; el delta, cuando existe, va en [].
  assertStringIncludes(text, "Ana: 2 (60, 50)");
  assertEquals(text.includes("Ana: 2 (60, 50) ["), false);
  assertStringIncludes(text, "Luis: 1 (40)");
  assertEquals(text.includes("Luis: 1 (40) ["), false);
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
  assertStringIncludes(text, "Luis: 1 (40) [nuevo]");
  assertEquals(text.includes("Ana: 1 (60) ["), false);
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

Deno.test("weekly F51: 3+ llamadas ambas semanas con diferencia chica → [≈], sin delta numérico", () => {
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
  assertStringIncludes(text, "Ana: 3 (60, 62, 58) [≈]");
  assertEquals(text.includes("[+"), false);
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
  assertStringIncludes(text, "Ana: 3 (80, 85, 90) [+60]");
});

Deno.test("weekly F51: menos de 3 llamadas en una semana → entrada sin corchete de delta", () => {
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [
      mkAnalysis({ created_at: IN_WEEK, score_general: 60 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 62 }),
      mkAnalysis({ created_at: IN_WEEK, score_general: 58 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 50 }),
      mkAnalysis({ created_at: IN_PREV_WEEK, score_general: 50 }),
    ],
  }));
  assertStringIncludes(text, "Ana: 3 (60, 62, 58)");
  assertEquals(text.includes("Ana: 3 (60, 62, 58) ["), false);
});

Deno.test("weekly F51: [nuevo] gana sobre cualquier delta, aunque fuera legible", () => {
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
  assertStringIncludes(text, "Luis: 3 (80, 85, 90) [nuevo]");
  assertEquals(text.includes("+60"), false);
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

// Golden del daily, byte a byte. Nació en F52 (que NO tocaba buildDigest) y
// F53 lo actualizó: la línea de usuarios pasó de "prom" a scores crudos.
const DAILY_GOLDEN = "📊 *AurisIQ* — miércoles 5 ago\n\n*ACME INMUEBLES* — 3 análisis · 2 usuarios\n• Ana: 2 (60, 50)  ·  Luis: 1 (40)\n• Leads: 1 calificado · 1 descalificado · 1 indeterminado\n• Outcomes: 2 pospuesto_sin_agenda · 1 cerrado_parcial\n\n🔇 Beta Pagos — sin análisis desde su alta\n\nSemana: 3 análisis (vs 0 previa)";

Deno.test("daily: no-regresión byte a byte del builder diario", () => {
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

// F52 — endurecimiento posterior al QA adversarial: dos mutantes sobrevivían.

Deno.test("F52 coeficiente: t=1.95 empata y t=2.92 corona — fija PHASE_TIE_SE por ambos lados", () => {
  // Antes de estos dos casos, cualquier coeficiente entre 0.51 y 7.34 pasaba la
  // suite: un refactor podía subirlo a 6·SE (silenciando separaciones reales de
  // t=4) o bajarlo a 1 (coronando con t=1.2) sin que nada avisara.
  const empata = buildWeeklyDigest(weeklyInput({
    analyses: [mkAnalysis({ created_at: IN_WEEK })],
    phases: [...phaseRows("Expectativa y Precio", PAT_138), ...phaseRows("Avance a Visita", [21, 3, 12, 11])],
  }));
  assertStringIncludes(empata, "13.8 y 11.8 pts, empatadas");

  const corona = buildWeeklyDigest(weeklyInput({
    analyses: [mkAnalysis({ created_at: IN_WEEK })],
    phases: [...phaseRows("Expectativa y Precio", PAT_138), ...phaseRows("Avance a Visita", [20, 2, 11, 10])],
  }));
  assertStringIncludes(corona, "Fase más cara: Expectativa y Precio (13.8 pts por llamada)");
  assertEquals(corona.includes("empatadas"), false);
});

Deno.test("F52 gate de volumen: si ninguna fase llega a n>=5 no se publica línea de fase alguna", () => {
  // La rama sin fases calificadas se ejercitaba mucho pero no se afirmaba: una
  // regresión podía publicar una fase fantasma sin datos y la suite seguía verde.
  const text = buildWeeklyDigest(weeklyInput({
    analyses: [mkAnalysis({ created_at: IN_WEEK })],
    phases: [...phaseRows("Cierre", [5], 4), ...phaseRows("Rara", [9], 2)],
  }));
  assertEquals(text.includes("Fase más cara"), false);
  assertEquals(text.includes("Fases más caras"), false);
});

// ================= F53: el daily muestra scores reales =================
// Nombres 100% ficticios (verificados contra la DB viva: 0 matches en users y
// 0 en nombres de prospecto). Ninguna persona real entra a los fixtures.

const F53_USERS: UserRow[] = [
  { id: "u-wen", organization_id: "org-a", name: "Wenceslao Q.", email: "wen@acme.mx", training_mode: false, active: true },
  { id: "u-ber", organization_id: "org-a", name: "Bernarda T.", email: "ber@acme.mx", training_mode: false, active: true },
  { id: "u-ign", organization_id: "org-a", name: "Ignacia R.", email: "ign@acme.mx", training_mode: false, active: true },
  { id: "u-cas", organization_id: "org-a", name: "Casimiro V.", email: "cas@acme.mx", training_mode: false, active: true },
];

/** i-ésima llamada del día objetivo (12:00Z…21:00Z, todas dentro de la ventana). */
function at(i: number): string {
  return `2026-08-05T${String(12 + i).padStart(2, "0")}:00:00Z`;
}

// Formas de item sin score. En prod un fragmento llega como status
// 'completado' + score NULL + unscorable_reason='fragmento' (verificado).
const FRAGMENTO: Partial<AnalysisRow> = { status: "completado", score_general: null, lead_quality: null, lead_outcome: null, unscorable_reason: "fragmento" };
const RECHAZADO: Partial<AnalysisRow> = { status: "rechazado", score_general: null, lead_quality: null, lead_outcome: null };
// 'procesando' y 'error' son valores reales de analyses_status_check
// ['pendiente','procesando','completado','error','rechazado'] — verificado
// contra la DB viva. La regla los agrupa a ambos como "en proceso".
const EN_PROCESO: Partial<AnalysisRow> = { status: "procesando", score_general: null, lead_quality: null, lead_outcome: null };

/** Items de UN usuario, en el orden dado = orden cronológico. */
function dia(userId: string, items: Array<Partial<AnalysisRow>>): AnalysisRow[] {
  return items.map((o, i) => mkAnalysis({ user_id: userId, created_at: at(i), ...o }));
}

const sc = (n: number): Partial<AnalysisRow> => ({ score_general: n });

function f53Input(analyses: AnalysisRow[]): DigestInput {
  return baseInput({ orgs: [ORG_A], users: F53_USERS, analyses });
}

/** La línea de usuarios del bloque de org (siempre el primer "• "). */
function userLine(text: string): string {
  return text.split("\n").find((l) => l.startsWith("• ")) ?? "";
}

/** Entradas de usuario de esa línea (separadas por "  ·  ", dos espacios). */
function entradas(text: string): string[] {
  return userLine(text).replace(/^• /, "").split("  ·  ");
}

/** Items representados por un elemento: "65"→1, "fragmento"→1, "2 fragmentos"→2. */
function itemsDe(token: string): number {
  const m = token.trim().match(/^(\d+)\s+\D/);
  return m ? Number(m[1]) : 1;
}

/**
 * INVARIANTE DURA F53 — se verifica sobre el RENDER, no sobre el fixture: si la
 * línea evapora un item, esto lo caza aunque el string esperado se haya escrito
 * mal. scores mostrados + conteos == el número que sigue al nombre.
 */
function assertInvariante(entrada: string, scored: number): void {
  // Dos anclas posibles, mismo contrato: "Wenceslao: 3" en las líneas por
  // usuario y "3 completados" en la rama de org (F54 — antes el harness solo
  // sabía leer la primera, así que la rama de org quedaba fijada nada más por
  // strings literales).
  const head = entrada.match(/^[^:]+: (\d+)/) ?? entrada.match(/^(\d+) \D/);
  assertEquals(head !== null, true, `entrada sin ancla de conteo: ${entrada}`);
  const declarado = Number(head![1]);

  let representados: number;
  if (entrada.includes(" · prom ")) {
    // Rama (b): "Nombre: N · prom X (min–max) [· N tipo]…". El paréntesis es el
    // rango, así que los scores no se listan: su conteo viene del caso.
    const sufijos = entrada.split(" · ").slice(2);
    representados = scored + sufijos.reduce((s, t) => s + itemsDe(t), 0);
  } else {
    // Rama (a): TODO vive en el paréntesis y se cuenta elemento por elemento.
    const paren = entrada.match(/\(([^)]*)\)/);
    assertEquals(paren !== null, true, `rama (a) sin paréntesis: ${entrada}`);
    const elems = paren![1].split(", ");
    assertEquals(
      elems.filter((e) => /^\d+$/.test(e)).length,
      scored,
      `scores mostrados != scored en: ${entrada}`,
    );
    representados = elems.reduce((s, e) => s + itemsDe(e), 0);
  }
  assertEquals(representados, declarado, `INVARIANTE rota — items evaporados en: ${entrada}`);
}

// ---- 1. GOLDEN: la forma exacta del caso del 6-ago, con datos sintéticos ----

const F53_GOLDEN_ROWS: AnalysisRow[] = [
  ...dia("u-wen", [sc(65), sc(28)]),
  ...dia("u-ber", [sc(28)]),
  ...dia("u-ign", [FRAGMENTO]),
];

Deno.test("F53 GOLDEN: el caso del 6-ago deja de ser 'prom 47' y muestra 65 y 28", () => {
  const text = buildDigest(f53Input(F53_GOLDEN_ROWS));
  assertEquals(
    userLine(text),
    "• Wenceslao: 2 (65, 28)  ·  Bernarda: 1 (28)  ·  Ignacia: 1 (fragmento)",
  );
  assertEquals(text.includes("prom"), false);
});

// ---- 2. Las 8 formas, cada una con su invariante verificada sobre el render ----

Deno.test("F53 forma 1/8 — 2 con score", () => {
  const text = buildDigest(f53Input(dia("u-wen", [sc(65), sc(28)])));
  assertEquals(entradas(text)[0], "Wenceslao: 2 (65, 28)");
  assertInvariante(entradas(text)[0], 2);
});

Deno.test("F53 forma 2/8 — 2 con score + 1 fragmento (el fragmento entra al paréntesis)", () => {
  const text = buildDigest(f53Input(dia("u-ber", [sc(72), sc(65), FRAGMENTO])));
  assertEquals(entradas(text)[0], "Bernarda: 3 (72, 65, fragmento)");
  assertInvariante(entradas(text)[0], 2);
});

Deno.test("F53 forma 3/8 — 3 con score + 2 fragmentos (se colapsan en plural)", () => {
  const text = buildDigest(f53Input(dia("u-ber", [sc(72), sc(65), sc(41), FRAGMENTO, FRAGMENTO])));
  assertEquals(entradas(text)[0], "Bernarda: 5 (72, 65, 41, 2 fragmentos)");
  assertInvariante(entradas(text)[0], 3);
});

Deno.test("F53 forma 4/8 — 1 con score + 1 rechazado", () => {
  const text = buildDigest(f53Input(dia("u-cas", [sc(28), RECHAZADO])));
  assertEquals(entradas(text)[0], "Casimiro: 2 (28, rechazado)");
  assertInvariante(entradas(text)[0], 1);
});

Deno.test("F53 forma 5/8 — 0 con score + 1 fragmento (palabra sola, sin conteo)", () => {
  const text = buildDigest(f53Input(dia("u-ign", [FRAGMENTO])));
  assertEquals(entradas(text)[0], "Ignacia: 1 (fragmento)");
  assertInvariante(entradas(text)[0], 0);
});

Deno.test("F53 forma 6/8 — 0 con score + 2 fragmentos", () => {
  const text = buildDigest(f53Input(dia("u-ign", [FRAGMENTO, FRAGMENTO])));
  assertEquals(entradas(text)[0], "Ignacia: 2 (2 fragmentos)");
  assertInvariante(entradas(text)[0], 0);
});

// 65+28+72+56+65+62 = 348 → prom 58 exacto · min 28 · max 72
const SEIS_SCORES = [65, 28, 72, 56, 65, 62];

Deno.test("F53 forma 7/8 — 6 con score: prom CON rango obligatorio", () => {
  const text = buildDigest(f53Input(dia("u-wen", SEIS_SCORES.map(sc))));
  assertEquals(entradas(text)[0], "Wenceslao: 6 · prom 58 (28–72)");
  assertInvariante(entradas(text)[0], 6);
});

Deno.test("F53 forma 8/8 — 6 con score + 2 fragmentos: aquí sí van de sufijo", () => {
  const text = buildDigest(f53Input(dia("u-wen", [...SEIS_SCORES.map(sc), FRAGMENTO, FRAGMENTO])));
  assertEquals(entradas(text)[0], "Wenceslao: 8 · prom 58 (28–72) · 2 fragmentos");
  assertInvariante(entradas(text)[0], 6);
});

// ---- 3. Frontera 3 vs 4, en dos tests separados ----

Deno.test("F53 frontera: con 3 con score se listan crudos y NO aparece 'prom'", () => {
  const text = buildDigest(f53Input(dia("u-cas", [sc(72), sc(65), sc(41)])));
  assertEquals(entradas(text)[0], "Casimiro: 3 (72, 65, 41)");
  assertEquals(text.includes("prom"), false);
});

Deno.test("F53 frontera: el 4º con score cambia la rama a prom + rango", () => {
  const text = buildDigest(f53Input(dia("u-cas", [sc(72), sc(65), sc(41), sc(70)])));
  assertEquals(entradas(text)[0], "Casimiro: 4 · prom 62 (41–72)");
  assertInvariante(entradas(text)[0], 4);
});

// ---- 4. Una sola llamada nunca se disfraza de estadística ----

Deno.test("F53: con 1 con score la cadena NO contiene 'prom'", () => {
  const text = buildDigest(f53Input(dia("u-ber", [sc(28)])));
  assertEquals(entradas(text)[0], "Bernarda: 1 (28)");
  assertEquals(text.includes("prom"), false);
});

// ---- Orden cronológico, no por score ----

Deno.test("F53: el orden es cronológico — dos fixtures espejo dan líneas distintas", () => {
  // Todos los ejemplos del caso real venían ya en orden descendente, así que un
  // sort por score los habría reproducido igual. Estos dos espejos lo delatan:
  // ordenar por score (asc o desc) haría ambas líneas idénticas.
  const sube = buildDigest(f53Input(dia("u-cas", [sc(41), sc(65), sc(72)])));
  const baja = buildDigest(f53Input(dia("u-cas", [sc(72), sc(65), sc(41)])));
  assertEquals(entradas(sube)[0], "Casimiro: 3 (41, 65, 72)");
  assertEquals(entradas(baja)[0], "Casimiro: 3 (72, 65, 41)");
});

Deno.test("F53: un score huérfano en fila no-completada NO se imprime como score", () => {
  // El pipeline puede dejar score_general escrito en una fila que después pasó
  // a 'error' (worker: catch posterior a persistir el payload) o 'rechazado'.
  // Ese 20 y ese 10 no describen llamadas calificadas: van por su tipo.
  const text = buildDigest(f53Input(dia("u-cas", [
    sc(80),
    { status: "error", score_general: 20, lead_quality: null, lead_outcome: null },
    { status: "rechazado", score_general: 10, lead_quality: null, lead_outcome: null },
  ])));
  assertEquals(entradas(text)[0], "Casimiro: 3 (80, rechazado, en proceso)");
  assertInvariante(entradas(text)[0], 1);
  assertEquals(/\b20\b|\b10\b/.test(userLine(text)), false);
});

Deno.test("F53: 'en proceso' es invariable en plural y convive con los otros tipos", () => {
  const text = buildDigest(f53Input(dia("u-cas", [sc(28), FRAGMENTO, RECHAZADO, EN_PROCESO, EN_PROCESO])));
  assertEquals(entradas(text)[0], "Casimiro: 5 (28, fragmento, rechazado, 2 en proceso)");
  assertInvariante(entradas(text)[0], 1);
});

// ---- 5. El artefacto de las OTRAS dos superficies ----
//
// Este par nació en F53 como test de NO-FUGA: fijaba byte a byte lo que weekly y
// monthly imprimían en HEAD, para que el cambio del daily no se les fugara. Los
// dos strings se capturaron EJECUTANDO el código de entonces (git show HEAD:…),
// no se escribieron a mano. El del semanal documentaba el defecto sin aprobarlo:
// con el mismo insumo del GOLDEN imprimía "Wenceslao: 2 · prom 47" — literalmente
// el artefacto del 6-ago que F53 sacó del diario.
//
// F54 INVIERTE el del semanal: ahora que consume el helper compartido, el mismo
// golden pasa de fijar el defecto a fijar la corrección — las 4 filas que producían
// "prom 47" listan 65 y 28. El del MENSUAL sigue clavado a HEAD y sigue siendo
// candado de no-fuga: el mensual no tiene línea de nivel por usuario (su "Score
// prom" es de org y sobre un mes entero), así que queda fuera del alcance de F54.

const WEEKLY_F54 = "📈 *AurisIQ* — semana 3–9 ago\n\n*ACME INMUEBLES* — 4 análisis (vs 0 previa) · 3 usuarios\n• Wenceslao: 2 (65, 28)  ·  Bernarda: 1 (28)  ·  Ignacia: 1 (fragmento)\n• Leads: 3 calificados (100%) · 1 sin dato\n• Outcomes: 3 cerrado_parcial\n\nTotal: 4 análisis (vs 0 previa)";
const MONTHLY_HEAD = "🗓️ *AurisIQ* — resumen mensual · agosto 2026\n\n*ACME INMUEBLES* — 4 análisis (jul: 0) · 3 usuarios\n• Uso del plan: 4/50 (8%)\n• Score prom: 40 · Mejor: Wenceslao 65\n• Leads: 3 calificados (100%) · 1 sin dato\n\nTotal: 4 análisis (jul: 0) · orgs con actividad: 1";

Deno.test("F54 golden: el weekly con el insumo del GOLDEN muestra 65 y 28, no 'prom 47'", () => {
  const text = buildWeeklyDigest({
    targetDate: "2026-08-05",
    orgs: [ORG_A],
    users: F53_USERS,
    analyses: F53_GOLDEN_ROWS,
    phases: [],
    alerts: [],
    lastRealAnalysisByOrg: {},
  });
  assertEquals(text, WEEKLY_F54);
  // El artefacto exacto que F54 elimina de esta superficie.
  assertEquals(text.includes("prom"), false);
});

// ================= F54: la regla también en weekly y en la rama de org =======
//
// El helper es compartido, pero compartirlo NO garantiza que cada superficie lo
// llame bien: puede recibir el periodo equivocado, o el llamador puede volver a
// armar la línea a mano. Por eso los mutantes del helper se matan aquí con
// tests que ejercitan el SEMANAL, no reciclando los del daily.

/** i-ésima llamada de la semana REPORTADA (mar 4 ago), en orden cronológico. */
function atWeek(i: number): string {
  return `2026-08-04T${String(12 + i).padStart(2, "0")}:00:00Z`;
}
/** i-ésima llamada de la semana PREVIA (mié 29 jul). */
function atPrev(i: number): string {
  return `2026-07-29T${String(12 + i).padStart(2, "0")}:00:00Z`;
}

/** Items de UN usuario en un periodo; el orden dado = orden cronológico. */
function semana(
  userId: string,
  items: Array<Partial<AnalysisRow>>,
  when: (i: number) => string = atWeek,
): AnalysisRow[] {
  return items.map((o, i) => mkAnalysis({ user_id: userId, created_at: when(i), ...o }));
}

function f54Weekly(analyses: AnalysisRow[]): string {
  return buildWeeklyDigest({
    targetDate: WD,
    orgs: [ORG_A],
    users: F53_USERS, // sin created_at → nunca son "nuevo": los badges los pone el delta
    analyses,
    phases: [],
    alerts: [],
    lastRealAnalysisByOrg: {},
  });
}

// ---- Frontera 3 vs 4 SOBRE EL SEMANAL (mutante: umbral 3→4) ----

Deno.test("F54 weekly frontera: con 3 con score se listan crudos y NO aparece 'prom'", () => {
  const text = f54Weekly(semana("u-wen", [sc(72), sc(65), sc(41)]));
  assertEquals(entradas(text)[0], "Wenceslao: 3 (72, 65, 41)");
  assertEquals(text.includes("prom"), false);
});

Deno.test("F54 weekly frontera: el 4º con score cambia la rama a prom + rango", () => {
  const text = f54Weekly(semana("u-wen", [sc(72), sc(65), sc(41), sc(70)]));
  assertEquals(entradas(text)[0], "Wenceslao: 4 · prom 62 (41–72)");
  assertInvariante(entradas(text)[0], 4);
});

// ---- Rango obligatorio y orden cronológico, en el semanal ----

Deno.test("F54 weekly: el rango del prom es obligatorio — dos semanas con el mismo prom y distinta dispersión no se ven igual", () => {
  // Sin el rango, "prom 58" describe igual de mal a un equipo parejo que a uno
  // con 30 puntos de spread: es exactamente lo que F53 vino a impedir.
  const apretado = f54Weekly(semana("u-ber", [sc(57), sc(58), sc(58), sc(59)]));
  const disperso = f54Weekly(semana("u-ber", [sc(43), sc(58), sc(58), sc(73)]));
  assertEquals(entradas(apretado)[0], "Bernarda: 4 · prom 58 (57–59)");
  assertEquals(entradas(disperso)[0], "Bernarda: 4 · prom 58 (43–73)");
});

Deno.test("F54 weekly: el orden es cronológico — dos fixtures espejo dan líneas distintas", () => {
  const sube = f54Weekly(semana("u-cas", [sc(41), sc(65), sc(72)]));
  const baja = f54Weekly(semana("u-cas", [sc(72), sc(65), sc(41)]));
  assertEquals(entradas(sube)[0], "Casimiro: 3 (41, 65, 72)");
  assertEquals(entradas(baja)[0], "Casimiro: 3 (72, 65, 41)");
});

// El espejo de arriba (heredado de F53) mata al mutante que ORDENA MAL —por
// score— pero no al que BORRA el sort: todos los fixtures insertan las filas ya
// en orden de reloj, así que sin sort salen igual y el mutante sobrevivía.
// Medido: "comparador cronológico -> no-op" pasaba la suite entera en verde.
// Estos dos cierran el hueco en las dos superficies insertando al revés.

Deno.test("F54 weekly: el orden lo fija created_at, no el orden en que llegan las filas", () => {
  const filas = semana("u-cas", [sc(41), sc(65), sc(72)]); // 12:00 · 13:00 · 14:00
  const text = f54Weekly([filas[2], filas[0], filas[1]]); // llegan 14:00, 12:00, 13:00
  assertEquals(entradas(text)[0], "Casimiro: 3 (41, 65, 72)");
});

Deno.test("F53/F54 daily: el orden lo fija created_at, no el orden en que llegan las filas", () => {
  const filas = dia("u-cas", [sc(41), sc(65), sc(72)]);
  const text = buildDigest(f53Input([filas[2], filas[0], filas[1]]));
  assertEquals(entradas(text)[0], "Casimiro: 3 (41, 65, 72)");
});

// ---- Nada se evapora (mutante: item que desaparece de la línea) ----

Deno.test("F54 weekly: los no-scored entran al paréntesis — la semana no evapora items", () => {
  const text = f54Weekly(semana("u-ber", [sc(72), sc(65), FRAGMENTO, RECHAZADO]));
  assertEquals(entradas(text)[0], "Bernarda: 4 (72, 65, fragmento, rechazado)");
  assertInvariante(entradas(text)[0], 2);
});

Deno.test("F54 weekly: un score huérfano ni cuenta como score ni decide la rama", () => {
  // Espejo del test de F53, que era el ÚNICO en toda la suite que mataba la
  // guardia de status de hasScore. Aquí el huérfano además decide la rama: sin
  // la guardia serían 4 "scores" y la línea saldría como prom + rango.
  const text = f54Weekly(semana("u-cas", [
    sc(72),
    sc(65),
    sc(41),
    { status: "error", score_general: 20, lead_quality: null, lead_outcome: null },
  ]));
  assertEquals(entradas(text)[0], "Casimiro: 4 (72, 65, 41, en proceso)");
  assertEquals(text.includes("prom"), false);
  assertEquals(/\b20\b/.test(userLine(text)), false);
  assertInvariante(entradas(text)[0], 3);
});

Deno.test("F54 weekly: con >=4 con score los no-scored pasan a sufijo, detrás del rango", () => {
  const text = f54Weekly(semana("u-wen", [...SEIS_SCORES.map(sc), FRAGMENTO, FRAGMENTO]));
  assertEquals(entradas(text)[0], "Wenceslao: 8 · prom 58 (28–72) · 2 fragmentos");
  assertInvariante(entradas(text)[0], 6);
});

// ---- Integración: el nivel es de la semana REPORTADA, el delta mira la previa ----

Deno.test("F54 weekly integración: el nivel usa la semana reportada, no la previa que alimenta el delta", () => {
  // El mutante que este test caza: pasarle al helper los items de prevUsers.
  // Con esa mutación la línea saldría "Wenceslao: 3 · prom 28 (20–35)" —
  // conteo de una semana y scores de la otra, indetectable a ojo en Slack.
  const text = f54Weekly([
    ...semana("u-wen", [sc(20), sc(25), sc(30), sc(35)], atPrev),
    ...semana("u-wen", [sc(80), sc(85), sc(90)]),
  ]);
  assertEquals(entradas(text)[0], "Wenceslao: 3 (80, 85, 90) [+57]");
  assertInvariante(entradas(text)[0], 3);
});

Deno.test("F54 weekly: el delta se calcula contra la previa aunque el nivel ya no la muestre (F51 intacto)", () => {
  // Mismo insumo actual que el test de arriba, cambiando SOLO la semana previa:
  // si el delta se calculara con los items del nivel, el badge no se movería.
  const text = f54Weekly([
    ...semana("u-wen", [sc(78), sc(85), sc(92)], atPrev),
    ...semana("u-wen", [sc(80), sc(85), sc(90)]),
  ]);
  assertEquals(entradas(text)[0], "Wenceslao: 3 (80, 85, 90) [≈]");
});

// ---- TAREA 3: la rama colapsada de >4 orgs ----

/** 5 orgs con actividad (dispara collapse); `filas` son las de Org 0. */
function colapsado(filas: Array<Partial<AnalysisRow>>): string {
  const orgs: OrgRow[] = [];
  const users: UserRow[] = [];
  const analyses: AnalysisRow[] = [];
  for (let i = 0; i < 5; i++) {
    orgs.push({ id: `o${i}`, name: `Org ${i}`, slug: `o${i}`, access_status: "active" });
    users.push({ id: `v${i}`, organization_id: `o${i}`, name: `Vendedor ${i}`, email: `v${i}@x.mx`, training_mode: false, active: true });
    if (i > 0) analyses.push(mkAnalysis({ organization_id: `o${i}`, user_id: `v${i}` }));
  }
  analyses.push(...filas.map((o, k) => mkAnalysis({ organization_id: "o0", user_id: "v0", created_at: at(k), ...o })));
  return buildDigest(baseInput({ orgs, users, analyses }));
}

/**
 * El NIVEL de un bloque de org colapsado: la línea "• …" que sigue al head, sin
 * el sufijo de leads — los calificados no son items del nivel. Lo que queda
 * cumple el mismo contrato que una entrada de usuario y pasa por assertInvariante.
 */
function nivelOrg(text: string, orgName: string): string {
  const lineas = text.split("\n");
  const i = lineas.findIndex((l) => l.startsWith(`*${orgName}*`));
  assertEquals(i >= 0, true, `no encontré el bloque de ${orgName}`);
  return (lineas[i + 1] ?? "")
    .replace(/^• /, "")
    .split(" · ")
    .filter((s) => !/calificados?$/.test(s))
    .join(" · ");
}

Deno.test("F54 >4 orgs: una org con UNA llamada ya no la disfraza de 'prom'", () => {
  const text = colapsado([sc(47)]);
  assertStringIncludes(text, "• 1 completado (47) · 1 calificado");
  assertEquals(text.includes("prom"), false);
  assertEquals(text.includes("Vendedor"), false); // el colapso sigue colapsando
  assertInvariante(nivelOrg(text, "ORG 0"), 1);
});

Deno.test("F54 >4 orgs: con 4+ scores la org sí promedia, y con rango", () => {
  const text = colapsado([sc(72), sc(65), sc(41), sc(70)]);
  assertStringIncludes(text, "*ORG 0* — 4 análisis · 1 usuario");
  assertStringIncludes(text, "• 4 completados · prom 62 (41–72) · 4 calificados");
  assertInvariante(nivelOrg(text, "ORG 0"), 4);
});

Deno.test("F54 >4 orgs: el fragmento no se evapora del nivel de la org", () => {
  const text = colapsado([sc(72), sc(65), FRAGMENTO]);
  assertStringIncludes(text, "• 3 completados (72, 65, fragmento) · 2 calificados");
  assertInvariante(nivelOrg(text, "ORG 0"), 2);
});

Deno.test("F54 >4 orgs: con 4+ scores el fragmento pasa a sufijo, igual que en la línea por usuario", () => {
  const text = colapsado([sc(72), sc(65), sc(41), sc(70), FRAGMENTO]);
  assertStringIncludes(text, "• 5 completados · prom 62 (41–72) · 1 fragmento · 4 calificados");
  assertInvariante(nivelOrg(text, "ORG 0"), 4);
});

Deno.test("F54 >4 orgs: el ancla del paréntesis son los completados — los rechazados ya los enumera el head", () => {
  const text = colapsado([sc(80), RECHAZADO]);
  assertStringIncludes(text, "*ORG 0* — 2 análisis (1 completado · 1 rechazado) · 1 usuario");
  assertStringIncludes(text, "• 1 completado (80) · 1 calificado");
});

Deno.test("F54 >4 orgs: el rechazado tampoco se cuela al nivel cuando la org sí promedia", () => {
  const text = colapsado([sc(72), sc(65), sc(41), sc(70), RECHAZADO]);
  assertStringIncludes(text, "*ORG 0* — 5 análisis (4 completados · 1 rechazado) · 1 usuario");
  assertStringIncludes(text, "• 4 completados · prom 62 (41–72) · 4 calificados");
  assertInvariante(nivelOrg(text, "ORG 0"), 4);
});

Deno.test("F54 >4 orgs: org sin un solo score no inventa nivel", () => {
  const text = colapsado([RECHAZADO, RECHAZADO]);
  assertStringIncludes(text, "*ORG 0* — 2 análisis (0 completados · 2 rechazados) · 1 usuario");
  assertEquals(text.includes("• 0 completados"), false);
});

// ---- El helper, directo ----

Deno.test("F54 helper: sin items devuelve solo el head (guardia para llamadores futuros)", () => {
  assertEquals(scoreLevelLine("Sin datos", []), "Sin datos");
  assertEquals(scoreLevelLine("Sin datos", [], "≈"), "Sin datos [≈]");
});

Deno.test("F53 no-fuga: monthly con el insumo del GOLDEN sale byte-idéntico a HEAD", () => {
  const text = buildMonthlyDigest({
    targetDate: "2026-08-15",
    orgs: [{ ...ORG_A, plan: "founder" }],
    users: F53_USERS,
    analyses: F53_GOLDEN_ROWS,
    alerts: [],
    lastRealAnalysisByOrg: {},
  });
  assertEquals(text, MONTHLY_HEAD);
});
