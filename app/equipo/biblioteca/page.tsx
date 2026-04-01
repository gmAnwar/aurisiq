"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface SpeechPhase {
  phase_name: string;
  phrases: string[];
}

interface FunnelStage {
  id: string;
  name: string;
}

interface SpeechData {
  phases: SpeechPhase[];
  versionNum: number;
  updatedAt: string | null;
}

export default function BibliotecaPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [speechByStage, setSpeechByStage] = useState<Record<string, SpeechData>>({});
  const [editing, setEditing] = useState(false);
  const [editPhases, setEditPhases] = useState<SpeechPhase[]>([]);
  const [scorecardId, setScorecardId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [scorecardPhases, setScorecardPhases] = useState<{ phase_name: string }[]>([]);
  const [files, setFiles] = useState<{ name: string; created_at: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };
      setOrgId(me.organization_id);

      const [scRes, stagesRes] = await Promise.all([
        supabase.from("scorecards").select("id, phases, name")
          .or(`organization_id.eq.${me.organization_id},organization_id.is.null`)
          .eq("active", true).order("organization_id", { ascending: false, nullsFirst: false }).limit(1).single(),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", me.organization_id).order("order_index"),
      ]);

      const sc = scRes.data;
      if (!sc) { setLoading(false); return; }
      setScorecardId(sc.id);
      const scPhases = (sc.phases || []) as { phase_name: string }[];
      setScorecardPhases(scPhases);

      const funnelStages = stagesRes.data || [];
      setStages(funnelStages);

      // Load ALL published speech versions for this scorecard
      const { data: allSpeech } = await supabase.from("speech_versions")
        .select("id, content, version_number, updated_at, funnel_stage_id")
        .eq("scorecard_id", sc.id).eq("published", true);

      const byStage: Record<string, SpeechData> = {};
      for (const sv of allSpeech || []) {
        const key = sv.funnel_stage_id || "_global";
        const content = sv.content as Record<string, string[]>;
        byStage[key] = {
          phases: scPhases.map(sp => ({
            phase_name: sp.phase_name,
            phrases: content[sp.phase_name] || [],
          })),
          versionNum: sv.version_number,
          updatedAt: sv.updated_at,
        };
      }
      setSpeechByStage(byStage);

      // Default: select first stage, or global if no stages
      if (funnelStages.length > 0) {
        setSelectedStageId(funnelStages[0].id);
      } else {
        setSelectedStageId("_global");
      }

      // Load files from storage
      const { data: fileList } = await supabase.storage
        .from("biblioteca")
        .list(me.organization_id, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      setFiles((fileList || []).map(f => ({ name: f.name, created_at: f.created_at || "" })));

      setLoading(false);
    }
    load();
  }, []);

  const currentSpeech = selectedStageId ? speechByStage[selectedStageId] : null;
  const currentPhases = currentSpeech?.phases || scorecardPhases.map(sp => ({ phase_name: sp.phase_name, phrases: [] }));
  const currentVersion = currentSpeech?.versionNum || 0;
  const currentUpdated = currentSpeech?.updatedAt || null;
  const selectedStageName = stages.find(s => s.id === selectedStageId)?.name || "Global";

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploading(true);
    setUploadMsg("");

    const path = `${orgId}/${file.name}`;
    const { error: upErr } = await supabase.storage.from("biblioteca").upload(path, file, { upsert: true });

    if (upErr) {
      setUploadMsg(`Error: ${upErr.message}`);
    } else {
      setUploadMsg(`"${file.name}" subido correctamente.`);
      setFiles(prev => [{ name: file.name, created_at: new Date().toISOString() }, ...prev]);
    }
    setUploading(false);
    e.target.value = "";
  };

  const startEdit = () => {
    setEditPhases(currentPhases.map(p => ({ ...p, phrases: [...p.phrases] })));
    setEditing(true);
  };

  const updatePhrase = (phaseIdx: number, phraseIdx: number, value: string) => {
    setEditPhases(prev => prev.map((p, i) => i === phaseIdx
      ? { ...p, phrases: p.phrases.map((ph, j) => j === phraseIdx ? value : ph) }
      : p
    ));
  };

  const addPhrase = (phaseIdx: number) => {
    setEditPhases(prev => prev.map((p, i) => i === phaseIdx
      ? { ...p, phrases: [...p.phrases, ""] }
      : p
    ));
  };

  const removePhrase = (phaseIdx: number, phraseIdx: number) => {
    setEditPhases(prev => prev.map((p, i) => i === phaseIdx
      ? { ...p, phrases: p.phrases.filter((_, j) => j !== phraseIdx) }
      : p
    ));
  };

  const publish = async () => {
    if (!scorecardId || !orgId || !selectedStageId) return;
    setSaving(true);

    const content: Record<string, string[]> = {};
    for (const p of editPhases) {
      content[p.phase_name] = p.phrases.filter(ph => ph.trim().length > 0);
    }

    const stageFilter = selectedStageId === "_global" ? null : selectedStageId;

    // Unpublish existing for this stage
    let unpublishQuery = supabase.from("speech_versions")
      .update({ published: false })
      .eq("scorecard_id", scorecardId).eq("published", true);
    if (stageFilter) {
      unpublishQuery = unpublishQuery.eq("funnel_stage_id", stageFilter);
    } else {
      unpublishQuery = unpublishQuery.is("funnel_stage_id", null);
    }
    await unpublishQuery;

    const newVersion = currentVersion + 1;
    await supabase.from("speech_versions").insert({
      organization_id: orgId,
      scorecard_id: scorecardId,
      funnel_stage_id: stageFilter,
      content,
      version_number: newVersion,
      published: true,
      created_by: (await supabase.auth.getSession()).data.session?.user.id,
    });

    const newPhases = editPhases.map(p => ({ ...p, phrases: content[p.phase_name] || [] }));
    setSpeechByStage(prev => ({
      ...prev,
      [selectedStageId]: { phases: newPhases, versionNum: newVersion, updatedAt: new Date().toISOString() },
    }));
    setEditing(false);
    setSaving(false);
  };

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  const generateProvisional = async () => {
    if (!orgId || !selectedStageId) return;
    setGenerating(true);
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_speech",
          organization_id: orgId,
          funnel_stage_id: selectedStageId === "_global" ? null : selectedStageId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error generando speech");

      const generated: SpeechPhase[] = (data.phases || []).map((p: { phase_name: string; phrases: string[] }) => ({
        phase_name: p.phase_name,
        phrases: (p.phrases || []).slice(0, 3),
      }));
      // Fill missing phases from scorecard
      const result = scorecardPhases.map(sp => {
        const match = generated.find(g => g.phase_name === sp.phase_name);
        return match || { phase_name: sp.phase_name, phrases: [] };
      });
      setEditPhases(result);
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error generando speech provisional");
    }
    setGenerating(false);
  };

  if (loading) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-textarea" />
    </div></div>);
  }

  if (error) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="message-box message-error"><p>{error}</p></div>
    </div></div>);
  }

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Biblioteca y Speech Ideal</h1>
          <p className="g1-subtitle">
            {currentVersion > 0
              ? `${selectedStageName} — Versión ${currentVersion} — ${new Date(currentUpdated!).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`
              : `${selectedStageName} — Sin versión publicada aún`}
          </p>
        </div>

        {/* Stage tabs */}
        {stages.length > 0 && (
          <div className="g5-stage-tabs">
            {stages.map(stage => (
              <button
                key={stage.id}
                className={`g5-stage-tab ${selectedStageId === stage.id ? "g5-stage-tab-active" : ""}`}
                onClick={() => { if (!editing) setSelectedStageId(stage.id); }}
                disabled={editing}
              >
                {stage.name}
                {speechByStage[stage.id] && <span className="g5-tab-dot" />}
              </button>
            ))}
          </div>
        )}

        {!editing ? (
          <>
            <div className="c5-phases">
              {currentPhases.map((p, i) => (
                <div key={i} className="c5-phase-card">
                  <h3 className="c5-phase-name">{p.phase_name}</h3>
                  {p.phrases.length > 0 ? (
                    <ul className="c5-phrase-list">
                      {p.phrases.map((ph, j) => <li key={j} className="c5-phrase">{ph}</li>)}
                    </ul>
                  ) : (
                    <p className="c5-no-phrases">Sin frases publicadas para esta fase</p>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
              <button className="btn-submit" onClick={startEdit}>
                Editar speech de {selectedStageName}
              </button>
              {currentVersion === 0 && (
                <button className="btn-submit g5-generate-btn" onClick={generateProvisional} disabled={generating}>
                  {generating ? "Generando..." : "Generar speech provisional con IA"}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="g5-edit-phases">
              {editPhases.map((p, pi) => (
                <div key={pi} className="g5-edit-card">
                  <h3 className="c5-phase-name">{p.phase_name}</h3>
                  {p.phrases.map((ph, phi) => (
                    <div key={phi} className="g5-phrase-row">
                      <input
                        className="input-field"
                        value={ph}
                        onChange={(e) => updatePhrase(pi, phi, e.target.value)}
                        placeholder="Frase clave..."
                      />
                      <button className="g5-remove-btn" onClick={() => removePhrase(pi, phi)}>x</button>
                    </div>
                  ))}
                  {p.phrases.length < 3 && (
                    <button className="g5-add-btn" onClick={() => addPhrase(pi)}>+ Agregar frase ({p.phrases.length}/3)</button>
                  )}
                  {p.phrases.length >= 3 && (
                    <span className="c2-hint">Máximo 3 frases por fase</span>
                  )}
                </div>
              ))}
            </div>
            <div className="g5-edit-actions">
              <button className="btn-submit" onClick={publish} disabled={saving}>
                {saving ? "Publicando..." : `Publicar — ${selectedStageName}`}
              </button>
              <button className="g5-cancel-btn" onClick={() => setEditing(false)}>Cancelar</button>
            </div>
          </>
        )}

        {/* Biblioteca de archivos */}
        <div className="g1-section" style={{ marginTop: 24 }}>
          <h2 className="g1-section-title">Biblioteca de materiales</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label className="c2-file-btn" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
              {uploading ? "Subiendo..." : "Subir archivo"}
              <input type="file" accept=".pdf,.doc,.docx,.txt,.pptx" onChange={handleFileUpload} hidden disabled={uploading} />
            </label>
            <span className="c2-file-hint">Guiones, materiales de entrenamiento, documentos</span>
          </div>
          {uploadMsg && <p className={`c2-hint ${uploadMsg.startsWith("Error") ? "c2-char-warning" : ""}`} style={{ marginBottom: 8 }}>{uploadMsg}</p>}
          {files.length > 0 ? (
            <div className="g7-list">
              {files.map((f, i) => (
                <div key={i} className="g7-list-item">
                  <span className="g7-item-name">{f.name}</span>
                  <span className="g7-item-meta">{f.created_at ? new Date(f.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="g1-empty">Sin materiales subidos. Sube guiones o documentos de entrenamiento para el equipo.</p>
          )}
        </div>

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
