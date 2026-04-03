"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface SpeechField { field_name: string; phrases: string[]; }
interface SpeechPhase { phase_name: string; transition?: string; fields?: SpeechField[]; phrases?: string[]; }
interface FunnelStage { id: string; name: string; }

interface SpeechRow {
  id: string;
  content: unknown;
  version_number: number;
  created_at: string;
  published: boolean;
  is_provisional: boolean;
  funnel_stage_id: string | null;
}

function parseSpeechContent(content: unknown): SpeechPhase[] {
  if (!content) return [];
  const c = content as Record<string, unknown>;
  if (Array.isArray(c.phases)) {
    return (c.phases as SpeechPhase[]).map(p => ({
      phase_name: p.phase_name, transition: p.transition || "", fields: p.fields || [], phrases: p.phrases || [],
    }));
  }
  return Object.entries(c).map(([name, phrases]) => ({
    phase_name: name, fields: [], phrases: Array.isArray(phrases) ? phrases as string[] : [],
  }));
}

export default function BibliotecaPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [speechByStage, setSpeechByStage] = useState<Record<string, { id: string; phases: SpeechPhase[]; versionNum: number; updatedAt: string | null; isProvisional: boolean }>>({});
  const [editingField, setEditingField] = useState<string | null>(null); // "phaseIdx-fieldIdx-phraseIdx"
  const [editValue, setEditValue] = useState("");
  const [scorecardId, setScorecardId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [gerenteName, setGerenteName] = useState("");
  const [files, setFiles] = useState<{ name: string; created_at: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);
      setUserId(session.userId);
      setGerenteName(session.name);

      const [scRes, stagesRes] = await Promise.all([
        supabase.from("scorecards").select("id, phases, name")
          .or(`organization_id.eq.${session.organizationId},organization_id.is.null`)
          .eq("active", true).order("organization_id", { ascending: false, nullsFirst: false }).limit(1).single(),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", session.organizationId).order("order_index"),
      ]);

      const sc = scRes.data;
      if (!sc) { setLoading(false); return; }
      setScorecardId(sc.id);

      const funnelStages = stagesRes.data || [];
      setStages(funnelStages);

      // Load published + provisional — MUST filter by organization_id
      const { data: allSpeech, error: speechErr } = await supabase.from("speech_versions")
        .select("id, content, version_number, created_at, funnel_stage_id, published, is_provisional")
        .eq("organization_id", session.organizationId)
        .eq("scorecard_id", sc.id)
        .or("published.eq.true,is_provisional.eq.true");

      console.log("G5 SPEECH:", { org: session.organizationId, sc: sc.id, found: allSpeech?.length || 0, err: speechErr?.message || "none" });

      const byStage: Record<string, { id: string; phases: SpeechPhase[]; versionNum: number; updatedAt: string | null; isProvisional: boolean }> = {};
      for (const sv of (allSpeech || []) as SpeechRow[]) {
        const key = sv.funnel_stage_id || "_global";
        if (byStage[key] && !byStage[key].isProvisional) continue;
        byStage[key] = {
          id: sv.id,
          phases: parseSpeechContent(sv.content),
          versionNum: sv.version_number,
          updatedAt: sv.created_at,
          isProvisional: sv.is_provisional && !sv.published,
        };
      }
      setSpeechByStage(byStage);

      if (funnelStages.length > 0) setSelectedStageId(funnelStages[0].id);
      else setSelectedStageId("_global");

      const { data: fileList } = await supabase.storage
        .from("biblioteca").list(session.organizationId, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      setFiles((fileList || []).map(f => ({ name: f.name, created_at: f.created_at || "" })));

      setLoading(false);
    }
    load();
  }, []);

  const current = selectedStageId ? speechByStage[selectedStageId] : null;
  const selectedStageName = stages.find(s => s.id === selectedStageId)?.name || "Global";
  const hasFields = current?.phases.some(p => p.fields && p.fields.length > 0);

  // Inline edit helpers
  const startEdit = (key: string, value: string) => { setEditingField(key); setEditValue(value); };

  const saveEdit = async () => {
    if (!editingField || !current) return;
    setSaving(true);
    const [pi, fi, phi] = editingField.split("-").map(Number);
    const updatedPhases = current.phases.map((p, i) => {
      if (i !== pi) return p;
      if (hasFields && p.fields) {
        return { ...p, fields: p.fields.map((f, j) => {
          if (j !== fi) return f;
          return { ...f, phrases: f.phrases.map((ph, k) => k === phi ? editValue : ph) };
        })};
      }
      return { ...p, phrases: (p.phrases || []).map((ph, j) => j === phi ? editValue : ph) };
    });

    // Build content in the same format
    const content = hasFields ? { phases: updatedPhases } : (() => {
      const c: Record<string, string[]> = {};
      for (const p of updatedPhases) c[p.phase_name] = p.phrases || [];
      return c;
    })();

    await supabase.from("speech_versions").update({
      content,
      is_provisional: false,
    }).eq("id", current.id);

    setSpeechByStage(prev => ({
      ...prev,
      [selectedStageId!]: { ...current, phases: updatedPhases, isProvisional: false, updatedAt: new Date().toISOString() },
    }));
    setEditingField(null);
    setSaving(false);
  };

  const regenerate = async () => {
    if (!orgId || !selectedStageId) return;
    setGenerating(true);
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_speech", organization_id: orgId, funnel_stage_id: selectedStageId === "_global" ? null : selectedStageId }),
      });
      const data = await res.json();
      if (!res.ok || !data.phases) throw new Error("Error");
      // Reload page to get fresh data from DB (Worker saves it)
      window.location.reload();
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const publishSpeech = async () => {
    if (!current || !selectedStageId || !userId) return;
    setPublishing(true);
    const { error } = await supabase.from("speech_versions").update({
      published: true,
      is_provisional: false,
      published_by: userId,
      published_at: new Date().toISOString(),
    }).eq("id", current.id);

    if (!error) {
      setSpeechByStage(prev => ({
        ...prev,
        [selectedStageId]: { ...current, isProvisional: false, updatedAt: new Date().toISOString() },
      }));
    }
    setPublishing(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploading(true); setUploadMsg("");
    const { error: upErr } = await supabase.storage.from("biblioteca").upload(`${orgId}/${file.name}`, file, { upsert: true });
    if (upErr) setUploadMsg(`Error: ${upErr.message}`);
    else { setUploadMsg(`"${file.name}" subido.`); setFiles(prev => [{ name: file.name, created_at: new Date().toISOString() }, ...prev]); }
    setUploading(false); e.target.value = "";
  };

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Speech Ideal</h1>
          <p className="g1-subtitle">
            {current?.isProvisional
              ? `${selectedStageName} — Generado por IA · Click en cualquier frase para editar`
              : current
                ? `${selectedStageName} — Versión ${current.versionNum} · ${new Date(current.updatedAt!).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}`
                : `${selectedStageName} — Sin speech aún`}
          </p>
        </div>

        {/* Stage tabs */}
        {stages.length > 0 && (
          <div className="g5-stage-tabs">
            {stages.map(stage => (
              <button key={stage.id}
                className={`g5-stage-tab ${selectedStageId === stage.id ? "g5-stage-tab-active" : ""}`}
                onClick={() => setSelectedStageId(stage.id)}
              >
                {stage.name}
                {speechByStage[stage.id] && !speechByStage[stage.id].isProvisional && <span className="g5-tab-dot" />}
              </button>
            ))}
          </div>
        )}

        {/* Provisional badge + publish button */}
        {current?.isProvisional && (
          <div className="g5-provisional-row">
            <div className="c5-provisional-badge">Provisional · Las captadoras ya ven este speech. Edita las frases para personalizarlo.</div>
            <button className="g5-publish-btn" onClick={publishSpeech} disabled={publishing}>
              {publishing ? "Publicando..." : "Confirmar speech"}
            </button>
          </div>
        )}

        {/* Speech content — field-based with inline edit */}
        {current && hasFields && (
          <div className="c5-phases">
            {current.phases.map((phase, pi) => (
              <div key={pi} className="c5-phase-card">
                <h3 className="c5-phase-name">{phase.phase_name}</h3>
                {phase.transition && <p className="c5-transition">{phase.transition}</p>}
                {phase.fields && phase.fields.map((field, fi) => (
                  <div key={fi} className="c5-field">
                    <span className="c5-field-name" style={{ padding: "6px 0", display: "block" }}>{field.field_name}</span>
                    {field.phrases.map((ph, phi) => {
                      const key = `${pi}-${fi}-${phi}`;
                      return editingField === key ? (
                        <div key={phi} className="g5-inline-edit">
                          <textarea className="input-field" rows={2} value={editValue} onChange={e => setEditValue(e.target.value)} style={{ fontSize: 11 }} />
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            <button className="g4-note-save" onClick={saveEdit} disabled={saving}>{saving ? "..." : "Guardar"}</button>
                            <button className="g4-note-cancel" onClick={() => setEditingField(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <p key={phi} className={phi === 0 ? "c5-field-phrase-main" : "c5-field-phrase-alt"} style={{ cursor: "pointer" }} onClick={() => startEdit(key, ph)}>
                          {ph} <span className="g5-edit-icon">✎</span>
                        </p>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Old format — flat phrases */}
        {current && !hasFields && (
          <div className="c5-phases">
            {current.phases.map((p, pi) => (
              <div key={pi} className="c5-phase-card">
                <h3 className="c5-phase-name">{p.phase_name}</h3>
                {(p.phrases || []).map((ph, phi) => {
                  const key = `${pi}-0-${phi}`;
                  return editingField === key ? (
                    <div key={phi} className="g5-inline-edit">
                      <textarea className="input-field" rows={2} value={editValue} onChange={e => setEditValue(e.target.value)} style={{ fontSize: 11 }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button className="g4-note-save" onClick={saveEdit} disabled={saving}>{saving ? "..." : "Guardar"}</button>
                        <button className="g4-note-cancel" onClick={() => setEditingField(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <li key={phi} className="c5-phrase" style={{ cursor: "pointer" }} onClick={() => startEdit(key, ph)}>
                      {ph} <span className="g5-edit-icon">✎</span>
                    </li>
                  );
                })}
                {(!p.phrases || p.phrases.length === 0) && <p className="c5-no-phrases">Sin frases</p>}
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!current && (
          <div className="c5-empty-card">
            <div className="c5-empty-title">Sin speech para esta etapa</div>
            <div className="c5-empty-sub">Genera uno con IA basado en el scorecard.</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn-submit g5-generate-btn" onClick={regenerate} disabled={generating}>
            {generating ? "Generando..." : "Regenerar con IA"}
          </button>
        </div>

        {/* Biblioteca */}
        <div className="g1-section" style={{ marginTop: 24 }}>
          <h2 className="g1-section-title">Biblioteca de materiales</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label className="c2-file-btn" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
              {uploading ? "Subiendo..." : "Subir archivo"}
              <input type="file" accept=".pdf,.doc,.docx,.txt,.pptx" onChange={handleFileUpload} hidden disabled={uploading} />
            </label>
            <span className="c2-file-hint">Guiones, materiales de entrenamiento</span>
          </div>
          {uploadMsg && <p className="c2-hint" style={{ marginBottom: 8 }}>{uploadMsg}</p>}
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
            <p className="g1-empty">Sin materiales subidos.</p>
          )}
        </div>

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
