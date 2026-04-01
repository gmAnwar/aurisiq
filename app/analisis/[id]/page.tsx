"use client";

import { useState, useEffect, use } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface Phase {
  phase_name: string;
  score: number;
  score_max: number;
}

interface Analysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  momento_critico: string | null;
  patron_error: string | null;
  objecion_principal: string | null;
  siguiente_accion: string | null;
  categoria_descalificacion: string[] | null;
  created_at: string;
}

interface DescalCategory {
  code: string;
  label: string;
}

export default function ResultadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [descalLabels, setDescalLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      const { data: a, error: aErr } = await supabase
        .from("analyses")
        .select("id, score_general, clasificacion, momento_critico, patron_error, objecion_principal, siguiente_accion, categoria_descalificacion, created_at")
        .eq("id", id)
        .single();

      if (aErr || !a) {
        setError("No se encontró este análisis.");
        setLoading(false);
        return;
      }

      setAnalysis(a);

      const { data: ph } = await supabase
        .from("analysis_phases")
        .select("phase_name, score, score_max")
        .eq("analysis_id", id)
        .order("created_at", { ascending: true });

      setPhases(ph || []);

      // Load descalification labels if needed
      if (a.categoria_descalificacion && a.categoria_descalificacion.length > 0) {
        const { data: userData } = await supabase
          .from("users")
          .select("organization_id")
          .eq("id", session.userId)
          .single();

        if (userData) {
          const { data: cats } = await supabase
            .from("descalification_categories")
            .select("code, label")
            .eq("organization_id", userData.organization_id);

          const map: Record<string, string> = {};
          for (const c of cats || []) {
            map[c.code] = c.label;
          }
          setDescalLabels(map);
        }
      }

      setLoading(false);
    }

    load();
  }, [id]);

  if (loading) {
    return (
      <div className="container c3-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-select" />
        <div className="skeleton-block skeleton-select" />
        <div className="skeleton-block skeleton-button" />
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="container c3-container">
        <div className="message-box message-error">
          <p>{error || "Error al cargar el análisis."}</p>
        </div>
        <a href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 16 }}>
          Nueva llamada
        </a>
      </div>
    );
  }

  const isQualified = !analysis.categoria_descalificacion || analysis.categoria_descalificacion.length === 0;
  const primaryDescal = analysis.categoria_descalificacion?.[0];
  const secondaryDescal = analysis.categoria_descalificacion?.slice(1) || [];

  // Strip JSON artifacts from Claude output (e.g. ```json { ... }```)
  const cleanText = (t: string | null) => {
    if (!t) return null;
    return t
      .replace(/```[\s\S]*$/g, "")          // strip from ``` to end
      .replace(/\n\s*\{[\s\S]*$/g, "")      // strip trailing JSON object
      .replace(/\s*json\s*\{[\s\S]*$/gi, "") // strip "json { ... }"
      .trim() || null;
  };

  // Reformat patron_error as positive improvement
  const mejora = cleanText(analysis.patron_error?.replace(/^[-•*]\s*/, ""));
  const accion = cleanText(analysis.siguiente_accion);
  const critico = cleanText(analysis.momento_critico);
  const objecion = cleanText(analysis.objecion_principal);

  return (
    <div className="container c3-container">
      {/* Result header — positive language */}
      <div className={`c3-result-badge ${isQualified ? "c3-badge-qualified" : "c3-badge-followup"}`}>
        {isQualified ? "Lead calificado" : "Lead requiere seguimiento"}
      </div>

      {/* Best phrase */}
      {accion && (
        <div className="c3-section">
          <p className="c3-section-label">Lo que funcionó mejor</p>
          <p className="c3-highlight">{accion}</p>
        </div>
      )}

      {/* Single concrete improvement */}
      {mejora && (
        <div className="c3-section">
          <p className="c3-section-label">Para tu siguiente llamada</p>
          <p className="c3-improvement">{mejora}</p>
        </div>
      )}

      {/* Descalification reasons with labels */}
      {!isQualified && (
        <div className="c3-section">
          <p className="c3-section-label">Razones de seguimiento</p>
          <div className="c3-descal-list">
            {primaryDescal && (
              <span className="c3-descal-primary">
                {descalLabels[primaryDescal] || "Razón no reconocida"}
              </span>
            )}
            {secondaryDescal.map((code, i) => (
              <span key={i} className="c3-descal-secondary">
                {descalLabels[code] || "Razón no reconocida"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Phase breakdown — sorted worst to best */}
      {phases.length > 0 && (
        <div className="c3-section">
          <p className="c3-section-label">Desglose por fase — de menor a mayor</p>
          <div className="c3-phases">
            {[...phases].sort((a, b) => {
              const pctA = a.score_max > 0 ? a.score / a.score_max : 0;
              const pctB = b.score_max > 0 ? b.score / b.score_max : 0;
              return pctA - pctB;
            }).map((p, i) => {
              const pct = p.score_max > 0 ? (p.score / p.score_max) * 100 : 0;
              const color = pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--gold)" : "var(--red)";
              return (
                <div key={i} className="c3-phase-row">
                  <div className="c3-phase-header">
                    <span className="c3-phase-name">{p.phase_name}</span>
                    <span className="c3-phase-score" style={{ color }}>{p.score}/{p.score_max}</span>
                  </div>
                  <div className="c3-phase-bar-bg">
                    <div className="c3-phase-bar-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expandable sections */}
      {critico && (
        <details className="c3-expandable">
          <summary className="c3-expand-summary">Momento crítico</summary>
          <div className="c3-expand-content">{critico}</div>
        </details>
      )}

      {objecion && (
        <details className="c3-expandable">
          <summary className="c3-expand-summary">Objeción principal</summary>
          <div className="c3-expand-content">{objecion}</div>
        </details>
      )}

      {/* Score at the bottom — not as headline */}
      {analysis.score_general !== null && (
        <div className="c3-score-footer">
          <span className="c3-score-label">Score general</span>
          <span className="c3-score-value">{analysis.score_general}</span>
          {analysis.clasificacion && (
            <span className={`c3-clasificacion c3-clas-${analysis.clasificacion}`}>
              {analysis.clasificacion}
            </span>
          )}
        </div>
      )}

      <a href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 24 }}>
        Analizar otra llamada
      </a>
    </div>
  );
}
