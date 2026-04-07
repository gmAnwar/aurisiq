/**
 * Helper to get the UI label for a user's role based on their organization.
 *
 * The technical role in users.role stays as 'captadora' always.
 * The UI string varies by niche: "Captadora" for Inmobili (real estate),
 * "Ejecutivo" for EnPagos (credit), etc.
 *
 * Source of truth (in order):
 *   1. organization.role_label_vendedor — editable field added in migration 014
 *   2. Hardcoded fallback by organization slug — for environments where the
 *      migration hasn't been applied yet
 *   3. "Captadora" as final default
 *
 * Other roles (gerente, direccion, etc.) are fixed.
 */

interface OrgLabelContext {
  slug?: string | null;
  role_label_vendedor?: string | null;
}

const VENDEDOR_FALLBACK_BY_SLUG: Record<string, string> = {
  immobili: "Captadora",
  enpagos: "Ejecutivo",
};

const FIXED_LABELS: Record<string, string> = {
  gerente: "Gerente",
  direccion: "Dirección",
  agencia: "Agencia",
  super_admin: "Admin",
};

export function getRoleLabel(role: string, organization?: OrgLabelContext | null): string {
  if (role === "captadora") {
    if (organization?.role_label_vendedor) return organization.role_label_vendedor;
    if (organization?.slug && VENDEDOR_FALLBACK_BY_SLUG[organization.slug]) {
      return VENDEDOR_FALLBACK_BY_SLUG[organization.slug];
    }
    return "Captadora";
  }
  return FIXED_LABELS[role] || role;
}

/**
 * Plural form for headings/labels ("Captadoras", "Ejecutivos").
 */
export function getRoleLabelPlural(role: string, organization?: OrgLabelContext | null): string {
  const singular = getRoleLabel(role, organization);
  if (singular.endsWith("a")) return singular + "s";
  if (singular.endsWith("o")) return singular + "s";
  return singular + "s";
}
