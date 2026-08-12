// Construcción PURA del updatePayload de writeAnalysisResults (sin I/O) — el
// guard de la suite (analysis-payload.test.ts) verifica aquí que
// EXTRACTION_WRITABLE_COLUMNS ⊆ keys del payload REAL, sin listas espejo.
// Los valores con I/O o atados a db.ts entran YA RESUELTOS como inputs:
// relatedId (lookup async), normalizedPhone (normalizePhone vive inlineado en
// db.ts por el Bug B del bundle con _shared/phone.ts — NO importarlo aquí),
// validDescal (filtro contra el catálogo, null-preservante F47) y discrepancy.
// Este módulo solo puede importar types.ts: los tests lo importan directo y
// no deben arrastrar env.ts (Deno.env en import) ni supabase-client (esm.sh).
import type { ParsedOutput } from "./types.ts";

export function buildAnalysisUpdatePayload(input: {
  parsed: ParsedOutput;
  callNotes: string | null;
  discrepancy: boolean;
  relatedId: string | null;
  normalizedPhone: string | null;
  validDescal: string[] | null;
  // F48a: 'fragmento' cuando el gate pre-LLM marcó el transcript como no
  // puntuable; null en análisis medibles (escribe NULL explícito, idempotente).
  unscorableReason: "fragmento" | null;
  // F48b: desempeño de la captadora ya derivado (computeScoreDesempeno). null
  // = no calculable — fragmento, descarte sin bloque, o histórico sin catálogo.
  scoreDesempeno: number | null;
}): Record<string, unknown> {
  const { parsed } = input;
  return {
    // F48a: NULL real preservado. El Math.min(parsed.score_general!, 100)
    // anterior convertía null en 0 (Math.min(null,100)===0 en JS) — con el
    // guard anti-drift de index.ts relajado para fragmentos, este builder es
    // null-safe SIEMPRE: el guard y el payload cambian JUNTOS o el fragmento
    // escribe 0 en silencio.
    score_general: parsed.score_general === null ? null : Math.min(parsed.score_general, 100),
    clasificacion: parsed.clasificacion,
    // F48b: separado de score_general — este es el número que la UI muestra
    // como principal. La columna clasificacion NO se re-deriva de aquí (la UI
    // la calcula data-driven desde el score que pinta).
    score_desempeno: input.scoreDesempeno,
    unscorable_reason: input.unscorableReason,
    momento_critico: parsed.momento_critico,
    patron_error: parsed.patron_error,
    objecion_principal: parsed.objecion_principal,
    siguiente_accion: parsed.siguiente_accion,
    conversion_discrepancy: input.discrepancy,
    lead_quality: parsed.lead_quality,
    lead_outcome: parsed.lead_outcome,
    categoria_descalificacion: input.validDescal,
    prospect_name: parsed.prospect_name,
    prospect_zone: parsed.prospect_zone,
    property_type: parsed.property_type,
    business_type: parsed.business_type,
    equipment_type: parsed.equipment_type,
    vehicle_interest: parsed.vehicle_interest,
    financing_type: parsed.financing_type,
    sale_reason: parsed.sale_reason,
    prospect_phone: input.normalizedPhone,
    checklist_results: parsed.checklist_results,
    notes: input.callNotes,
    related_analysis_id: input.relatedId,
    highlights: parsed.highlights.length > 0 ? parsed.highlights : [],
    status: "completado",
  };
}
