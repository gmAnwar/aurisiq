import { orgHasTelefonico, orgHasPresencial, getSessionNoun, type SessionNoun } from "./verticals";

export interface CtaRoutingInput {
  // true si el user puede crear análisis. Equivalente a la condición showCta
  // actual del NavBar (captadora en roles[] O role === "super_admin").
  hasCaptadora: boolean;
  funnelStages: ReadonlyArray<{ stage_type?: string | null }> | null | undefined;
  // Slug de la org activa. Señal fallback para getSessionNoun cuando no hay
  // scorecardVertical disponible (caso típico: NavBar y FAB no conocen el
  // stage/scorecard seleccionado porque viven arriba del page).
  orgSlug: string | null | undefined;
}

export interface CtaRoutingOutput {
  showCta: boolean;
  href: "/analisis/nueva" | "/grabar" | null;
  label: "Nueva llamada" | "Nueva visita" | "Nueva consulta" | null;
  ariaLabel: "Grabar llamada" | "Grabar visita" | "Grabar consulta" | "";
  /**
   * @deprecated As of Commit 4, always false. The sidebar "Grabar" shortcut
   * was removed to unify the entry UX: mixed orgs (Inmobili) now rely on the
   * main CTA routing to /analisis/nueva where the V5B pill covers presencial.
   * Key preserved in the interface in case we decide to re-introduce a
   * stage-kind secondary action later.
   */
  showSidebarGrabar: boolean;
}

function nuevaLabel(noun: SessionNoun): "Nueva llamada" | "Nueva visita" | "Nueva consulta" {
  if (noun === "llamada") return "Nueva llamada";
  if (noun === "visita") return "Nueva visita";
  return "Nueva consulta";
}

function grabarAria(noun: SessionNoun): "Grabar llamada" | "Grabar visita" | "Grabar consulta" {
  if (noun === "llamada") return "Grabar llamada";
  if (noun === "visita") return "Grabar visita";
  return "Grabar consulta";
}

export function resolveGrabarCta(input: CtaRoutingInput): CtaRoutingOutput {
  const { hasCaptadora, funnelStages, orgSlug } = input;

  if (!hasCaptadora) {
    return { showCta: false, href: null, label: null, ariaLabel: "", showSidebarGrabar: false };
  }

  const hasTel = orgHasTelefonico(funnelStages);
  const hasPres = orgHasPresencial(funnelStages);

  if (!hasTel && !hasPres) {
    const noun = getSessionNoun(false, { orgSlug });
    return { showCta: true, href: "/analisis/nueva", label: nuevaLabel(noun), ariaLabel: grabarAria(noun), showSidebarGrabar: false };
  }
  if (hasTel && hasPres) {
    const noun = getSessionNoun(false, { orgSlug });
    return { showCta: true, href: "/analisis/nueva", label: nuevaLabel(noun), ariaLabel: grabarAria(noun), showSidebarGrabar: false };
  }
  if (hasTel) {
    const noun = getSessionNoun(false, { orgSlug });
    return { showCta: true, href: "/analisis/nueva", label: nuevaLabel(noun), ariaLabel: grabarAria(noun), showSidebarGrabar: false };
  }
  const noun = getSessionNoun(true, { orgSlug });
  return { showCta: true, href: "/grabar", label: nuevaLabel(noun), ariaLabel: grabarAria(noun), showSidebarGrabar: false };
}
