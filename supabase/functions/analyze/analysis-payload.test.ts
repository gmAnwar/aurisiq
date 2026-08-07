// Guard del contrato de persistencia: EXTRACTION_WRITABLE_COLUMNS debe ser
// subconjunto REAL de (a) las keys de ParsedOutput y (b) las keys del
// updatePayload que construye buildAnalysisUpdatePayload — verificado en
// runtime contra los objetos reales, sin listas espejo tautológicas. Si
// alguien agrega una column al set sin cablearla en ambos lados (o agrega el
// campo sin meterla al set y la declara en un scorecard), la suite truena o
// la alerta extraction_config_invalid la delata en prod.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EXTRACTION_WRITABLE_COLUMNS, parseClaudeOutput } from "./parser.ts";
import { buildAnalysisUpdatePayload } from "./analysis-payload.ts";

const parsedSample = parseClaudeOutput("SCORE GENERAL: 80", null);
const payloadSample = buildAnalysisUpdatePayload({
  parsed: parsedSample,
  callNotes: null,
  discrepancy: false,
  relatedId: null,
  normalizedPhone: null,
  validDescal: [],
  unscorableReason: null,
});

Deno.test("guard: cada column del set existe en ParsedOutput (runtime, no espejo)", () => {
  for (const col of EXTRACTION_WRITABLE_COLUMNS) {
    assert(col in parsedSample, `EXTRACTION_WRITABLE_COLUMNS incluye '${col}' pero ParsedOutput no la tiene`);
  }
});

Deno.test("guard: cada column del set existe en el updatePayload real", () => {
  for (const col of EXTRACTION_WRITABLE_COLUMNS) {
    assert(col in payloadSample, `EXTRACTION_WRITABLE_COLUMNS incluye '${col}' pero buildAnalysisUpdatePayload no la escribe`);
  }
});

Deno.test("guard: el payload preserva los valores de las columns del set y los inputs resueltos", () => {
  const parsed = parseClaudeOutput("SCORE GENERAL: 80", null);
  parsed.vehicle_interest = "Sedán 2023";
  parsed.financing_type = "Contado";
  const payload = buildAnalysisUpdatePayload({
    parsed,
    callNotes: "nota manual de la captadora",
    discrepancy: false,
    relatedId: null,
    normalizedPhone: "5215512141618",
    validDescal: null,
    unscorableReason: null,
  });
  assertEquals(payload.vehicle_interest, "Sedán 2023");
  assertEquals(payload.financing_type, "Contado");
  assertEquals(payload.prospect_phone, "5215512141618");
  assertEquals(payload.notes, "nota manual de la captadora");
  assertEquals(payload.categoria_descalificacion, null);
  assertEquals(payload.unscorable_reason, null);
  assertEquals(payload.status, "completado");
});
