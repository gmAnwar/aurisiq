"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface PhaseGroup {
  phase_name: string;
  phrases: string[];
}

interface FunnelStage {
  id: string;
  name: string;
}

interface StageSpeech {
  phases: PhaseGroup[];
  versionNumber: number;
  lastUpdated: string | null;
}

export default function SpeechPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [speechByStage, setSpeechByStage] = useState<Record<string, StageSpeech>>({});
  const [provisionalByStage, setProvisionalByStage] = useState<Record<string, StageSpeech>>({});
  const [scorecardPhaseNames, setScorecardPhaseNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProvisional, setLoadingProvisional] = useState<Record<string, boolean>>({});
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);

      const [scRes, stagesRes] = await Promise.all([
        supabase.from("scorecards").select("id, phases")
          .or(`organization_id.eq.${session.organizationId},organization_id.is.null`)
          .eq("active", true)
          .order("organization_id", { ascending: false, nullsFirst: false })
          .limit(1),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", session.organizationId).order("order_index"),
      ]);

      const scorecard = scRes.data?.[0];
      if (!scorecard) { setLoading(false); return; }

      const phaseNames: string[] = (scorecard.phases || []).map((sp: { phase_name: string }) => sp.phase_name);
      setScorecardPhaseNames(phaseNames);

      const funnelStages = stagesRes.data || [];
      setStages(funnelStages);

      // Load all published speech versions
      const { data: allSpeech } = await supabase.from("speech_versions")
        .select("id, content, version_number, updated_at, funnel_stage_id")
        .eq("scorecard_id", scorecard.id)
        .eq("published", true);

      const byStage: Record<string, StageSpeech> = {};
      for (const sv of allSpeech || []) {
        const key = sv.funnel_stage_id || "_global";
        const content = sv.content as Record<string, string[]>;
        byStage[key] = {
          phases: phaseNames.map(name => ({
            phase_name: name,
            phrases: content[name] || [],
          })),
          versionNumber: sv.version_number,
          lastUpdated: sv.updated_at,
        };
      }
      setSpeechByStage(byStage);

      // Default to first stage that has a published speech, or first stage
      const stagesWithSpeech = funnelStages.filter(s => byStage[s.id]);
      if (stagesWithSpeech.length > 0) {
        setSelectedStageId(stagesWithSpeech[0].id);
      } else if (funnelStages.length > 0) {
        setSelectedStageId(funnelStages[0].id);
      } else if (byStage["_global"]) {
        setSelectedStageId("_global");
      }

      setLoading(false);
    }

    load();
  }, []);

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  const current = selectedStageId ? speechByStage[selectedStageId] : null;
  const provisional = selectedStageId ? provisionalByStage[selectedStageId] : null;
  const isLoadingProv = selectedStageId ? loadingProvisional[selectedStageId] : false;
  const display = current || provisional;
  const isProvisional = !current && !!provisional;

  // Auto-fetch provisional when selecting a stage without published speech
  useEffect(() => {
    if (!selectedStageId || !orgId || current || provisional || isLoadingProv) return;
    setLoadingProvisional(prev => ({ ...prev, [selectedStageId]: true }));
    const stageId = selectedStageId;
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate_speech",
        organization_id: orgId,
        funnel_stage_id: stageId === "_global" ? null : stageId,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.phases) {
          const phases: PhaseGroup[] = (data.phases as { phase_name: string; phrases: string[] }[]).map(p => ({
            phase_name: p.phase_name,
            phrases: (p.phrases || []).slice(0, 3),
          }));
          setProvisionalByStage(prev => ({
            ...prev,
            [stageId]: { phases, versionNumber: 0, lastUpdated: null },
          }));
        }
      })
      .catch(() => { /* silently fail — show empty state */ })
      .finally(() => setLoadingProvisional(prev => ({ ...prev, [stageId]: false })));
  }, [selectedStageId, orgId, current, provisional, isLoadingProv]);

  if (loading) {
    return (
      <div className="container c5-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  return (
    <div className="container c5-container">
      <div className="c5-header">
        <h1 className="c5-title">Mi Speech</h1>
        <p className="c5-subtitle">Frases clave por etapa del embudo</p>
        {current?.lastUpdated && (
          <p className="c5-updated">
            Versión {current.versionNumber} — Actualizado {new Date(current.lastUpdated).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
          </p>
        )}
      </div>

      {/* Stage tabs */}
      {stages.length > 0 && (
        <div className="g5-stage-tabs">
          {stages.map(stage => (
            <button
              key={stage.id}
              className={`g5-stage-tab ${selectedStageId === stage.id ? "g5-stage-tab-active" : ""}`}
              onClick={() => setSelectedStageId(stage.id)}
            >
              {stage.name}
              {speechByStage[stage.id] && <span className="g5-tab-dot" />}
            </button>
          ))}
        </div>
      )}

      {/* Loading provisional */}
      {isLoadingProv && !display && (
        <div className="c5-empty-card">
          <div className="c5-empty-title">Generando speech provisional...</div>
          <div className="c5-empty-sub">Creando frases modelo basadas en el scorecard de esta etapa.</div>
        </div>
      )}

      {/* No speech and no provisional and not loading */}
      {!display && !isLoadingProv && (
        <div className="c5-empty-card">
          <div className="c5-empty-title">Sin speech disponible</div>
          <div className="c5-empty-sub">Pide a tu gerente que publique el Speech Ideal del equipo desde la sección Biblioteca.</div>
        </div>
      )}

      {/* Provisional badge */}
      {isProvisional && display && (
        <div className="c5-provisional-badge">Provisional · Pendiente de revisión por tu gerente</div>
      )}

      {/* Show speech content (published or provisional) */}
      {display && (
        <div className="c5-phases">
          {display.phases.map((group, i) => (
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
      )}

      <a href="/analisis" className="c5-back-link">Volver a Mi día</a>
    </div>
  );
}
