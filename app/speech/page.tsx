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
  isProvisional: boolean;
}

export default function SpeechPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [speechByStage, setSpeechByStage] = useState<Record<string, StageSpeech>>({});
  const [loading, setLoading] = useState(true);
  const [generatingStage, setGeneratingStage] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [scorecardId, setScorecardId] = useState<string | null>(null);
  const [scorecardPhaseNames, setScorecardPhaseNames] = useState<string[]>([]);

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

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
      setScorecardId(scorecard.id);

      const phaseNames: string[] = (scorecard.phases || []).map((sp: { phase_name: string }) => sp.phase_name);
      setScorecardPhaseNames(phaseNames);

      const funnelStages = stagesRes.data || [];
      setStages(funnelStages);

      // Load all speech versions: published OR provisional for this org
      const { data: allSpeech } = await supabase.from("speech_versions")
        .select("id, content, version_number, updated_at, funnel_stage_id, published, is_provisional")
        .eq("organization_id", session.organizationId)
        .eq("scorecard_id", scorecard.id)
        .or("published.eq.true,is_provisional.eq.true");

      const byStage: Record<string, StageSpeech> = {};
      for (const sv of allSpeech || []) {
        const key = sv.funnel_stage_id || "_global";
        // Published takes priority over provisional
        if (byStage[key] && !byStage[key].isProvisional) continue;
        const content = sv.content as Record<string, string[]>;
        byStage[key] = {
          phases: phaseNames.map(name => ({
            phase_name: name,
            phrases: content[name] || [],
          })),
          versionNumber: sv.version_number,
          lastUpdated: sv.updated_at,
          isProvisional: sv.is_provisional && !sv.published,
        };
      }
      setSpeechByStage(byStage);

      if (funnelStages.length > 0) {
        const withSpeech = funnelStages.filter(s => byStage[s.id]);
        setSelectedStageId(withSpeech.length > 0 ? withSpeech[0].id : funnelStages[0].id);
      } else if (byStage["_global"]) {
        setSelectedStageId("_global");
      }

      setLoading(false);
    }

    load();
  }, []);

  const current = selectedStageId ? speechByStage[selectedStageId] : null;

  // Generate provisional and save to DB (only when no speech exists for this stage)
  const generateProvisional = async (stageId: string) => {
    if (!orgId || !scorecardId) return;

    // Double-check DB: don't generate if published or provisional already exists
    let checkQuery = supabase.from("speech_versions")
      .select("id, content, version_number, updated_at, is_provisional, published")
      .eq("organization_id", orgId)
      .eq("scorecard_id", scorecardId)
      .or("published.eq.true,is_provisional.eq.true")
      .order("published", { ascending: false })
      .limit(1);
    if (stageId === "_global") {
      checkQuery = checkQuery.is("funnel_stage_id", null);
    } else {
      checkQuery = checkQuery.eq("funnel_stage_id", stageId);
    }
    const { data: existing } = await checkQuery;

    console.log("SPEECH: checking DB for stage", stageId, "found:", existing?.length || 0);

    if (existing && existing.length > 0) {
      // Already exists in DB — load it into state instead of generating
      const sv = existing[0];
      const content = sv.content as Record<string, string[]>;
      const phases: PhaseGroup[] = scorecardPhaseNames.map(name => ({
        phase_name: name,
        phrases: content[name] || [],
      }));
      setSpeechByStage(prev => ({
        ...prev,
        [stageId]: {
          phases,
          versionNumber: sv.version_number,
          lastUpdated: sv.updated_at,
          isProvisional: sv.is_provisional && !sv.published,
        },
      }));
      return;
    }

    console.log("SPEECH: nothing found in DB, calling Worker to generate for stage", stageId);
    setGeneratingStage(stageId);
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_speech",
          organization_id: orgId,
          funnel_stage_id: stageId === "_global" ? null : stageId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.phases) throw new Error("Error generando speech");

      const content: Record<string, string[]> = {};
      for (const p of data.phases as { phase_name: string; phrases: string[] }[]) {
        content[p.phase_name] = (p.phrases || []).slice(0, 3);
      }

      // Save to DB as provisional
      await supabase.from("speech_versions").insert({
        organization_id: orgId,
        scorecard_id: scorecardId,
        funnel_stage_id: stageId === "_global" ? null : stageId,
        content,
        version_number: 0,
        published: false,
        is_provisional: true,
      });

      const phases: PhaseGroup[] = scorecardPhaseNames.map(name => ({
        phase_name: name,
        phrases: content[name] || [],
      }));

      setSpeechByStage(prev => ({
        ...prev,
        [stageId]: { phases, versionNumber: 0, lastUpdated: new Date().toISOString(), isProvisional: true },
      }));
    } catch {
      // Silently fail — user sees empty state
    }
    setGeneratingStage(null);
  };

  // Auto-generate when selecting a stage without any speech
  useEffect(() => {
    if (!selectedStageId || !orgId || current || generatingStage) return;
    generateProvisional(selectedStageId);
  }, [selectedStageId, orgId, current, generatingStage]);

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
        {current?.lastUpdated && !current.isProvisional && (
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
              {speechByStage[stage.id] && !speechByStage[stage.id].isProvisional && <span className="g5-tab-dot" />}
            </button>
          ))}
        </div>
      )}

      {/* Generating */}
      {generatingStage && !current && (
        <div className="c5-empty-card">
          <div className="c5-empty-title">Generando speech provisional...</div>
          <div className="c5-empty-sub">Creando frases modelo basadas en el scorecard de esta etapa.</div>
        </div>
      )}

      {/* No speech and not generating */}
      {!current && !generatingStage && (
        <div className="c5-empty-card">
          <div className="c5-empty-title">Sin speech disponible</div>
          <div className="c5-empty-sub">Pide a tu gerente que publique el Speech Ideal del equipo desde la sección Biblioteca.</div>
        </div>
      )}

      {/* Provisional badge */}
      {current?.isProvisional && (
        <div className="c5-provisional-badge">Provisional · Pendiente de revisión por tu gerente</div>
      )}

      {/* Show speech content */}
      {current && (
        <div className="c5-phases">
          {current.phases.map((group, i) => (
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
