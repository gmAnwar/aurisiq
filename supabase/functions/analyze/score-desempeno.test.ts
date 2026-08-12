// F48b: gates de computeScoreDesempeno y parseDescarteBlock.
// Fixtures 100% sintéticos, sin PII y sin nombres de personas reales.
//
// Regla S53: cada gate se valida por mutación — los tests están escritos para
// que el mutante correspondiente muera, no para acompañar al diff.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeScoreDesempeno, DESCARTE_MAX, sumDescarte } from "./score-desempeno.ts";
import { DESCARTE_CRITERIO_NAMES, normalizePhaseName, parseClaudeOutput, parseDescarteBlock, stripDescarteBlock } from "./parser.ts";
import { DESCARTE_BLOCK, hasLeadDependentPhases } from "./prompt-blocks.ts";
import type { DescarteScores, ScorecardPhase } from "./types.ts";

// Catálogo V5A real (immobili, eef6c463) — puras 10+10=20, dependientes 35+30+15.
const V5A: ScorecardPhase[] = [
  { phase_id: "apertura_marco", phase_name: "Apertura y Marco", score_max: 10 },
  { phase_id: "calificacion_propiedad", phase_name: "Calificación de la Propiedad", score_max: 35, lead_dependent: true },
  { phase_id: "expectativa_precio", phase_name: "Expectativa y Precio", score_max: 30, lead_dependent: true },
  { phase_id: "avance_visita", phase_name: "Avance a Visita", score_max: 15, lead_dependent: true },
  { phase_id: "lectura_propietario", phase_name: "Lectura del Propietario", score_max: 10 },
];

/** Catálogo sin ninguna fase marcada — el caso de los scorecards no migrados. */
const SIN_FLAG: ScorecardPhase[] = V5A.map(({ lead_dependent: _drop, ...p }) => p);

const PURAS_OK = [
  { phase_name: "Apertura y Marco", score: 8 },
  { phase_name: "Lectura del Propietario", score: 7 },
];
const DEPENDIENTES = [
  { phase_name: "Calificación de la Propiedad", score: 5 },
  { phase_name: "Expectativa y Precio", score: 4 },
  { phase_name: "Avance a Visita", score: 0 },
];
const TODAS = [...PURAS_OK, ...DEPENDIENTES];

const DESCARTE_OK: DescarteScores = {
  causal_confirmada: 5,
  resolubilidad_explorada: 4,
  orientacion_correcta: 4,
  puerta_abierta: 3,
};

function run(over: Partial<Parameters<typeof computeScoreDesempeno>[0]> = {}) {
  return computeScoreDesempeno({
    leadQuality: "descalificado",
    scoreGeneral: 24,
    parsedPhases: TODAS,
    phasesCatalog: V5A,
    descarte: DESCARTE_OK,
    unscorableReason: null,
    ...over,
  });
}

// ── Regla 1: fragmento ──────────────────────────────────────

Deno.test("F48b regla 1: fragmento → null y NO reporta pérdida", () => {
  const r = run({ unscorableReason: "fragmento", scoreGeneral: null });
  assertEquals(r.score, null);
  assertEquals(r.descarteBlockMissing, false);
});

Deno.test("F48b regla 1: fragmento gana incluso con descarte completo en el output", () => {
  // Precedencia: el gate pre-LLM ya decidió que no hay material evaluable.
  assertEquals(run({ unscorableReason: "fragmento" }).score, null);
});

// ── Regla 2: no-descalificado usa el general tal cual ───────

Deno.test("F48b regla 2: calificado → general tal cual, JAMÁS la fórmula de descarte", () => {
  // MUTANTE (d): si la fórmula corriera para calificados, con estas puras y
  // este descarte daría 31 — muy lejos de 88.
  const r = run({ leadQuality: "calificado", scoreGeneral: 88 });
  assertEquals(r.score, 88);
  assertEquals(r.descarteBlockMissing, false);
});

Deno.test("F48b regla 2: indeterminado y null también caen al general", () => {
  assertEquals(run({ leadQuality: "indeterminado", scoreGeneral: 61 }).score, 61);
  assertEquals(run({ leadQuality: null, scoreGeneral: 61 }).score, 61);
});

Deno.test("F48b regla 2: general null se propaga como null, sin trigger", () => {
  const r = run({ leadQuality: "calificado", scoreGeneral: null });
  assertEquals(r.score, null);
  assertEquals(r.descarteBlockMissing, false);
});

// ── Regla 3: descarte sin catálogo marcado ─────────────────

