import { orgHasTelefonico, orgHasPresencial } from "./verticals";

export interface CtaRoutingInput {
  // true si el user puede crear análisis. Equivalente a la condición showCta
  // actual del NavBar (captadora en roles[] O role === "super_admin").
  hasCaptadora: boolean;
  funnelStages: ReadonlyArray<{ stage_type?: string | null }> | null | undefined;
}

export interface CtaRoutingOutput {
  showCta: boolean;
  href: "/analisis/nueva" | "/grabar" | null;
  label: "Nueva llamada" | "Nueva consulta" | null;
  /**
   * @deprecated As of Commit 4, always false. The sidebar "Grabar" shortcut
   * was removed to unify the entry UX: mixed orgs (Inmobili) now rely on the
   * main CTA routing to /analisis/nueva where the V5B pill covers presencial.
   * Key preserved in the interface in case we decide to re-introduce a
   * stage-kind secondary action later.
   */
  showSidebarGrabar: boolean;
}

export function resolveGrabarCta(input: CtaRoutingInput): CtaRoutingOutput {
  const { hasCaptadora, funnelStages } = input;

  if (!hasCaptadora) {
    return { showCta: false, href: null, label: null, showSidebarGrabar: false };
  }

  const hasTel = orgHasTelefonico(funnelStages);
  const hasPres = orgHasPresencial(funnelStages);

  if (!hasTel && !hasPres) {
    return { showCta: true, href: "/analisis/nueva", label: "Nueva llamada", showSidebarGrabar: false };
  }
  if (hasTel && hasPres) {
    return { showCta: true, href: "/analisis/nueva", label: "Nueva llamada", showSidebarGrabar: false };
  }
  if (hasTel) {
    return { showCta: true, href: "/analisis/nueva", label: "Nueva llamada", showSidebarGrabar: false };
  }
  return { showCta: true, href: "/grabar", label: "Nueva consulta", showSidebarGrabar: false };
}
