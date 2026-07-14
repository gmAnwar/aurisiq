// F46: diagnóstico de partial_extraction. Cubre el armado del objeto
// parser_debug (buildParserDebug), la ventana de captura anclada en 'ESTADO'
// (buildRawOutputCapture, Path 2), el saneo de null bytes, y la integración
// parse → raw_estado_block.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchPhaseIds, parseClaudeOutput } from "./parser.ts";
import { buildParserDebug, buildRawOutputCapture, stripNullBytes } from "./parser-debug.ts";

const NUL = String.fromCharCode(0);

const SCORECARD_PHASES = [
  { phase_id: "rapport_primera_impresion", score_max: 10, phase_name: "Rapport y Primera Impresión" },
  { phase_id: "validacion_propiedad", score_max: 25, phase_name: "Validación de Propiedad" },
  { phase_id: "presentacion_estrategia", score_max: 25, phase_name: "Presentación de Estrategia de Venta" },
  { phase_id: "manejo_objeciones_propietario", score_max: 25, phase_name: "Manejo de Objeciones del Propietario" },
  { phase_id: "cierre_exclusiva", score_max: 15, phase_name: "Cierre de Exclusiva" },
];
const ALL_IDS = SCORECARD_PHASES.map((p) => p.phase_id);

const PHASES = `Rapport y Primera Impresión (8/10): Buena conexión inicial.
Validación de Propiedad (20/25): Recorrió la propiedad.
Presentación de Estrategia de Venta (21/25): Plan con comparables.
Manejo de Objeciones del Propietario (22/25): Respondió con datos.
Cierre de Exclusiva (12/15): Pidió la firma.`;

const HEAD = `---
SCORE GENERAL: 82 Clasificación: buena
---
DIAGNÓSTICO POR FASE
${PHASES}
---
OBJECIONES DETECTADAS
Objeción: Comisión alta.
---
SIGUIENTE PASO CON ESTE PROSPECTO
Estado del lead: pending
Llamar el jueves.
---
PATRÓN DE ERROR PRINCIPAL
Cede rápido ante la primera objeción.`;

// Cola realista anexada DESPUÉS de ESTADO (verificado en claude.ts: PROSPECTO/
// ETAPA/DESCALIFICACION van "al final de tu respuesta"). Fuerza que ESTADO NO
// sea el último bloque del output.
const TAIL = `
---
EXTRACCION DE DATOS DEL PROSPECTO
PROSPECTO_NOMBRE: María
PROSPECTO_ZONA: Providencia
---
ETAPA_DETECTADA: Primera visita
---
DESCALIFICACION: []`;

function fullOutput(estadoBlock: string): string {
  return `${HEAD}
---
${estadoBlock}${TAIL}`;
}

// ─── Integración parse → raw_estado_block ──────────────────────────────────

Deno.test("parse: ESTADO sano → raw_estado_block poblado con el bloque crudo", () => {
  const estado = `ESTADO DEL LEAD
Calidad del lead: calificado
Resultado de esta conversación: pospuesto_con_agenda`;
  const parsed = parseClaudeOutput(fullOutput(estado), null);
  assert(parsed.raw_estado_block !== null);
  assert(parsed.raw_estado_block!.includes("Calidad del lead"));
  // El bloque NO debe arrastrar la cola PROSPECTO/DESCALIFICACION.
  assert(!parsed.raw_estado_block!.includes("DESCALIFICACION"));
});

Deno.test("parse: header ESTADO renombrado → raw_estado_block null", () => {
  const renamed = `SITUACIÓN FINAL DEL PROSPECTO
El lead quedó pendiente de confirmar. Sin definición clara.`;
  const parsed = parseClaudeOutput(fullOutput(renamed), null);
  assertEquals(parsed.raw_estado_block, null);
  assertEquals(parsed.lead_quality, null);
  assertEquals(parsed.lead_outcome, null);
});

// ─── (a) ESTADO presente, línea CALIDAD corrupta → missing_lead ────────────

