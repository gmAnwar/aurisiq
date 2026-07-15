// F42: regresión del parser V5B contra format drift del LLM.
// Cada caso de desviación fue reproducido en prod (smokes E2E Inmobili presencial)
// o derivado del diagnóstico F42 Fase 0. El parser endurecido debe extraer
// COMPLETO en todos: 5/5 fases + lead_quality + lead_outcome.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveScoreFromPhases, matchPhaseIds, parseClaudeOutput } from "./parser.ts";

const SCORECARD_PHASES = [
  { phase_id: "rapport_primera_impresion", score_max: 10, phase_name: "Rapport y Primera Impresión" },
  { phase_id: "validacion_propiedad", score_max: 25, phase_name: "Validación de Propiedad" },
  { phase_id: "presentacion_estrategia", score_max: 25, phase_name: "Presentación de Estrategia de Venta" },
  { phase_id: "manejo_objeciones_propietario", score_max: 25, phase_name: "Manejo de Objeciones del Propietario" },
  { phase_id: "cierre_exclusiva", score_max: 15, phase_name: "Cierre de Exclusiva" },
];

const V5B_PHASE_IDS = SCORECARD_PHASES.map((p) => p.phase_id);

const FASES = `Rapport y Primera Impresión (8/10): Buena conexión inicial con la propietaria.
Validación de Propiedad (20/25): Recorrió la propiedad y preguntó por escrituras.
Presentación de Estrategia de Venta (21/25): Plan de comercialización con comparables.
Manejo de Objeciones del Propietario (22/25): Respondió con datos la objeción de comisión.
Cierre de Exclusiva (12/15): Pidió la firma pero cedió ante la primera resistencia.`;

const HEAD = `---
SCORE GENERAL: 82 Clasificación: buena
---
DIAGNÓSTICO POR FASE
${FASES}
---
OBJECIONES DETECTADAS
Objeción: Comisión alta.
---
SIGUIENTE PASO CON ESTE PROSPECTO
Estado del lead: pending
Llamar el jueves.`;

const ESTADO = `ESTADO DEL LEAD
Calidad del lead: calificado
Razonamiento de calidad: Propiedad vendible y propietaria decisora.
Resultado de esta conversación: pospuesto_con_agenda
Razonamiento de resultado: Cita con fecha para firmar.`;

const PATRON = `PATRÓN DE ERROR PRINCIPAL
Cede rápido ante la primera objeción.`;

function assertFullExtraction(raw: string, label: string, cierreScore = 12) {
  const parsed = parseClaudeOutput(raw, null);
  const matched = matchPhaseIds(parsed.phases, SCORECARD_PHASES);
  assertEquals(matched.map((p) => p.phase_id), V5B_PHASE_IDS, `${label}: phase_ids`);
  const cierre = matched.find((p) => p.phase_id === "cierre_exclusiva")!;
  assertEquals(cierre.score, cierreScore, `${label}: cierre score`);
  assertEquals(cierre.score_max, 15, `${label}: cierre score_max`);
  assertEquals(parsed.lead_quality, "calificado", `${label}: lead_quality`);
  assertEquals(parsed.lead_outcome, "pospuesto_con_agenda", `${label}: lead_outcome`);
  assertEquals(parsed.score_general, 82, `${label}: score_general`);
  assertEquals(parsed.lead_status, "pending", `${label}: lead_status`);
}

Deno.test("spec-compliant: formato exacto del prompt V5B extrae 5/5 + lead fields", () => {
  assertFullExtraction(`${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`, "spec");
});

Deno.test("desviación A: ESTADO DEL LEAD como último bloque (sin PATRÓN después)", () => {
  assertFullExtraction(`${HEAD}\n---\n${ESTADO}`, "A");
});

Deno.test("desviación B: LLM fusiona bloques homónimos (Calidad/Resultado dentro de SIGUIENTE PASO)", () => {
  const raw = HEAD.replace(
    "Estado del lead: pending",
    `Estado del lead: pending
Calidad del lead: calificado
Resultado de esta conversación: pospuesto_con_agenda`,
  ) + `\n---\n${PATRON}`;
  assertFullExtraction(raw, "B");
});

