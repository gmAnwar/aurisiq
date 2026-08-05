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
}): Record<string, unknown> {
  const { parsed } = input;
  return {
    score_general: Math.min(parsed.score_general!, 100),
    clasificacion: parsed.clasificacion,
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
