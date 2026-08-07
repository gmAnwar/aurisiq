// F48a: gate de fragmento + contrato de escritura NULL-honesta.
// Casos derivados del inventario Fase 0 (6-ago-2026): frontera estricta 1,500;
// fragmento con causal (patrón 5fc05d84: 1,164 chars, juridico); precedencia
// rechazado > fragmento (2 de los 9 rechazados históricos están bajo 1,500 —
// 304 y 1,476 chars); y no-regresión de la rama scored.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FRAGMENT_MIN_CHARS, isFragmentTranscript, buildFragmentPrompt, parseFragmentOutput } from "./fragment.ts";
import { REJECTION_INSTRUCTION_BLOCK } from "./prompt-blocks.ts";
import { parseClaudeOutput } from "./parser.ts";
import { buildAnalysisUpdatePayload } from "./analysis-payload.ts";
import type { Scorecard } from "./types.ts";

const SCORECARD = {
  id: "sc-test",
  organization_id: "org-test",
  name: "V5A test",
  version: "1",
  vertical: "inmobiliario",
  phases: [],
  prompt_template: "",
  template_id: null,
  structure: null,
} as unknown as Scorecard;

const DESCAL_CATS = [
  { code: "juridico", label: "Problema jurídico" },
  { code: "adeudo_alto", label: "Adeudo alto" },
];

// ─── Gate: frontera estricta ────────────────────────────────

Deno.test("F48a frontera: 1,499 es fragmento; 1,500 exacto y 1,501 NO", () => {
  assertEquals(FRAGMENT_MIN_CHARS, 1500);
  assertEquals(isFragmentTranscript("x".repeat(1499)), true);
  assertEquals(isFragmentTranscript("x".repeat(1500)), false);
  assertEquals(isFragmentTranscript("x".repeat(1501)), false);
});

Deno.test("F48a gate: vacío, null, undefined y whitespace-only son fragmento", () => {
  assertEquals(isFragmentTranscript(""), true);
  assertEquals(isFragmentTranscript(null), true);
  assertEquals(isFragmentTranscript(undefined), true);
  // 2,000 espacios superan el umbral en length pero no tienen contenido real
  assertEquals(isFragmentTranscript(" ".repeat(2000)), true);
});

// ─── Escritura: NULL real, nunca 0 ni "regular" ─────────────

// Output típico del prompt de fragmento: sin SCORE GENERAL ni fases.
const FRAGMENT_OUTPUT = `---

SIGUIENTE PASO CON ESTE PROSPECTO

Acción concreta: Llamar de vuelta hoy mismo — la llamada se cortó con interés vivo del propietario. Un seguimiento inmediato puede rescatar la oportunidad.

---

ESTADO DEL LEAD

Calidad del lead: indeterminado
Resultado de esta conversación: pospuesto_sin_agenda

---

PROSPECTO_NOMBRE: No identificado
PROSPECTO_ZONA: No identificada
DESCALIFICACION: []`;

Deno.test("F48a fragmento: score_general y clasificacion NULL en el payload — nunca 0 ni 'regular'", () => {
  // parseFragmentOutput: el output de fragmento arranca en "---" (posición 0)
  // y el parser exige \n---\n — la normalización vive en fragment.ts.
  const parsed = parseFragmentOutput(FRAGMENT_OUTPUT, null);
  assertEquals(parsed.score_general, null);
  assertEquals(parsed.clasificacion, null);
  // El feedback breve (siguiente_accion) se conserva
  assert(parsed.siguiente_accion !== null && parsed.siguiente_accion.includes("hoy mismo"));

  const payload = buildAnalysisUpdatePayload({
    parsed,
    callNotes: null,
    discrepancy: false,
    relatedId: null,
    normalizedPhone: null,
    validDescal: [],
    unscorableReason: "fragmento",
  });
  // La trampa Math.min(null!, 100) === 0 queda cerrada: NULL real
  assertEquals(payload.score_general, null);
  assertEquals(payload.clasificacion, null);
  assertEquals(payload.unscorable_reason, "fragmento");
  assertEquals(payload.status, "completado");
});

// ─── Fragmento con causal (caso 5fc05d84: 1,164 chars, juridico) ──