Deno.test("(a) CALIDAD corrupta → trigger=missing_lead, raw_estado poblado, header_missing=false", () => {
  const estado = `ESTADO DEL LEAD
Calidad del lead: buenísimo excelente
Resultado de esta conversación: pospuesto_con_agenda`;
  const parsed = parseClaudeOutput(fullOutput(estado), null);
  const ids = matchPhaseIds(parsed.phases, SCORECARD_PHASES).map((p) => p.phase_id);
  assertEquals(parsed.lead_quality, null); // corrupta → null
  assertEquals(parsed.lead_outcome, "pospuesto_con_agenda");

  const dbg = buildParserDebug({
    rawOutput: fullOutput(estado),
    rawEstadoBlock: parsed.raw_estado_block,
    leadQuality: parsed.lead_quality,
    leadOutcome: parsed.lead_outcome,
    promptHasEstado: true,
    phasesFoundIds: ids,
    phasesExpected: 5,
    edgeVersion: "vTest",
  })!;
  assert(dbg !== null);
  assertEquals(dbg.trigger, "missing_lead");
  assertEquals(dbg.missing_fields, ["lead_quality"]);
  assertEquals(dbg.estado_header_missing, false);
  assert(dbg.raw_estado !== null);
  assert(dbg.raw_estado!.includes("buenísimo"));
  assertEquals(dbg.phases_found_ids, ALL_IDS);
});

// ─── (b) header ausente/renombrado → missing_lead + header_missing ─────────

Deno.test("(b) header renombrado → trigger=missing_lead, raw_estado=null, header_missing=true, capture con la región", () => {
  const renamed = `SITUACIÓN FINAL DEL PROSPECTO
El lead quedó pendiente de confirmar. Sin definición clara.`;
  const raw = fullOutput(renamed);
  const parsed = parseClaudeOutput(raw, null);
  const ids = matchPhaseIds(parsed.phases, SCORECARD_PHASES).map((p) => p.phase_id);

  const dbg = buildParserDebug({
    rawOutput: raw,
    rawEstadoBlock: parsed.raw_estado_block, // null
    leadQuality: parsed.lead_quality, // null
    leadOutcome: parsed.lead_outcome, // null
    promptHasEstado: true,
    phasesFoundIds: ids,
    phasesExpected: 5,
    edgeVersion: "vTest",
  })!;
  assertEquals(dbg.trigger, "missing_lead");
  assertEquals(dbg.raw_estado, null);
  assertEquals(dbg.estado_header_missing, true);
  assertEquals(dbg.missing_fields, ["lead_quality", "lead_outcome"]);
  assert(dbg.raw_output_capture !== null);
  assert(dbg.raw_output_capture!.includes("SITUACIÓN FINAL DEL PROSPECTO"));
});

// ─── (c) phases 3/5 con ESTADO sano → phases_mismatch ──────────────────────

Deno.test("(c) phases 3/5, ESTADO sano → trigger=phases_mismatch, counts correctos", () => {
  const dbg = buildParserDebug({
    rawOutput: "output con ESTADO DEL LEAD sano",
    rawEstadoBlock: "ESTADO DEL LEAD\nCalidad del lead: calificado",
    leadQuality: "calificado",
    leadOutcome: "pospuesto_con_agenda",
    promptHasEstado: true,
    phasesFoundIds: ["rapport_primera_impresion", "validacion_propiedad", "cierre_exclusiva"],
    phasesExpected: 5,
    edgeVersion: "vTest",
  })!;
  assertEquals(dbg.trigger, "phases_mismatch");
  assertEquals(dbg.phases_expected, 5);
  assertEquals(dbg.phases_found, 3);
  assertEquals(dbg.missing_fields, []); // lead fields OK
  assertEquals(dbg.estado_header_missing, false);
});

// ─── (d) ambas fallas → both ───────────────────────────────────────────────

Deno.test("(d) phases 3/5 + lead null → trigger=both", () => {
  const dbg = buildParserDebug({
    rawOutput: "output degradado",
    rawEstadoBlock: null,
    leadQuality: null,
    leadOutcome: null,
    promptHasEstado: true,
    phasesFoundIds: ["a", "b", "c"],
    phasesExpected: 5,
    edgeVersion: "vTest",
  })!;
  assertEquals(dbg.trigger, "both");
  assertEquals(dbg.missing_fields, ["lead_quality", "lead_outcome"]);
  assertEquals(dbg.estado_header_missing, true);
});

