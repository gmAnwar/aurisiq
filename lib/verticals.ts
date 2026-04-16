// Centralized vertical logic — single source of truth for presencial vs financiero

export const PRESENCIAL_VERTICALS = [
  "presencial_salud",
  "quiropractico",
  "body_spa",
  "dentistas",
  "automotriz",
] as const;

export const FINANCIERO_VERTICALS = ["financiero"] as const;

/**
 * Returns true if the org vertical is presencial (not telefónico/financiero).
 * Accepts string or string[] (organizations.vertical is text[]).
 */
export function isPresencial(vertical: string | string[] | null | undefined): boolean {
  if (!vertical) return false;
  const v = Array.isArray(vertical) ? vertical : [vertical];
  return v.some((val) => val !== "financiero");
}

/**
 * Returns true if vertical is explicitly financiero.
 */
export function isFinanciero(vertical: string | string[] | null | undefined): boolean {
  if (!vertical) return false;
  const v = Array.isArray(vertical) ? vertical : [vertical];
  return v.includes("financiero");
}
