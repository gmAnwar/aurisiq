"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface PhaseGroup {
  phase_name: string;
  phrases: string[];
}

interface SpeechVersion {
  id: string;
  content: Record<string, string[]>;
  version_number: number;
  updated_at: string;
}

export default function SpeechPage() {
  const [phases, setPhases] = useState<PhaseGroup[]>([]);
  const [speechVersion, setSpeechVersion] = useState<SpeechVersion | null>(null);
  const [expandedSpeech, setExpandedSpeech] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      const userData = { organization_id: session.organizationId };

      // Get active scorecard phases
      const { data: scorecards } = await supabase
        .from("scorecards")
        .select("id, phases, name")
        .or(`organization_id.eq.${userData.organization_id},organization_id.is.null`)
        .eq("active", true)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1);

      const scorecard = scorecards?.[0];
      if (!scorecard) { setLoading(false); return; }

      // Get user's analysis phases — last 20 analyses for best phrases
      const { data: userPhases } = await supabase
        .from("analysis_phases")
        .select("phase_name, score, score_max, created_at, analysis_id")
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(100);

      // Get the analyses with siguiente_accion for phrases
      const analysisIds = [...new Set((userPhases || []).map(p => p.analysis_id))].slice(0, 20);

      let analysesPhrases: Record<string, string[]> = {};
      if (analysisIds.length > 0) {
        const { data: analyses } = await supabase
          .from("analyses")
          .select("id, siguiente_accion, objecion_principal")
          .in("id", analysisIds);

        // Group best phrases by phase — pick from highest-scoring analyses
        const phaseScores: Record<string, { score: number; analysisId: string }[]> = {};
        for (const p of userPhases || []) {
          if (!phaseScores[p.phase_name]) phaseScores[p.phase_name] = [];
          phaseScores[p.phase_name].push({ score: p.score, analysisId: p.analysis_id });
        }

        for (const [phaseName, scores] of Object.entries(phaseScores)) {
          scores.sort((a, b) => b.score - a.score);
          const topIds = scores.slice(0, 3).map(s => s.analysisId);
          const phrases: string[] = [];
          for (const aId of topIds) {
            const a = (analyses || []).find(x => x.id === aId);
            if (a?.siguiente_accion && !phrases.includes(a.siguiente_accion)) {
              phrases.push(a.siguiente_accion);
            }
          }
          analysesPhrases[phaseName] = phrases.slice(0, 3);
        }
      }

      // Build phase groups from scorecard phases
      const scorecardPhases = scorecard.phases || [];
      const groups: PhaseGroup[] = scorecardPhases.map((sp: { phase_name: string }) => ({
        phase_name: sp.phase_name,
        phrases: analysesPhrases[sp.phase_name] || [],
      }));

      // If no scorecard phases, use what we have from analysis_phases
      if (groups.length === 0) {
        const seenPhases = new Set<string>();
        for (const p of userPhases || []) {
          if (!seenPhases.has(p.phase_name)) {
            seenPhases.add(p.phase_name);
            groups.push({
              phase_name: p.phase_name,
              phrases: analysesPhrases[p.phase_name] || [],
            });
          }
        }
      }

      setPhases(groups);

      if (userPhases && userPhases.length > 0) {
        setLastUpdated(userPhases[0].created_at);
      }

      // Check for published speech version from gerente
      const { data: published } = await supabase
        .from("speech_versions")
        .select("id, content, version_number, updated_at")
        .eq("scorecard_id", scorecard.id)
        .eq("published", true)
        .limit(1);

      if (published && published.length > 0) {
        setSpeechVersion(published[0]);
      }

      setLoading(false);
    }

    load();
  }, []);

  if (loading) {
    return (
      <div className="container c5-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  return (
    <div className="container c5-container">
      <div className="c5-header">
        <h1 className="c5-title">Mi Speech</h1>
        <p className="c5-subtitle">Frases clave por fase de tu scorecard</p>
        {lastUpdated && (
          <p className="c5-updated">
            Actualizado el {new Date(lastUpdated).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        )}
      </div>

      {phases.length === 0 && (
        <div className="c4-empty">
          <p>Aún no tienes suficientes análisis para generar frases clave.</p>
          <p>Analiza al menos 3 llamadas para ver recomendaciones aquí.</p>
        </div>
      )}

      <div className="c5-phases">
        {phases.map((group, i) => (
          <div key={i} className="c5-phase-card">
            <h3 className="c5-phase-name">{group.phase_name}</h3>
            {group.phrases.length > 0 ? (
              <ul className="c5-phrase-list">
                {group.phrases.map((phrase, j) => (
                  <li key={j} className="c5-phrase">{phrase}</li>
                ))}
              </ul>
            ) : (
              <p className="c5-no-phrases">Sin frases destacadas aún</p>
            )}
          </div>
        ))}
      </div>

      {speechVersion && (
        <div className="c5-published-section">
          <button
            className="c5-expand-btn"
            onClick={() => setExpandedSpeech(!expandedSpeech)}
          >
            {expandedSpeech ? "Ocultar speech ideal" : "Ver speech ideal del gerente"}
          </button>
          {expandedSpeech && (
            <div className="c5-published-content">
              <p className="c5-published-meta">
                Versión {speechVersion.version_number} — {new Date(speechVersion.updated_at).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
              </p>
              {Object.entries(speechVersion.content || {}).map(([phase, phrases]) => (
                <div key={phase} className="c5-phase-card">
                  <h3 className="c5-phase-name">{phase}</h3>
                  <ul className="c5-phrase-list">
                    {(phrases as string[]).map((p, j) => (
                      <li key={j} className="c5-phrase">{p}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <a href="/analisis" className="c5-back-link">Volver al historial</a>
    </div>
  );
}
