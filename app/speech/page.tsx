"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface SpeechField {
  field_name: string;
  phrases: string[];
}

interface SpeechPhase {
  phase_name: string;
  transition?: string;
  fields?: SpeechField[];
  // Legacy format support
  phrases?: string[];
}

interface FunnelStage {
  id: string;
  name: string;
  scorecard_id: string | null;
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

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);

      const { data: stagesData } = await supabase.from("funnel_stages")
        .select("id, name, scorecard_id")
        .eq("organization_id", session.organizationId).eq("active", true).order("order_index");

      const funnelStages = (stagesData || []) as FunnelStage[];
      setStages(funnelStages);

      // Load all published or provisional speech versions for THIS organization.
      // Do NOT filter by scorecard_id — speech_versions are already scoped by
      // organization_id, and orgs may use different scorecards across stages.
      const { data: allSpeech } = await supabase.from("speech_versions")
        .select("id, content, version_number, created_at, funnel_stage_id, published, is_provisional")
        .eq("organization_id", session.organizationId)
        .or("published.eq.true,is_provisional.eq.true");

      // Build resolution priority:
      //   1. Published speech for a specific stage — always wins for that stage
      //   2. Published org-wide speech (funnel_stage_id = null) — fallback
      //      for any stage that has no published stage-specific speech.
      //      IMPORTANT: this also beats provisional stage speeches, so if
      //      an org has a published global, orphan provisionals never show.
      //   3. Provisional stage speech — only shows if neither of the above
      //      exists for that stage.
      //   4. Provisional org-wide speech — last resort, applied as fallback
      //      to stages without anything.
      type RawSpeech = {
        id: string;
        content: unknown;
        version_number: number;
        created_at: string;
        funnel_stage_id: string | null;
        published: boolean;
        is_provisional: boolean;
      };
      const stageToSpeech = (sv: RawSpeech): StageSpeech => ({
        phases: parseSpeechContent(sv.content),
        versionNumber: sv.version_number,
        lastUpdated: sv.created_at,
        isProvisional: sv.is_provisional && !sv.published,
      });

      const publishedByStage: Record<string, RawSpeech> = {};
      const provisionalByStage: Record<string, RawSpeech> = {};
      let publishedGlobal: RawSpeech | null = null;
      let provisionalGlobal: RawSpeech | null = null;

      for (const sv of (allSpeech || []) as RawSpeech[]) {
        if (sv.funnel_stage_id === null) {
          if (sv.published) publishedGlobal = sv;
          else if (sv.is_provisional && !provisionalGlobal) provisionalGlobal = sv;
          continue;
        }
        const stageKey = sv.funnel_stage_id;
        if (sv.published) publishedByStage[stageKey] = sv;
        else if (sv.is_provisional && !publishedByStage[stageKey]) provisionalByStage[stageKey] = sv;
      }

      const byStage: Record<string, StageSpeech> = {};
      for (const stage of funnelStages) {
        if (publishedByStage[stage.id]) {
          byStage[stage.id] = stageToSpeech(publishedByStage[stage.id]);
        } else if (publishedGlobal) {
          byStage[stage.id] = stageToSpeech(publishedGlobal);
        } else if (provisionalByStage[stage.id]) {
          byStage[stage.id] = stageToSpeech(provisionalByStage[stage.id]);
        } else if (provisionalGlobal) {
          byStage[stage.id] = stageToSpeech(provisionalGlobal);
        }
      }

      // Expose the global speech under "_global" key for legacy UI paths
      if (publishedGlobal) byStage["_global"] = stageToSpeech(publishedGlobal);
      else if (provisionalGlobal) byStage["_global"] = stageToSpeech(provisionalGlobal);

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

  // Parse multiple content formats:
  // 1. {"phases": [{phase_name, fields, transition}]}  (field-based)
  // 2. [{phase_name, frases: [...]}]  (array root with Spanish key)
  // 3. {"PhaseName": ["phrase",...]}  (legacy flat map)
  function parseSpeechContent(content: unknown): SpeechPhase[] {
    if (!content) return [];

    // Format 2: root-level array of phases with "frases" or "phrases"
    if (Array.isArray(content)) {
      return (content as Array<Record<string, unknown>>).map(p => ({
        phase_name: (p.phase_name as string) || (p.phase_id as string) || "",
        transition: (p.transition as string) || "",
        fields: (p.fields as SpeechField[]) || [],
        phrases: Array.isArray(p.frases)
          ? (p.frases as string[])
          : Array.isArray(p.phrases)
            ? (p.phrases as string[])
            : [],
      }));
    }

    const c = content as Record<string, unknown>;

    // Format 1: has "phases" array with fields + transition
    if (Array.isArray(c.phases)) {
      return (c.phases as Array<Record<string, unknown>>).map(p => ({
        phase_name: (p.phase_name as string) || "",
        transition: (p.transition as string) || "",
        fields: (p.fields as SpeechField[]) || [],
        phrases: Array.isArray(p.frases)
          ? (p.frases as string[])
          : Array.isArray(p.phrases)
            ? (p.phrases as string[])
            : [],
      }));
    }

    // Format 3: {"Phase Name": ["phrase1", "phrase2"]}
    return Object.entries(c).map(([name, phrases]) => ({
      phase_name: name,
      fields: [],
      phrases: Array.isArray(phrases) ? phrases as string[] : [],
    }));
  }

  const current = selectedStageId ? speechByStage[selectedStageId] : null;

  const generateProvisional = async (stageId: string) => {
    if (!orgId) return;

    // Check DB first — query speech for this org and stage, no scorecard filter.
    let checkQuery = supabase.from("speech_versions")
      .select("id, content, version_number, created_at, is_provisional, published")
      .eq("organization_id", orgId)
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
        <div key={selectedStageId} className="c5-phases" style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, overflow: "hidden" }}>
          {current.phases.map((phase, i) => (
            <details key={i} open={i === 0} className="c2-speech-phase">
              <summary className="c2-speech-phase-summary">{phase.phase_name}</summary>
              <div className="c2-speech-phase-body">
                {/* Transition phrase */}
                {phase.transition && (
                  <p className="c5-transition">{phase.transition}</p>
                )}

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
            </details>
          ))}
        </div>
      )}

      <Link href="/analisis" className="c5-back-link">Volver a Mi día</Link>
    </div>
  );
}
