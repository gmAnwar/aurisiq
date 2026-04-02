"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface SpeechField {
  field_name: string;
  phrases: string[];
}

interface SpeechPhase {
  phase_name: string;
  fields?: SpeechField[];
  // Legacy format support
  phrases?: string[];
}

interface FunnelStage {
  id: string;
  name: string;
}

interface StageSpeech {
  phases: SpeechPhase[];
  versionNumber: number;
  lastUpdated: string | null;
  isProvisional: boolean;
}

function FieldItem({ field }: { field: SpeechField }) {
  const [expanded, setExpanded] = useState(false);
  if (!field.phrases || field.phrases.length === 0) return null;

  return (
    <div className="c5-field">
      <button className="c5-field-btn" onClick={() => setExpanded(!expanded)}>
        <span className="c5-field-name">{field.field_name}</span>
        <span className="c5-field-arrow">{expanded ? "\u2191" : "\u2193"}</span>
      </button>
      <p className="c5-field-phrase-main">{field.phrases[0]}</p>
      {expanded && field.phrases.length > 1 && (
        <div className="c5-field-alts">
          {field.phrases.slice(1).map((ph, i) => (
            <p key={i} className="c5-field-phrase-alt">{ph}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SpeechPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [speechByStage, setSpeechByStage] = useState<Record<string, StageSpeech>>({});
  const [loading, setLoading] = useState(true);
  const [generatingStage, setGeneratingStage] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [scorecardId, setScorecardId] = useState<string | null>(null);

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

      const funnelStages = stagesRes.data || [];
      setStages(funnelStages);

      // Load all speech versions: published OR provisional
      const { data: allSpeech } = await supabase.from("speech_versions")
        .select("id, content, version_number, created_at, funnel_stage_id, published, is_provisional")
        .eq("organization_id", session.organizationId)
        .eq("scorecard_id", scorecard.id)
        .or("published.eq.true,is_provisional.eq.true");

      const byStage: Record<string, StageSpeech> = {};
      for (const sv of allSpeech || []) {
        const key = sv.funnel_stage_id || "_global";
        if (byStage[key] && !byStage[key].isProvisional) continue;
        byStage[key] = {
          phases: parseSpeechContent(sv.content),
          versionNumber: sv.version_number,
          lastUpdated: sv.created_at,
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

  // Parse both old format {"PhaseName": ["phrase",...]} and new {"phases": [{phase_name, fields}]}
  function parseSpeechContent(content: unknown): SpeechPhase[] {
    if (!content) return [];
    const c = content as Record<string, unknown>;

    // New format: has "phases" array with fields
    if (Array.isArray(c.phases)) {
      return (c.phases as SpeechPhase[]).map(p => ({
        phase_name: p.phase_name,
        fields: p.fields || [],
        phrases: p.phrases || [],
      }));
    }

    // Old format: {"Phase Name": ["phrase1", "phrase2"]}
    return Object.entries(c).map(([name, phrases]) => ({
      phase_name: name,
      fields: [],
      phrases: Array.isArray(phrases) ? phrases as string[] : [],
    }));
  }

  const current = selectedStageId ? speechByStage[selectedStageId] : null;

  const generateProvisional = async (stageId: string) => {
    if (!orgId || !scorecardId) return;

    // Check DB first
    let checkQuery = supabase.from("speech_versions")
      .select("id, content, version_number, created_at, is_provisional, published")
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

    if (existing && existing.length > 0) {
      const sv = existing[0];
      setSpeechByStage(prev => ({
        ...prev,
        [stageId]: {
          phases: parseSpeechContent(sv.content),
          versionNumber: sv.version_number,
          lastUpdated: sv.created_at,
          isProvisional: sv.is_provisional && !sv.published,
        },
      }));
      return;
    }

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

      setSpeechByStage(prev => ({
        ...prev,
        [stageId]: {
          phases: parseSpeechContent(data),
          versionNumber: 0,
          lastUpdated: new Date().toISOString(),
          isProvisional: true,
        },
      }));
    } catch {
      // Silently fail
    }
    setGeneratingStage(null);
  };

  useEffect(() => {
    if (!selectedStageId || !orgId || current || generatingStage) return;
    generateProvisional(selectedStageId);
  }, [selectedStageId, orgId, current, generatingStage]);

  if (loading) {
    return (
      <div className="container c5-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  const hasFields = current?.phases.some(p => p.fields && p.fields.length > 0);

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

      {generatingStage && !current && (
        <div className="c5-empty-card">
          <div className="c5-empty-title">Generando speech provisional...</div>
          <div className="c5-empty-sub">Creando frases modelo basadas en el scorecard de esta etapa.</div>
        </div>
      )}

      {!current && !generatingStage && (
        <div className="c5-empty-card">
          <div className="c5-empty-title">Sin speech disponible</div>
          <div className="c5-empty-sub">Pide a tu gerente que publique el Speech Ideal del equipo desde la sección Biblioteca.</div>
        </div>
      )}

      {current?.isProvisional && (
        <div className="c5-provisional-badge">Provisional · Pendiente de revisión por tu gerente</div>
      )}

      {current && (
        <div className="c5-phases">
          {current.phases.map((phase, i) => (
            <div key={i} className="c5-phase-card">
              <h3 className="c5-phase-name">{phase.phase_name}</h3>

              {/* New format: fields with bullets + accordion */}
              {hasFields && phase.fields && phase.fields.length > 0 && (
                <div className="c5-fields">
                  {phase.fields.map((field, j) => (
                    <FieldItem key={j} field={field} />
                  ))}
                </div>
              )}

              {/* Old format: flat phrases */}
              {!hasFields && phase.phrases && phase.phrases.length > 0 && (
                <ul className="c5-phrase-list">
                  {phase.phrases.map((phrase, j) => (
                    <li key={j} className="c5-phrase">{phrase}</li>
                  ))}
                </ul>
              )}

              {!hasFields && (!phase.phrases || phase.phrases.length === 0) && (!phase.fields || phase.fields.length === 0) && (
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