Deno.test("F48b regla 3: descalificado sin fases lead_dependent → general, sin trigger", () => {
  const r = run({ phasesCatalog: SIN_FLAG, descarte: null });
  assertEquals(r.score, 24);
  assertEquals(r.descarteBlockMissing, false);
});

Deno.test("F48b regla 3: catálogo null (scorecard sin phases) → general, sin trigger", () => {
  const r = run({ phasesCatalog: null, descarte: null });
  assertEquals(r.score, 24);
  assertEquals(r.descarteBlockMissing, false);
});

// ── Regla 4: la fórmula ────────────────────────────────────

Deno.test("F48b regla 4: descarte válido PRODUCE número — el gate no suprime de más", () => {
  // MUTANTE (a). puras 8+7=15, descarte 5+4+4+3=16 → 31/40 = 77.5 → 78.
  // El general era 24: la separación cambia la lectura por completo.
  const r = run();
  assertEquals(r.score, 78);
  assertEquals(r.descarteBlockMissing, false);
  assert(r.score! > 24, "el desempeño debe superar al general en este caso");
});

Deno.test("F48b regla 4: las fases lead_dependent NO entran al cálculo", () => {
  // Subir las dependientes a su máximo no mueve el desempeño ni un punto.
  const conDependientesAltas = run({
    parsedPhases: [
      ...PURAS_OK,
      { phase_name: "Calificación de la Propiedad", score: 35 },
      { phase_name: "Expectativa y Precio", score: 30 },
      { phase_name: "Avance a Visita", score: 15 },
    ],
  });
  assertEquals(conDependientesAltas.score, 78);
});

Deno.test("F48b regla 4: el denominador es max puras + 20, no 100", () => {
  // Todo perfecto: puras 10+10 y descarte 20 → 40/40 = 100.
  const r = run({
    parsedPhases: [
      { phase_name: "Apertura y Marco", score: 10 },
      { phase_name: "Lectura del Propietario", score: 10 },
    ],
    descarte: { causal_confirmada: 5, resolubilidad_explorada: 5, orientacion_correcta: 5, puerta_abierta: 5 },
  });
  assertEquals(r.score, 100);
});

Deno.test("F48b regla 4: cero absoluto → 0, no null", () => {
  const r = run({
    parsedPhases: [
      { phase_name: "Apertura y Marco", score: 0 },
      { phase_name: "Lectura del Propietario", score: 0 },
    ],
    descarte: { causal_confirmada: 0, resolubilidad_explorada: 0, orientacion_correcta: 0, puerta_abierta: 0 },
  });
  assertEquals(r.score, 0);
  assertEquals(r.descarteBlockMissing, false);
});

Deno.test("F48b regla 4: el resultado se capea a 100 aunque las puras se pasen de su max", () => {
  const r = run({
    parsedPhases: [
      { phase_name: "Apertura y Marco", score: 40 },
      { phase_name: "Lectura del Propietario", score: 40 },
    ],
    descarte: { causal_confirmada: 5, resolubilidad_explorada: 5, orientacion_correcta: 5, puerta_abierta: 5 },
  });
  assertEquals(r.score, 100);
});

// ── Regla 4: los gates que producen null + trigger ──────────

Deno.test("F48b gate: descarte null (bloque ausente) → null + trigger", () => {
  // MUTANTE (b) en su forma parseada: el bloque de 3 líneas llega aquí como null.
  const r = run({ descarte: null });
  assertEquals(r.score, null);
  assertEquals(r.descarteBlockMissing, true);
});

Deno.test("F48b gate: fase pura ausente → null + trigger", () => {
  // MUTANTE (c). Están las 3 dependientes y UNA pura; falta "Lectura del
  // Propietario" → no se puede calcular sin inventar.
  const r = run({
    parsedPhases: [{ phase_name: "Apertura y Marco", score: 8 }, ...DEPENDIENTES],
  });
  assertEquals(r.score, null);
  assertEquals(r.descarteBlockMissing, true);
});

Deno.test("F48b gate: faltar SOLO fases dependientes no bloquea nada", () => {
  // El complemento del test anterior: lo que se exige son las puras, no todas.
  const r = run({ parsedPhases: PURAS_OK });
  assertEquals(r.score, 78);
  assertEquals(r.descarteBlockMissing, false);
});

Deno.test("F48b gate: el match de fase es por phase_name exacto", () => {
  const r = run({
    parsedPhases: [
      { phase_name: "Apertura y Marco", score: 8 },
      { phase_name: "Lectura de Propietario", score: 7 }, // "de" en vez de "del"
      ...DEPENDIENTES,
    ],
  });
  assertEquals(r.score, null);
  assertEquals(r.descarteBlockMissing, true);
});

