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

export type SessionNoun = "llamada" | "visita" | "consulta";

/**
 * Returns the Spanish noun for a sales session.
 *
 * Replaces the binary pattern `isPresencialSession ? "consulta" : "llamada"`
 * which incorrectly maps presencial → consulta for all verticals. "Consulta"
 * is correct for salud/servicios (bodygreen, carone, dentistas, momentum);
 * inmobiliario uses "visita" instead.
 *
 * Signal priority: scorecardVertical (preferred, more precise) → orgSlug (fallback).
 * Default for presencial with unknown vertical: "consulta".
 */
export function getSessionNoun(
  isPresencial: boolean,
  context: { scorecardVertical?: string | null; orgSlug?: string | null }
): SessionNoun {
  if (!isPresencial) return "llamada";
  if (context.scorecardVertical === "inmobiliario") return "visita";
  if (context.orgSlug === "immobili") return "visita";
  return "consulta";
}

/**
 * Same as getSessionNoun but capitalized (for sentence-initial position).
 */
export function getSessionNounCap(
  isPresencial: boolean,
  context: { scorecardVertical?: string | null; orgSlug?: string | null }
): "Llamada" | "Visita" | "Consulta" {
  const n = getSessionNoun(isPresencial, context);
  return (n.charAt(0).toUpperCase() + n.slice(1)) as "Llamada" | "Visita" | "Consulta";
}
