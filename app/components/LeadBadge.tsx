"use client";

interface Props {
  quality: string | null | undefined;
}

/**
 * Renders a lead quality badge.
 * Uses the same .c3-lead-badge classes as the legacy inline implementation
 * so visual style is identical.
 */
export default function LeadBadge({ quality }: Props) {
  if (quality === "calificado") {
    return (
      <span className="c3-lead-badge c3-lead-calificado" style={{ fontSize: 12, padding: "3px 10px" }}>
        Lead calificado
      </span>
    );
  }
  if (quality === "descalificado") {
    return (
      <span className="c3-lead-badge c3-lead-descartado" style={{ fontSize: 12, padding: "3px 10px" }}>
        Lead descalificado
      </span>
    );
  }
  if (quality === "indeterminado") {
    return (
      <span className="c3-lead-badge c3-lead-pendiente" style={{ fontSize: 12, padding: "3px 10px" }}>
        Calidad indeterminada
      </span>
    );
  }
  // null / undefined / unknown value — render nothing (matches legacy behavior)
  return null;
}