Deno.test("F48b: sumDescarte y DESCARTE_MAX son coherentes (el máximo es alcanzable)", () => {
  assertEquals(sumDescarte({ causal_confirmada: 5, resolubilidad_explorada: 5, orientacion_correcta: 5, puerta_abierta: 5 }), DESCARTE_MAX);
  assertEquals(sumDescarte(DESCARTE_OK), 16);
});

// ── parseDescarteBlock ─────────────────────────────────────

const BLOQUE_OK = `PATRÓN DE ERROR PRINCIPAL

Algo del análisis.

---

EVALUACION DE DESCARTE
Causal confirmada: 5/5
Resolubilidad explorada: 3/5
Orientacion correcta: 4/5
Puerta abierta: 0/5`;

Deno.test("F48b parse: bloque completo → los 4 criterios", () => {
  assertEquals(parseDescarteBlock(BLOQUE_OK), {
    causal_confirmada: 5,
    resolubilidad_explorada: 3,
    orientacion_correcta: 4,
    puerta_abierta: 0,
  });
});

Deno.test("F48b parse: bloque ausente → null", () => {
  assertEquals(parseDescarteBlock("SCORE GENERAL: 80\n\n---\n\nOtro bloque cualquiera."), null);
});

Deno.test("F48b parse: parcial de 3 líneas → null, NO ceros inventados", () => {
  // MUTANTE (b). Un cero inventado se lee como "no lo hizo": difamación.
  const parcial = `EVALUACION DE DESCARTE
Causal confirmada: 5/5
Resolubilidad explorada: 3/5
Orientacion correcta: 4/5`;
  assertEquals(parseDescarteBlock(parcial), null);
});

Deno.test("F48b parse: falta la PRIMERA línea → null (no solo la última)", () => {
  const parcial = `EVALUACION DE DESCARTE
Resolubilidad explorada: 3/5
Orientacion correcta: 4/5
Puerta abierta: 2/5`;
  assertEquals(parseDescarteBlock(parcial), null);
});

Deno.test("F48b parse: criterio 7/5 se clampea a 5", () => {
  // MUTANTE (e). El modelo a veces se pasa de la escala que se le pidió.
  const r = parseDescarteBlock(`EVALUACION DE DESCARTE
Causal confirmada: 7/5
Resolubilidad explorada: 3/5
Orientacion correcta: 4/5
Puerta abierta: 2/5`);
  assertEquals(r!.causal_confirmada, 5);
});