Deno.test("desviación C: header markdown (## ESTADO DEL LEAD)", () => {
  assertFullExtraction(`${HEAD}\n---\n## ${ESTADO}\n---\n${PATRON}`, "C");
});

Deno.test("desviación D: separadores *** en vez de ---", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(/^---$/gm, "***");
  assertFullExtraction(raw, "D");
});

Deno.test("desviación E: fase no evaluada '(No evaluado/15)' → score 0, la fila existe", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Cierre de Exclusiva (12/15)",
    "Cierre de Exclusiva (No evaluado/15)",
  );
  assertFullExtraction(raw, "E", 0);
});

Deno.test("desviación F: espacios en el score '(12 / 15)'", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Cierre de Exclusiva (12/15)",
    "Cierre de Exclusiva (12 / 15)",
  );
  assertFullExtraction(raw, "F");
});

Deno.test("bold markdown en headers y fases sigue extrayendo completo", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`
    .replace("Cierre de Exclusiva (12/15):", "**Cierre de Exclusiva (12/15):**")
    .replace("ESTADO DEL LEAD\n", "**ESTADO DEL LEAD**\n");
  assertFullExtraction(raw, "bold");
});

Deno.test("valor fuera de enum en Calidad del lead → null (no basura a DB)", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: buenísimo",
  );
  const parsed = parseClaudeOutput(raw, null);
  assertEquals(parsed.lead_quality, null);
  assertEquals(parsed.lead_outcome, "pospuesto_con_agenda");
});

// F42 fix final: normalización de enum (capitalización, mayúsculas, trailing text)

Deno.test("enum: 'Calificado' capitalizado → calificado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: Calificado",
  );
  assertFullExtraction(raw, "enum-capitalizado");
});

Deno.test("enum: trailing text 'calificado — pendiente confirmar saldo'", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: calificado — pendiente confirmar saldo",
  );
  assertFullExtraction(raw, "enum-trailing");
});

Deno.test("enum: 'CALIFICADO' en mayúsculas totales", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: CALIFICADO",
  );
  assertFullExtraction(raw, "enum-mayusculas");
});

Deno.test("enum outcome: 'cerrado completo' con espacio → cerrado_completo", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Resultado de esta conversación: pospuesto_con_agenda",
    "Resultado de esta conversación: Cerrado completo",
  );
  const parsed = parseClaudeOutput(raw, null);
  assertEquals(parsed.lead_outcome, "cerrado_completo");
  assertEquals(parsed.lead_quality, "calificado");
});

// ─── F44: score_general derivado de la suma de fases ────────

const P = (id: string, score: number, max: number) => ({ phase_id: id, score, score_max: max });

Deno.test("F44 completo con suma != llm_score → sobrescribe y re-clasifica", () => {
  const phases = [P("a", 5, 10), P("b", 15, 25), P("c", 15, 25), P("d", 16, 25), P("e", 10, 15)]; // suma 61
  const r = deriveScoreFromPhases(82, "buena", phases, 5);
  assertEquals(r.score, 61);
  assertEquals(r.clasificacion, "regular"); // 61 < 65
  assertEquals(r.phaseSum, 61);
  assertEquals(r.overridden, true);
});

Deno.test("F44 extracción parcial (4/5) → conserva el valor del LLM", () => {
  const phases = [P("a", 8, 10), P("b", 20, 25), P("c", 21, 25), P("d", 22, 25)];
  const r = deriveScoreFromPhases(82, "buena", phases, 5);
  assertEquals(r.score, 82);
  assertEquals(r.clasificacion, "buena");
  assertEquals(r.phaseSum, null);
  assertEquals(r.overridden, false);
});

Deno.test("F44 suma == llm_score → no-op (visible en log via overridden=false + phaseSum)", () => {
  const phases = [P("a", 8, 10), P("b", 20, 25), P("c", 21, 25), P("d", 21, 25), P("e", 12, 15)]; // suma 82
  const r = deriveScoreFromPhases(82, "buena", phases, 5);
  assertEquals(r.score, 82);
  assertEquals(r.clasificacion, "buena");
  assertEquals(r.phaseSum, 82);
  assertEquals(r.overridden, false);
});

Deno.test("F44 frontera de clasificación: llm 87 (excelente) / suma 84 → buena", () => {
  const phases = [P("a", 9, 10), P("b", 21, 25), P("c", 21, 25), P("d", 21, 25), P("e", 12, 15)]; // suma 84
  const r = deriveScoreFromPhases(87, "excelente", phases, 5);
  assertEquals(r.score, 84);
  assertEquals(r.clasificacion, "buena"); // 84 < 85
  assertEquals(r.overridden, true);
});

Deno.test("F44 phase_ids duplicados → no completa, conserva el LLM", () => {
  const phases = [P("a", 8, 10), P("a", 20, 25), P("c", 21, 25), P("d", 21, 25), P("e", 12, 15)];
  const r = deriveScoreFromPhases(82, "buena", phases, 5);
  assertEquals(r.score, 82);
  assertEquals(r.overridden, false);
});

Deno.test("F44 suma con scores clampeados (30/25 cuenta como 25)", () => {
  const phases = [P("a", 10, 10), P("b", 30, 25), P("c", 25, 25), P("d", 25, 25), P("e", 15, 15)]; // clampeado: 100
  const r = deriveScoreFromPhases(90, "excelente", phases, 5);
  assertEquals(r.score, 100);
  assertEquals(r.phaseSum, 100);
  assertEquals(r.clasificacion, "excelente");
  assertEquals(r.overridden, true);
});

// ─── F42b: lead_quality en prosa, negación, substring y label-variantes ─────

Deno.test("F42b prosa: 'El lead es calificado' → calificado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: El lead es calificado",
  );
  assertEquals(parseClaudeOutput(raw, null).lead_quality, "calificado");
});

Deno.test("F42b prefijo: 'Pendiente, pero calificado' → calificado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: Pendiente, pero calificado",
  );
  assertEquals(parseClaudeOutput(raw, null).lead_quality, "calificado");
});

Deno.test("F42b negación: 'no calificado aún' → indeterminado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: no calificado aún",
  );
  assertEquals(parseClaudeOutput(raw, null).lead_quality, "indeterminado");
});

Deno.test("F42b substring trap: 'descalificado por gravamen' → descalificado (NO calificado)", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del lead: descalificado por gravamen",
  );
  assertEquals(parseClaudeOutput(raw, null).lead_quality, "descalificado");
});

Deno.test("F42b label-variante: 'Calidad: calificado' (sin 'del lead') → calificado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad: calificado",
  );
  assertEquals(parseClaudeOutput(raw, null).lead_quality, "calificado");
});

// ─── F42c: label "Calidad del prospecto" (drift inducido por TONE_BLOCK) ────

Deno.test("F42c caso real ee7104f7: 'Calidad del prospecto: indeterminado' → indeterminado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del prospecto: indeterminado\nRazonamiento de calidad: La propiedad existe, tiene escrituras y el crédito fue cancelado, pero no puede captarse porque las escrituras no están a nombre de la propietaria.",
  );
  const parsed = parseClaudeOutput(raw, null);
  assertEquals(parsed.lead_quality, "indeterminado");
  assertEquals(parsed.lead_outcome, "pospuesto_con_agenda");
});

Deno.test("F42c guarda de negación viva con label prospecto: 'no calificado' → indeterminado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del prospecto: no calificado por el momento",
  );
  assertEquals(parseClaudeOutput(raw, null).lead_quality, "indeterminado");
});

Deno.test("F42c longest-first vivo con label prospecto: 'descalificado' NO matchea calificado", () => {
  const raw = `${HEAD}\n---\n${ESTADO}\n---\n${PATRON}`.replace(
    "Calidad del lead: calificado",
    "Calidad del prospecto: descalificado por gravamen irresoluble",
  );
  assertEquals(parseClaudeOutput(raw, null).lead_quality, "descalificado");
});
