"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface PhaseGroup {
  phase_name: string;
  phrases: string[];
}

export default function SpeechPage() {
  const [phases, setPhases] = useState<PhaseGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      // Get active scorecard
      const { data: scorecards } = await supabase
        .from("scorecards")
        .select("id, phases")
        .or(`organization_id.eq.${session.organizationId},organization_id.is.null`)
        .eq("active", true)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1);

      const scorecard = scorecards?.[0];
      if (!scorecard) { setLoading(false); return; }

      const scorecardPhases: string[] = (scorecard.phases || []).map((sp: { phase_name: string }) => sp.phase_name);

      // Only source: published speech_version from gerente
      const { data: published } = await supabase
        .from("speech_versions")
        .select("id, content, version_number, updated_at")
        .eq("scorecard_id", scorecard.id)
        .eq("published", true)
        .order("version_number", { ascending: false })
        .limit(1);

      const sv = published?.[0];

      if (sv && sv.content) {
        setVersionNumber(sv.version_number);
        setLastUpdated(sv.updated_at);

        // Build phases from speech_version content, ordered by scorecard phases
        const content = sv.content as Record<string, string[]>;
        const groups: PhaseGroup[] = [];

        // First add phases in scorecard order
        for (const phaseName of scorecardPhases) {
          groups.push({
            phase_name: phaseName,
            phrases: content[phaseName] || [],
          });
        }

        // Add any extra phases from content not in scorecard
        for (const phaseName of Object.keys(content)) {
          if (!scorecardPhases.includes(phaseName)) {
            groups.push({
              phase_name: phaseName,
              phrases: content[phaseName] || [],
            });
          }
        }

        setPhases(groups);
      } else {
        // No published speech — show empty state per scorecard phase
        setPhases(scorecardPhases.map(name => ({ phase_name: name, phrases: [] })));
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
        <h1 className="c5-title">Mi Speech — Llamada de Captación</h1>
        <p className="c5-subtitle">Generado desde las mejores llamadas del equipo</p>
        {lastUpdated && (
          <p className="c5-updated">
            Versión {versionNumber} — Actualizado {new Date(lastUpdated).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
          </p>
        )}
      </div>

      {phases.length === 0 && (
        <div className="c5-empty-card">
          <div className="c5-empty-icon">📋</div>
          <div className="c5-empty-title">Aún no hay Speech Ideal publicado</div>
          <div className="c5-empty-sub">Pide a tu gerente que publique el Speech Ideal del equipo desde la sección Biblioteca.</div>
        </div>
      )}

      {phases.length > 0 && !lastUpdated && (
        <div className="c5-empty-card">
          <div className="c5-empty-icon">📋</div>
          <div className="c5-empty-title">Aún no hay Speech Ideal publicado</div>
          <div className="c5-empty-sub">Pide a tu gerente que publique el Speech Ideal del equipo desde la sección Biblioteca.</div>
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
              <p className="c5-no-phrases">Sin frases destacadas aún — el gerente publicará el Speech Ideal cuando haya suficientes análisis.</p>
            )}
          </div>
        ))}
      </div>

      <a href="/analisis" className="c5-back-link">Volver a Mi día</a>
    </div>
  );
}