Deno.test("F48b parse: escapes markdown — el des-escape F42d ya corrió antes", () => {
  // parseClaudeOutput des-escapa sobre su copia local ANTES de llamar aquí, así
  // que esta función ve el texto ya limpio. Este test fija ese contrato:
  // el mismo bloque, con y sin escapes, tiene que dar el mismo resultado
  // cuando entra por parseClaudeOutput.
  const conEscapes = `EVALUACION DE DESCARTE
Causal confirmada: 5/5
Resolubilidad explorada: 3/5
Orientacion correcta: 4/5
Puerta abierta: 2/5`.replace(/-/g, "\\-");
  const desescapado = conEscapes.replace(/\\([_*[\]()#+\-.!~>|`])/g, "$1");
  assertEquals(parseDescarteBlock(desescapado), {
    causal_confirmada: 5,
    resolubilidad_explorada: 3,
    orientacion_correcta: 4,
    puerta_abierta: 2,
  });
});

Deno.test("F48b parse: bold markdown en labels y heading", () => {
  const r = parseDescarteBlock(`**EVALUACION DE DESCARTE**
**Causal confirmada:** 5/5
**Resolubilidad explorada:** 3/5
**Orientacion correcta:** 4/5
**Puerta abierta:** 2/5`);
  assertEquals(r!.puerta_abierta, 2);
});

Deno.test("F48b parse: acentos del modelo (EVALUACIÓN / Orientación) se toleran", () => {
  const r = parseDescarteBlock(`EVALUACIÓN DE DESCARTE
Causal confirmada: 1/5
Resolubilidad explorada: 2/5
Orientación correcta: 3/5
Puerta abierta: 4/5`);
  assertEquals(r, { causal_confirmada: 1, resolubilidad_explorada: 2, orientacion_correcta: 3, puerta_abierta: 4 });
});

Deno.test("F48b parse: el bloque se corta en el siguiente separador", () => {
  // Un número suelto después del --- no puede colarse como criterio.
  const r = parseDescarteBlock(`EVALUACION DE DESCARTE
Causal confirmada: 1/5
Resolubilidad explorada: 2/5
Orientacion correcta: 3/5

---

OTRO BLOQUE
Puerta abierta: 5/5`);
  assertEquals(r, null);
});

// ── Bloque del prompt: condicional + prohibiciones ──────────

Deno.test("F48b prompt: el bloque solo se activa con >=1 fase lead_dependent", () => {
  assertEquals(hasLeadDependentPhases(V5A), true);
  assertEquals(hasLeadDependentPhases(SIN_FLAG), false);
  assertEquals(hasLeadDependentPhases([]), false);
  assertEquals(hasLeadDependentPhases(null), false);
});

Deno.test("F48b prompt: lead_dependent:false explícito NO activa el bloque", () => {
  // La ausencia del key es "pura"; false también. Solo === true cuenta.
  const explicito: ScorecardPhase[] = [{ phase_id: "x", phase_name: "X", score_max: 10, lead_dependent: false }];
  assertEquals(hasLeadDependentPhases(explicito), false);
});

Deno.test("F48b prompt: PROHIBIDO el substring DESCALIFICACION — le robaría el match al parser", () => {
  // hc("DESCALIFICACION") NO está anclado a inicio de línea: si esta palabra
  // aparece aquí, categoria_descalificacion puede parsear el bloque equivocado.
  assertEquals(DESCARTE_BLOCK.includes("DESCALIFICACION"), false);
});

Deno.test("F48b prompt: PROHIBIDA la palabra 'lead' — el TONE_BLOCK la veta como anglicismo", () => {
  assertEquals(/\blead\b/i.test(DESCARTE_BLOCK), false);
});

Deno.test("F48b prompt: el bloque declara las 5 líneas completas y el parser las lee", () => {
  // Guard de ida y vuelta: el formato que el prompt PIDE es exactamente el que
  // parseDescarteBlock SABE leer. Si alguien renombra un criterio en el prompt
  // sin tocar el parser, esto truena.
  const ejemplo = DESCARTE_BLOCK.replace(/N\/5/g, "3/5");
  assertEquals(parseDescarteBlock(ejemplo), {
    causal_confirmada: 3,
    resolubilidad_explorada: 3,
    orientacion_correcta: 3,
    puerta_abierta: 3,
  });
});

// ── HOTFIX F48b: los criterios de descarte NO son fases ─────
//
// Incidente (smoke Bodygreen, dbb5db83): el modelo emitió los 4 criterios en
// formato de fase ADEMÁS del bloque plano. El phaseRegex los matcheó,
// matchPhaseIds les inventó phase_id vía slugify y writeAnalysisPhases los
// persistió: 7 filas donde debían ir 3. Contaminan fase-más-débil y
// current_focus_phase (familia de las 26 huérfanas de F48a) y el conteo
// inflado (7>=5) tapó el phases_mismatch que debían disparar las 2 ausentes.

/** Fases del scorecard de Bodygreen que el modelo SÍ emitió en el incidente. */
const SMOKE_FASES = `DIAGNÓSTICO POR FASE

Bienvenida y primer contacto (6/10): abrió bien.
Diagnóstico corporal (18/25): exploró la molestia.
Cierre y primera sesión (6/20): no cerró.`;

const SMOKE_BLOQUE = `EVALUACION DE DESCARTE
Causal confirmada: 5/5
Resolubilidad explorada: 3/5
Orientacion correcta: 5/5
Puerta abierta: 2/5`;

// Fixture A — el incidente: criterios en formato fase Y el bloque plano.
const FIXTURE_A = `SCORE GENERAL: 30

${SMOKE_FASES}

Causal confirmada (5/5): confirmó con datos del propietario.
Resolubilidad explorada (3/5): exploró a medias.
Orientación correcta (5/5): la guía fue la adecuada.
Puerta abierta (2/5): quedó tibio.

---

${SMOKE_BLOQUE}`;

// Fixture B — el formato instruido: criterios SOLO en el bloque plano.
const FIXTURE_B = `SCORE GENERAL: 30

${SMOKE_FASES}

---

${SMOKE_BLOQUE}`;

const FASES_REALES = ["Bienvenida y primer contacto", "Diagnóstico corporal", "Cierre y primera sesión"];

Deno.test("F48b hotfix A: el incidente — solo las fases del scorecard entran a phases", () => {
  const p = parseClaudeOutput(FIXTURE_A, null);
  assertEquals(p.phases.map((f) => f.phase_name), FASES_REALES);
  // Y el bloque se sigue leyendo completo: la excisión no lo rompió.
  assertEquals(p.descarte, { causal_confirmada: 5, resolubilidad_explorada: 3, orientacion_correcta: 5, puerta_abierta: 2 });
});

Deno.test("F48b hotfix A: ningún nombre de criterio sobrevive en phases", () => {
  const p = parseClaudeOutput(FIXTURE_A, null);
  for (const nombre of DESCARTE_CRITERIO_NAMES) {
    const n = normalizePhaseName(nombre);
    assert(
      !p.phases.some((f) => normalizePhaseName(f.phase_name) === n),
      `"${nombre}" se coló como fase — volvería a escribirse en analysis_phases`,
    );
  }
});

Deno.test("F48b hotfix A: el conteo real destapa el phases_mismatch que estaba enmascarado", () => {
  // El scorecard tiene 5 fases y el modelo emitió 3. Con las junk el conteo
  // daba 7 (>=5) y el detector F42 se callaba; ahora da 3 y dispara.
  const p = parseClaudeOutput(FIXTURE_A, null);
  assertEquals(p.phases.length, 3);
  assert(p.phases.length < 5, "phases_found debe quedar por debajo de las 5 esperadas");
});

Deno.test("F48b hotfix B: formato instruido — no-regresión, fases y descarte intactos", () => {
  const p = parseClaudeOutput(FIXTURE_B, null);
  assertEquals(p.phases.map((f) => f.phase_name), FASES_REALES);
  assertEquals(p.phases.map((f) => f.score), [6, 18, 6]);
  assertEquals(p.descarte, { causal_confirmada: 5, resolubilidad_explorada: 3, orientacion_correcta: 5, puerta_abierta: 2 });
});

Deno.test("F48b hotfix C: criterio con acento en formato fase también se filtra", () => {
  // "Orientación correcta" (con acento) fue literalmente el phase_name que
  // quedó en prod. Sin el normalize compartido, este se cuela.
  const conAcento = `SCORE GENERAL: 30

${SMOKE_FASES}

Orientación correcta (5/5): la guía fue la adecuada.`;
  const p = parseClaudeOutput(conAcento, null);
  assertEquals(p.phases.map((f) => f.phase_name), FASES_REALES);
});

Deno.test("F48b hotfix: criterios FUERA del bloque, sin bloque plano — la excisión no aplica y el filtro sí", () => {
  // Aquí no hay bloque que cortar: si el filtro no existiera, las 4 junk pasan.
  const soloFormatoFase = `SCORE GENERAL: 30

${SMOKE_FASES}

Causal confirmada (5/5): x.
Resolubilidad explorada (3/5): y.
Orientacion correcta (5/5): z.
Puerta abierta (2/5): w.`;
  const p = parseClaudeOutput(soloFormatoFase, null);
  assertEquals(p.phases.map((f) => f.phase_name), FASES_REALES);
  assertEquals(p.descarte, null); // sin heading no hay bloque que leer
});

Deno.test("F48b hotfix: una fase real cuyo texto vive DENTRO del bloque no se pierde por la excisión", () => {
  // Guard de sobre-excisión: el corte termina en el separador, no se come el
  // resto del output.
  const p = parseClaudeOutput(`SCORE GENERAL: 30

${SMOKE_BLOQUE}

---

${SMOKE_FASES}`, null);
  assertEquals(p.phases.map((f) => f.phase_name), FASES_REALES);
  assertEquals(p.descarte!.puerta_abierta, 2);
});

Deno.test("F48b hotfix: stripDescarteBlock es no-op cuando no hay bloque", () => {
  const sinBloque = `SCORE GENERAL: 30\n\n${SMOKE_FASES}`;
  assertEquals(stripDescarteBlock(sinBloque), sinBloque);
});

Deno.test("F48b hotfix D: línea con forma de fase DENTRO del bloque — solo la excisión la caza", () => {
  // El filtro por nombre solo conoce los 4 criterios. Si el modelo agrega su
  // propio total dentro del bloque —comportamiento natural: acaba de sumar
  // cuatro puntajes— ese renglón tiene forma de fase y ningún nombre conocido.
  // Es la única capa que puede pararlo, y por eso el fix son dos y no una.
  const conTotal = `SCORE GENERAL: 30

${SMOKE_FASES}

---

EVALUACION DE DESCARTE
Causal confirmada: 5/5
Resolubilidad explorada: 3/5
Orientacion correcta: 5/5
Puerta abierta: 2/5
Total del manejo (15/20): resumen del descarte.`;
  const p = parseClaudeOutput(conTotal, null);
  assertEquals(p.phases.map((f) => f.phase_name), FASES_REALES);
  assertEquals(p.descarte!.causal_confirmada, 5);
});