// ─── (e) camino feliz → null (cero escritura) ──────────────────────────────

Deno.test("(e) phases 5/5 + lead completo → buildParserDebug retorna null", () => {
  const dbg = buildParserDebug({
    rawOutput: "output sano",
    rawEstadoBlock: "ESTADO DEL LEAD\nCalidad del lead: calificado",
    leadQuality: "calificado",
    leadOutcome: "pospuesto_con_agenda",
    promptHasEstado: true,
    phasesFoundIds: ALL_IDS,
    phasesExpected: 5,
    edgeVersion: "vTest",
  });
  assertEquals(dbg, null);
});

Deno.test("(e2) sin ESTADO en el prompt + phases completas → null (lead null es esperado)", () => {
  const dbg = buildParserDebug({
    rawOutput: "scorecard sin bloque de lead",
    rawEstadoBlock: null,
    leadQuality: null,
    leadOutcome: null,
    promptHasEstado: false, // el prompt no pidió ESTADO → null no es pérdida
    phasesFoundIds: ALL_IDS,
    phasesExpected: 5,
    edgeVersion: "vTest",
  });
  assertEquals(dbg, null);
});

// ─── (f) null byte embebido → saneado ──────────────────────────────────────

Deno.test("(f) stripNullBytes elimina U+0000", () => {
  assertEquals(stripNullBytes(`a${NUL}b${NUL}c`), "abc");
  assert(!stripNullBytes(`x${NUL}`).includes(NUL));
});

Deno.test("(f) buildParserDebug sanea null bytes en raw_estado y raw_output_capture", () => {
  const dbg = buildParserDebug({
    rawOutput: `ESTADO DEL LEAD${NUL} corrupto`,
    rawEstadoBlock: `ESTADO DEL LEAD${NUL}\nCalidad del lead: ${NUL}basura`,
    leadQuality: null,
    leadOutcome: "pospuesto_con_agenda",
    promptHasEstado: true,
    phasesFoundIds: ALL_IDS,
    phasesExpected: 5,
    edgeVersion: "vTest",
  })!;
  assert(dbg.raw_estado !== null);
  assert(!dbg.raw_estado!.includes(NUL));
  assert(!dbg.raw_output_capture!.includes(NUL));
});

// ─── buildRawOutputCapture: anclaje Path 2 ─────────────────────────────────

Deno.test("capture: output <= cap → devuelve entero, truncated=false", () => {
  const r = buildRawOutputCapture("output corto");
  assertEquals(r.capture, "output corto");
  assertEquals(r.truncated, false);
});

Deno.test("capture: ESTADO cerca del final (cola corta) → rellena hacia atrás, incluye la región", () => {
  const raw = "x".repeat(9000) +
    "\n---\nESTADO DEL LEAD\nCalidad del lead: calificado\n---\nDESCALIFICACION: []";
  const r = buildRawOutputCapture(raw);
  assertEquals(r.truncated, true);
  assertEquals(r.capture.length, 8000);
  assert(r.capture.includes("ESTADO DEL LEAD"));
  assert(r.capture.includes("DESCALIFICACION")); // cola posterior a ESTADO preservada
  assert(r.capture !== raw); // filler inicial descartado
});

Deno.test("capture: ESTADO temprano + cola enorme → ancla hacia adelante desde ESTADO", () => {
  const raw = "intro larga\n---\nESTADO DEL LEAD\nCalidad del lead: calificado\n" + "y".repeat(9000);
  const r = buildRawOutputCapture(raw);
  assertEquals(r.truncated, true);
  assertEquals(r.capture.length, 8000);
  assert(r.capture.startsWith("ESTADO DEL LEAD"));
  assert(!r.capture.includes("intro larga")); // lo previo a ESTADO se descarta
});

Deno.test("capture: 'estado' ausente + output largo → últimos cap chars", () => {
  const raw = "z".repeat(9000);
  const r = buildRawOutputCapture(raw);
  assertEquals(r.truncated, true);
  assertEquals(r.capture.length, 8000);
});
