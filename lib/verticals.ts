// Stage-based classification helpers for aurisIQ verticals.

export const PRESENCIAL_STAGE_TYPES = ["visita"] as const;

/**
 * True si el stage_type implica sesión presencial (grabación en persona,
 * flujo /grabar).
 * - "visita" → true
 * - "llamada" → false (telefónico, flujo /analisis/nueva)
 * - "cierre" → false (stage terminal, sin modo de grabación implícito)
 * - null/undefined/otro → false
 */
export function isPresencialStageType(stageType: string | null | undefined): boolean {
  if (!stageType) return false;
  return (PRESENCIAL_STAGE_TYPES as readonly string[]).includes(stageType);
}

/**
 * True si la org tiene al menos un funnel_stage con stage_type="llamada".
 * Señal para decidir si el CTA de navegación debe rutear a /analisis/nueva.
 */
export function orgHasTelefonico(
  funnelStages: ReadonlyArray<{ stage_type?: string | null }> | null | undefined
): boolean {
  if (!funnelStages || funnelStages.length === 0) return false;
  return funnelStages.some((s) => s.stage_type === "llamada");
}

/**
 * True si la org tiene al menos un funnel_stage cuyo stage_type es
 * presencial (ver PRESENCIAL_STAGE_TYPES). Señal para decidir si el CTA
 * de navegación debe rutear a /grabar.
 */
export function orgHasPresencial(
  funnelStages: ReadonlyArray<{ stage_type?: string | null }> | null | undefined
): boolean {
  if (!funnelStages || funnelStages.length === 0) return false;
  return funnelStages.some((s) => isPresencialStageType(s.stage_type));
}

/**
 * True si el vertical del scorecard es "financiero".
 * Input es scorecards.vertical (scalar), NO organizations.vertical (array).
 * Úsalo para decidir UX per-análisis (ej: mostrar business_type / equipment_type de EnPagos).
 */
export function isFinancieroScorecard(scorecardVertical: string | null | undefined): boolean {
  return scorecardVertical === "financiero";
}
