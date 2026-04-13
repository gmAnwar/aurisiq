"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface SpeechField { field_name: string; phrases: string[]; }
interface SpeechPhase { phase_name: string; transition?: string; fields?: SpeechField[]; phrases?: string[]; }
interface FunnelStage { id: string; name: string; scorecard_id: string | null; }
interface ScorecardPhase { name: string; max_score: number; prompt_base?: string; fields?: string[]; }
interface ScorecardRow { id: string; name: string; version: string; phases: unknown; structure: { phases?: ScorecardPhase[] } | null; }

interface SpeechRow {
  id: string;
  content: unknown;
  version_number: number;
  created_at: string;
  published: boolean;
  is_provisional: boolean;
  funnel_stage_id: string | null;
  scorecard_id: string | null;
}

function parseSpeechContent(content: unknown): SpeechPhase[] {
  if (!content) return [];

  // Root-level array: [{phase_name, frases|phrases, ...}]
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>).map(p => ({
      phase_name: (p.phase_name as string) || (p.phase_id as string) || "",
      transition: (p.transition as string) || "",
      fields: (p.fields as SpeechField[]) || [],
      phrases: Array.isArray(p.frases) ? (p.frases as string[]) : Array.isArray(p.phrases) ? (p.phrases as string[]) : [],
    }));
  }

  const c = content as Record<string, unknown>;
  if (Array.isArray(c.phases)) {
    return (c.phases as Array<Record<string, unknown>>).map(p => ({
      phase_name: (p.phase_name as string) || "",
      transition: (p.transition as string) || "",
      fields: (p.fields as SpeechField[]) || [],
      phrases: Array.isArray(p.frases) ? (p.frases as string[]) : Array.isArray(p.phrases) ? (p.phrases as string[]) : [],
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
  const [editingPhaseName, setEditingPhaseName] = useState<number | null>(null);
  const [editPhaseNameValue, setEditPhaseNameValue] = useState("");
  const [editingTransition, setEditingTransition] = useState<number | null>(null);
  const [editTransitionValue, setEditTransitionValue] = useState("");
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null); // "pi-fi"
  const [editFieldNameValue, setEditFieldNameValue] = useState("");
  const [scorecards, setScorecards] = useState<ScorecardRow[]>([]);
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStageId, setCreateStageId] = useState("");
  const [creatingSpeech, setCreatingSpeech] = useState(false);

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);
      setUserId(session.userId);
      setGerenteName(session.name);

      const [scRes, stagesRes] = await Promise.all([
        supabase.from("scorecards").select("id, phases, name, version, structure")
          .eq("organization_id", session.organizationId)
          .eq("active", true),
        supabase.from("funnel_stages").select("id, name, scorecard_id")
          .eq("organization_id", session.organizationId).eq("active", true).order("order_index"),
      ]);

      const orgScorecards = (scRes.data || []) as ScorecardRow[];
      setScorecards(orgScorecards);
      if (orgScorecards.length === 0) { setLoading(false); return; }

      const funnelStages = (stagesRes.data || []) as FunnelStage[];
      setStages(funnelStages);

      // Load ALL speech for this org (across all scorecards)
      const { data: allSpeech } = await supabase.from("speech_versions")
        .select("id, content, version_number, created_at, funnel_stage_id, published, is_provisional, scorecard_id")
        .eq("organization_id", session.organizationId)
        .or("published.eq.true,is_provisional.eq.true");

      const byStage: Record<string, { id: string; phases: SpeechPhase[]; versionNum: number; updatedAt: string | null; isProvisional: boolean; scorecardId: string | null }> = {};
      for (const sv of (allSpeech || []) as SpeechRow[]) {
        const key = sv.funnel_stage_id || "_global";
        // Published takes priority over provisional
        if (byStage[key] && !byStage[key].isProvisional) continue;
        byStage[key] = {
          id: sv.id,
          phases: parseSpeechContent(sv.content),
          versionNum: sv.version_number,
          updatedAt: sv.created_at,
          isProvisional: sv.is_provisional && !sv.published,
          scorecardId: sv.scorecard_id,
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
  const persistPhases = async (updatedPhases: SpeechPhase[]) => {
    if (!current || !selectedStageId) return;
    const content = hasFields ? { phases: updatedPhases } : (() => {
      const c: Record<string, string[]> = {};
      for (const p of updatedPhases) c[p.phase_name] = p.phrases || [];
      return c;
    })();
    await supabase.from("speech_versions").update({ content }).eq("id", current.id);
    setSpeechByStage(prev => ({
      ...prev,
      [selectedStageId]: { ...current, phases: updatedPhases, updatedAt: new Date().toISOString() },
    }));
  };

  const savePhaseName = async (pi: number) => {
    if (!current || !editPhaseNameValue.trim()) { setEditingPhaseName(null); return; }
    const updated = current.phases.map((p, i) => i === pi ? { ...p, phase_name: editPhaseNameValue.trim() } : p);
    await persistPhases(updated);
    setEditingPhaseName(null);
  };

  const saveTransition = async (pi: number) => {
    if (!current) { setEditingTransition(null); return; }
    const updated = current.phases.map((p, i) => i === pi ? { ...p, transition: editTransitionValue.trim() || undefined } : p);
    await persistPhases(updated);
    setEditingTransition(null);
  };

  const reorderPhase = async (pi: number, direction: "up" | "down") => {
    if (!current) return;
    const swapIdx = direction === "up" ? pi - 1 : pi + 1;
    if (swapIdx < 0 || swapIdx >= current.phases.length) return;
    const updated = [...current.phases];
    [updated[pi], updated[swapIdx]] = [updated[swapIdx], updated[pi]];
    await persistPhases(updated);
  };

  const saveFieldName = async (pi: number, fi: number) => {
    if (!current || !editFieldNameValue.trim()) { setEditingFieldName(null); return; }
    const updated = current.phases.map((p, i) => i !== pi ? p : {
      ...p, fields: (p.fields || []).map((f, j) => j !== fi ? f : { ...f, field_name: editFieldNameValue.trim() }),
    });
    await persistPhases(updated);
    setEditingFieldName(null);
  };

  const addField = async (pi: number) => {
    if (!current) return;
    const updated = current.phases.map((p, i) => i !== pi ? p : {
      ...p, fields: [...(p.fields || []), { field_name: "Nuevo campo", phrases: [""] }],
    });
    await persistPhases(updated);
  };

  const deleteField = async (pi: number, fi: number) => {
    if (!current) return;
    if (!confirm("¿Eliminar este campo y sus frases?")) return;
    const updated = current.phases.map((p, i) => i !== pi ? p : {
      ...p, fields: (p.fields || []).filter((_, j) => j !== fi),
    });
    await persistPhases(updated);
  };

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
    }).eq("id", current.id);

    setSpeechByStage(prev => ({
      ...prev,
      [selectedStageId!]: { ...current, phases: updatedPhases, updatedAt: new Date().toISOString() },
    }));
    setEditingField(null);
    setSaving(false);
  };

  const regenerate = async () => {
    if (!orgId || !selectedStageId || !userId) return;
    setGenerating(true);
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_speech", organization_id: orgId, funnel_stage_id: selectedStageId === "_global" ? null : selectedStageId }),
      });
      const data = await res.json();
      if (!res.ok || !data.phases) throw new Error("Error");
      // Auto-publish: find the provisional speech just created and publish it
      const stageFilter = selectedStageId === "_global"
        ? "funnel_stage_id.is.null"
        : `funnel_stage_id.eq.${selectedStageId}`;
      const { data: provisional } = await supabase
        .from("speech_versions")
        .select("id")
        .eq("organization_id", orgId)
        .eq("is_provisional", true)
        .or(stageFilter)
        .order("created_at", { ascending: false })
        .limit(1);
      if (provisional && provisional.length > 0) {
        await supabase.from("speech_versions").update({
          published: true,
          is_provisional: false,
          published_by: userId,
          published_at: new Date().toISOString(),
        }).eq("id", provisional[0].id);
      }
      window.location.reload();
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const publishSpeech = async () => {
    if (!current || !selectedStageId || !userId) return;
    setPublishing(true);

    // Check for existing published speech for this stage + scorecard (UNIQUE index)
    const stage = stages.find(s => s.id === selectedStageId);
    if (stage?.scorecard_id) {
      const { data: existing } = await supabase.from("speech_versions")
        .select("id").eq("organization_id", orgId!)
        .eq("scorecard_id", stage.scorecard_id)
        .eq("funnel_stage_id", selectedStageId)
        .eq("published", true).neq("id", current.id).limit(1);
      if (existing && existing.length > 0) {
        if (!confirm("Ya hay un speech publicado para esta etapa. ¿Quieres reemplazarlo?")) { setPublishing(false); return; }
        await supabase.from("speech_versions").update({ published: false }).eq("id", existing[0].id);
      }
    }

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

  const createSpeechFromTemplate = async () => {
    if (!createStageId || !orgId || !userId) return;
    const stage = stages.find(s => s.id === createStageId);
    if (!stage?.scorecard_id) return;
    setCreatingSpeech(true);

    const sc = scorecards.find(c => c.id === stage.scorecard_id);
    const scPhases = (sc?.structure?.phases || []) as ScorecardPhase[];

    // Build template content from scorecard phases
    const content = {
      phases: scPhases.map(p => ({
        phase_name: p.name,
        transition: "",
        fields: (p.fields || []).map(slug => ({
          field_name: slug,
          phrases: [""],
        })),
      })),
    };

    const { error } = await supabase.from("speech_versions").insert({
      organization_id: orgId,
      scorecard_id: stage.scorecard_id,
      funnel_stage_id: createStageId,
      version_number: 0,
      content,
      published: false,
      is_provisional: true,
      created_by: userId,
    });

    if (error) { alert("Error: " + error.message); }
    else { window.location.reload(); }
    setCreatingSpeech(false);
    setShowCreateModal(false);
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

        {/* Stage tabs + create button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {stages.length > 0 && (
            <div className="g5-stage-tabs" style={{ flex: 1 }}>
              {stages.map(stage => (
                <button key={stage.id}
                  className={`g5-stage-tab ${selectedStageId === stage.id ? "g5-stage-tab-active" : ""}`}
                  onClick={() => setSelectedStageId(stage.id)}
                  style={!stage.scorecard_id ? { opacity: 0.5 } : undefined}
                >
                  {stage.name}
                  {speechByStage[stage.id] && !speechByStage[stage.id].isProvisional && <span className="g5-tab-dot" />}
                  {!stage.scorecard_id && <span style={{ fontSize: 10, color: "#a8a29e", display: "block" }}>sin evaluación configurada</span>}
                </button>
              ))}
            </div>
          )}
          {(() => {
            const hasEligible = stages.some(s => s.scorecard_id && (!speechByStage[s.id] || speechByStage[s.id].isProvisional));
            return (
              <button
                className="btn-submit"
                style={{ fontSize: 13, padding: "6px 14px", whiteSpace: "nowrap", ...(hasEligible ? {} : { opacity: 0.45, cursor: "not-allowed" }) }}
                onClick={() => hasEligible && setShowCreateModal(true)}
                title={hasEligible ? undefined : "Todas las etapas con evaluación ya tienen speech. Para editar, selecciona la etapa en los tabs."}
              >
                + Crear speech
              </button>
            );
          })()}
        </div>

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
              <details key={pi} open={pi === 0} className="g5-speech-phase">
                <summary className="g5-speech-phase-summary">
                  <span className="g5-phase-number">{pi + 1}</span>
                  {editingPhaseName === pi ? (
                    <input className="input-field" style={{ flex: 1, fontSize: 14, fontWeight: 600, padding: "4px 8px" }} value={editPhaseNameValue} onChange={e => setEditPhaseNameValue(e.target.value)} onBlur={() => savePhaseName(pi)} onKeyDown={e => { if (e.key === "Enter") savePhaseName(pi); if (e.key === "Escape") setEditingPhaseName(null); }} onClick={e => e.stopPropagation()} autoFocus />
                  ) : (
                    <span className="g5-phase-name g5-editable" style={{ cursor: "pointer" }} onClick={e => { e.preventDefault(); setEditingPhaseName(pi); setEditPhaseNameValue(phase.phase_name); }}>
                      {phase.phase_name}<span className="g5-edit-pencil">✎</span>
                    </span>
                  )}
                  <div className="g5-phase-actions" onClick={e => e.stopPropagation()} style={{ marginLeft: "auto", flexShrink: 0 }}>
                    <button disabled={pi === 0} onClick={e => { e.preventDefault(); reorderPhase(pi, "up"); }} title="Subir">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button disabled={pi === current.phases.length - 1} onClick={e => { e.preventDefault(); reorderPhase(pi, "down"); }} title="Bajar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                  </div>
                  <svg className="g5-phase-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </summary>
                <div className="g5-speech-phase-body">
                  {editingTransition === pi ? (
                    <textarea className="input-field" rows={2} style={{ fontSize: 13, marginBottom: 8 }} value={editTransitionValue} onChange={e => setEditTransitionValue(e.target.value)} onBlur={() => saveTransition(pi)} onKeyDown={e => { if (e.key === "Escape") setEditingTransition(null); }} autoFocus />
                  ) : (
                    <p className="c5-transition g5-editable" style={{ cursor: "pointer" }} onClick={() => { setEditingTransition(pi); setEditTransitionValue(phase.transition || ""); }}>
                      {phase.transition || <span style={{ color: "var(--ink-light)", fontStyle: "italic" }}>Click para agregar transición...</span>}
                      <span className="g5-edit-pencil">✎</span>
                    </p>
                  )}
                  {phase.fields && phase.fields.map((field, fi) => {
                    const fnKey = `${pi}-${fi}`;
                    return (
                      <div key={fi} className="c5-field g5-field-row">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                          <div style={{ flex: 1 }}>
                            {editingFieldName === fnKey ? (
                              <input className="input-field" style={{ fontSize: 13, fontWeight: 600, padding: "2px 6px", width: "100%" }} value={editFieldNameValue} onChange={e => setEditFieldNameValue(e.target.value)} onBlur={() => saveFieldName(pi, fi)} onKeyDown={e => { if (e.key === "Enter") saveFieldName(pi, fi); if (e.key === "Escape") setEditingFieldName(null); }} autoFocus />
                            ) : (
                              <span className="c5-field-name" style={{ cursor: "pointer" }} onClick={() => { setEditingFieldName(fnKey); setEditFieldNameValue(field.field_name); }}>
                                {field.field_name}
                              </span>
                            )}
                          </div>
                          <button className="g5-field-delete" onClick={() => deleteField(pi, fi)} title="Eliminar campo">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
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
                              {ph}
                            </p>
                          );
                        })}
                      </div>
                    );
                  })}
                  <button style={{ background: "none", border: "none", color: "var(--ink-light)", cursor: "pointer", fontSize: 12, marginTop: 8, padding: 0 }} onClick={() => addField(pi)}>+ Agregar campo</button>
                </div>
              </details>
            ))}
          </div>
        )}

        {/* Old format — flat phrases */}
        {current && !hasFields && (
          <div className="c5-phases">
            {current.phases.map((p, pi) => (
              <details key={pi} open={pi === 0} className="g5-speech-phase">
                <summary className="g5-speech-phase-summary">
                  <span className="g5-phase-number">{pi + 1}</span>
                  {editingPhaseName === pi ? (
                    <input className="input-field" style={{ flex: 1, fontSize: 14, fontWeight: 600, padding: "4px 8px" }} value={editPhaseNameValue} onChange={e => setEditPhaseNameValue(e.target.value)} onBlur={() => savePhaseName(pi)} onKeyDown={e => { if (e.key === "Enter") savePhaseName(pi); if (e.key === "Escape") setEditingPhaseName(null); }} onClick={e => e.stopPropagation()} autoFocus />
                  ) : (
                    <span className="g5-phase-name" style={{ cursor: "pointer" }} onClick={e => { e.preventDefault(); setEditingPhaseName(pi); setEditPhaseNameValue(p.phase_name); }}>
                      {p.phase_name} <span className="g5-edit-icon" style={{ fontSize: 12, opacity: 0.4 }}>✎</span>
                    </span>
                  )}
                  <div className="g5-phase-actions" onClick={e => e.stopPropagation()} style={{ marginLeft: "auto", flexShrink: 0 }}>
                    <button disabled={pi === 0} onClick={e => { e.preventDefault(); reorderPhase(pi, "up"); }} title="Subir">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button disabled={pi === current.phases.length - 1} onClick={e => { e.preventDefault(); reorderPhase(pi, "down"); }} title="Bajar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                  </div>
                  <svg className="g5-phase-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </summary>
                <div className="g5-speech-phase-body">
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
              </details>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!current && (() => {
          const stage = stages.find(s => s.id === selectedStageId);
          if (stage && !stage.scorecard_id) {
            return (
              <div className="c5-empty-card" style={{ background: "#f5f5f4", borderColor: "#d6d3d1" }}>
                <div className="c5-empty-title" style={{ color: "#78716c" }}>Aún no configurado</div>
                <div className="c5-empty-sub" style={{ color: "#a8a29e" }}>Esta etapa aún no tiene criterios de evaluación. Contacta a tu administrador para configurarla. Él puede hacerlo desde la sección de administración.</div>
              </div>
            );
          }
          return (
            <div className="c5-empty-card">
              <div className="c5-empty-title">Sin speech para esta etapa</div>
              <div className="c5-empty-sub">Crea uno nuevo o genera con IA.</div>
            </div>
          );
        })()}

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

        {/* Create speech modal */}
        {showCreateModal && (
          <>
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100 }} onClick={() => setShowCreateModal(false)} />
            <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "white", borderRadius: 12, padding: 24, zIndex: 101, width: "min(400px, 90vw)", boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}>
              <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>Crear speech nuevo</h3>
              <p style={{ fontSize: 13, color: "#737373", margin: "0 0 12px" }}>
                Selecciona la etapa del embudo. Se creará una plantilla basada en los criterios de evaluación configurados.
              </p>
              {stages.filter(s => s.scorecard_id && (!speechByStage[s.id] || speechByStage[s.id].isProvisional)).length === 0 ? (
                <p style={{ fontSize: 13, color: "#78716c", background: "#f5f5f4", borderRadius: 8, padding: "10px 12px", margin: "0 0 12px" }}>
                  Todas las etapas con evaluación ya tienen speech. Para editarlas, selecciona la etapa en los tabs.
                </p>
              ) : (
                <select className="input-field" value={createStageId} onChange={e => setCreateStageId(e.target.value)} style={{ marginBottom: 12 }}>
                  <option value="">Selecciona etapa</option>
                  {stages.filter(s => s.scorecard_id && (!speechByStage[s.id] || speechByStage[s.id].isProvisional)).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  {stages.filter(s => !s.scorecard_id).map(s => (
                    <option key={s.id} value="" disabled>
                      {s.name} (sin criterios de evaluación)
                    </option>
                  ))}
                </select>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                {stages.filter(s => s.scorecard_id && (!speechByStage[s.id] || speechByStage[s.id].isProvisional)).length > 0 && (
                  <button className="btn-submit" onClick={createSpeechFromTemplate} disabled={creatingSpeech || !createStageId} style={{ flex: 1 }}>
                    {creatingSpeech ? "Creando..." : "Crear plantilla"}
                  </button>
                )}
                <button className="adm-btn-ghost" onClick={() => setShowCreateModal(false)} style={{ padding: "8px 16px" }}>
                  {stages.filter(s => s.scorecard_id && (!speechByStage[s.id] || speechByStage[s.id].isProvisional)).length > 0 ? "Cancelar" : "Cerrar"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