const FRAGMENT_DESCAL_OUTPUT = `---

SIGUIENTE PASO CON ESTE PROSPECTO

Acción concreta: Documentar la causal y cerrar el expediente — el propietario confirmó intestamentario sin resolución.

---

ESTADO DEL LEAD

Calidad del lead: descalificado
Resultado de esta conversación: descalificado

---

PROSPECTO_NOMBRE: No identificado
DESCALIFICACION: ["juridico"]`;

Deno.test("F48a fragmento con causal: score NULL pero categoria_descalificacion y lead_quality intactos", () => {
  const parsed = parseFragmentOutput(FRAGMENT_DESCAL_OUTPUT, null);
  assertEquals(parsed.lead_quality, "descalificado");
  assertEquals(parsed.lead_outcome, "descalificado");
  assertEquals(parsed.descalificacion, ["juridico"]);

  const validCodes = new Set(DESCAL_CATS.map((c) => c.code));
  const validDescal = parsed.descalificacion!.filter((c) => validCodes.has(c));
  const payload = buildAnalysisUpdatePayload({
    parsed,
    callNotes: null,
    discrepancy: false,
    relatedId: null,
    normalizedPhone: null,
    validDescal,
    unscorableReason: "fragmento",
  });
  assertEquals(payload.score_general, null);
  assertEquals(payload.categoria_descalificacion, ["juridico"]);
  assertEquals(payload.lead_quality, "descalificado");
  assertEquals(payload.unscorable_reason, "fragmento");
});

// ─── Precedencia: rechazado > fragmento (caso 304 chars) ────

Deno.test("F48a precedencia: el prompt de fragmento CONSERVA la capacidad de rechazo", () => {
  const { systemPrompt } = buildFragmentPrompt(SCORECARD, DESCAL_CATS);
  // El bloque canónico de rechazo viaja completo — el modelo puede llamar
  // report_audio_not_analyzable sobre un fragmento (ej. el rechazado histórico
  // de 304 chars). La precedencia vive en el control flow de index.ts: el
  // branch rejected (7b) corre ANTES del write de fragmento y rejectAnalysis
  // nunca escribe unscorable_reason (queda NULL — el status carga el significado).
  assert(systemPrompt.includes(REJECTION_INSTRUCTION_BLOCK), "falta REJECTION_INSTRUCTION_BLOCK");
  assert(systemPrompt.includes("report_audio_not_analyzable"), "falta el nombre del tool");
  // La instrucción de fragmento prohíbe el score explícitamente
  assert(systemPrompt.includes("NO generes SCORE GENERAL"), "falta la prohibición de score");
  // F42: bloques enumerados completos incluyendo ESTADO DEL LEAD + anti-fusión
  assert(systemPrompt.includes("exactamente 2 bloques"), "falta la enumeración de bloques");
  assert(systemPrompt.includes("ESTADO DEL LEAD como bloque separado"), "falta la cláusula anti-fusión");
  // Catálogo de descalificación presente (fragmento con causal debe poder emitirla)
  assert(systemPrompt.includes("DESCALIFICACION DE LEADS"), "falta el bloque de descalificación");
});

Deno.test("F48a: sin catálogo de descal, el prompt de fragmento no pide DESCALIFICACION", () => {
  const { systemPrompt } = buildFragmentPrompt(SCORECARD, []);
  assertEquals(systemPrompt.includes("DESCALIFICACION DE LEADS"), false);
});

// ─── No-regresión: rama scored intacta ──────────────────────

Deno.test("F48a no-regresión: análisis scored conserva score/clasificacion y unscorable_reason NULL", () => {
  const parsed = parseClaudeOutput("SCORE GENERAL: 82 Clasificación: buena", null);
  const payload = buildAnalysisUpdatePayload({
    parsed,
    callNotes: null,
    discrepancy: false,
    relatedId: null,
    normalizedPhone: null,
    validDescal: [],
    unscorableReason: null,
  });
  assertEquals(payload.score_general, 82);
  assertEquals(payload.clasificacion, "buena");
  assertEquals(payload.unscorable_reason, null);
  assertEquals(payload.status, "completado");
});

Deno.test("F48a no-regresión: el clamp a 100 sigue vivo para scores válidos", () => {
  const parsed = parseClaudeOutput("SCORE GENERAL: 105", null);
  const payload = buildAnalysisUpdatePayload({
    parsed,
    callNotes: null,
    discrepancy: false,
    relatedId: null,
    normalizedPhone: null,
    validDescal: [],
    unscorableReason: null,
  });
  assertEquals(payload.score_general, 100);
});
