// Centralized vertical/stage logic — single source of truth for
// presencial vs telefónico decisions across NavBar, CTAs and /analisis/nueva.
//
// The stage-based API (isPresencialStageType, orgHasTelefonico,
// orgHasPresencial) is the correct signal for per-session and per-org
// routing. The org-vertical-based helpers below (isPresencial,
// isFinanciero) are @deprecated: they mis-classify mixed orgs (e.g.
// Inmobili has vertical="inmobiliario" but its funnel has both llamada
// V5A/V5C and visita V5B stages).

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
 * @deprecated Use isPresencialStageType(stage_type) or orgHasPresencial(funnelStages)
 * instead. This helper classifies by organizations.vertical, which is
 * incorrect for mixed orgs (e.g. Inmobili with vertical="inmobiliario"
 * but mixed llamada+visita funnel). Kept byte-exact for call sites not
 * yet migrated; scheduled for removal in the final migration commit.
 */
export function isPresencial(vertical: string | string[] | null | undefined): boolean {
  if (!vertical) return false;
  const v = Array.isArray(vertical) ? vertical : [vertical];
  return v.some((val) => val !== "financiero");
}

/**
 * @deprecated Use isPresencialStageType / org-level helpers. See note on
 * isPresencial above. Kept byte-exact for the single remaining call site
 * in app/analisis/[id]/page.tsx (which uses it to toggle a financiero-only
 * UI field); scheduled for migration in the final commit.
 */
export function isFinanciero(vertical: string | string[] | null | undefined): boolean {
  if (!vertical) return false;
  const v = Array.isArray(vertical) ? vertical : [vertical];
  return v.includes("financiero");
}
