"use client";

import { useState, useEffect, use } from "react";
import { supabase } from "../../../../lib/supabase";
import { requireAuth } from "../../../../lib/auth";

interface Phase { phase_name: string; score: number; score_max: number; }
interface DescalCat { code: string; label: string; }
interface ChecklistItem { field: string; covered: boolean; }
interface RelatedCall { id: string; score_general: number | null; created_at: string; }

export default function AnalisisGerentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [captadoraName, setCaptadoraName] = useState("");
  const [descalMap, setDescalMap] = useState<Record<string, string>>({});
  const [transcription, setTranscription] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioExpired, setAudioExpired] = useState(true);
  const [managerNote, setManagerNote] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [editPercentage, setEditPercentage] = useState(0);
  const [transcriptionOriginal, setTranscriptionOriginal] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [pauseCount, setPauseCount] = useState(0);
  const [totalPaused, setTotalPaused] = useState(0);
  const [relatedCalls, setRelatedCalls] = useState<RelatedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "direccion", "super_admin"]);
      if (!session) return;

      const { data: a } = await supabase.from("analyses")
        .select("id, user_id, score_general, clasificacion, momento_critico, patron_error, objecion_principal, siguiente_accion, categoria_descalificacion, created_at, organization_id, manager_note, prospect_name, prospect_zone, property_type, sale_reason, prospect_phone, checklist_results")
        .eq("id", id).single();

      if (!a) { setError("Análisis no encontrado."); setLoading(false); return; }
      setAnalysis(a);
      setManagerNote((a.manager_note as string) || "");

      const [userRes, phasesRes, descalRes, jobRes] = await Promise.all([
        supabase.from("users").select("name").eq("id", a.user_id as string).single(),
        supabase.from("analysis_phases").select("phase_name, score, score_max").eq("analysis_id", id).order("created_at", { ascending: true }),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", a.organization_id as string),
        supabase.from("analysis_jobs").select("transcription_text, has_audio, audio_url, audio_expires_at, transcription_original, edit_percentage, pause_count, total_paused_seconds").eq("analysis_id", id).single(),
      ]);

      setCaptadoraName(userRes.data?.name || "");
      setPhases(phasesRes.data || []);

      const dm: Record<string, string> = {};
      for (const c of (descalRes.data || []) as DescalCat[]) dm[c.code] = c.label;
      setDescalMap(dm);

      if (jobRes.data) {
        setTranscription(jobRes.data.transcription_text || null);
        setHasAudio(jobRes.data.has_audio || false);
        setAudioUrl(jobRes.data.audio_url || null);
        setAudioExpired(!jobRes.data.audio_expires_at || new Date(jobRes.data.audio_expires_at) <= new Date());
        setEditPercentage(jobRes.data.edit_percentage || 0);
        setTranscriptionOriginal(jobRes.data.transcription_original || null);
        setPauseCount(jobRes.data.pause_count || 0);
        setTotalPaused(jobRes.data.total_paused_seconds || 0);
      }

      // Related calls with same prospect
      const prospectName = a.prospect_name as string | null;
      if (prospectName && prospectName !== "No identificado") {
        const { data: related } = await supabase.from("analyses")
          .select("id, score_general, created_at")
          .eq("organization_id", a.organization_id as string)
          .eq("status", "completado")
          .neq("id", id)
          .ilike("prospect_name", prospectName)
          .order("created_at", { ascending: false })
          .limit(5);
        setRelatedCalls(related || []);
      }

      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error || !analysis) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  const date = new Date(analysis.created_at as string);
  const descalCodes = (analysis.categoria_descalificacion as string[] | null) || [];
  const isQualified = descalCodes.length === 0;
  const checklist = (analysis.checklist_results as ChecklistItem[] | null) || [];
  const covered = checklist.filter(c => c.covered).length;
  const scoreColor = (analysis.score_general as number) >= 85 ? "var(--green)" : (analysis.score_general as number) >= 65 ? "var(--gold)" : (analysis.score_general as number) >= 45 ? "var(--cap)" : "var(--red)";

  const prospectLabel = [analysis.prospect_name, analysis.prospect_zone, analysis.property_type].filter(Boolean).join(" · ") as string;

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        {/* Header — prospect info + score */}
        <div className="g3-header">
          <div>
            <h1 className="g3-prospect-title">{prospectLabel || "Análisis"}</h1>
            <div className="g3-meta">
              <span>{date.toLocaleDateString("es-MX", { day: "numeric", month: "long" })} · {date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
              <span>·</span>
              <a href={`/equipo/captadora/${analysis.user_id}`} className="g3-captadora-link">{captadoraName}</a>
            </div>
          </div>
          {(analysis.score_general as number | null) !== null && (
            <span className="g3-score-big" style={{ color: scoreColor }}>{analysis.score_general as number}</span>
          )}
        </div>

        {/* Descal pills */}
        <div style={{ marginBottom: 14 }}>
          {isQualified ? (
            <span className="c3-pill c3-pill-green">Lead calificado</span>
          ) : (
            <div className="c3-pill-list">
              {descalCodes.map((code, i) => (
                <span key={i} className={`c3-pill ${i === 0 ? "c3-pill-primary" : "c3-pill-secondary"}`}>
                  {descalMap[code] || code}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Prospect card */}
        {(analysis.sale_reason || analysis.prospect_phone) && (
          <div className="c3-prospect-card" style={{ marginBottom: 14 }}>
            {analysis.sale_reason && (analysis.sale_reason as string) !== "No mencionado" && (
              <p className="c3-prospect-reason">Motivo de venta: {analysis.sale_reason as string}</p>
            )}
            {analysis.prospect_phone && (
              <p className="c3-prospect-reason">Tel: {analysis.prospect_phone as string}</p>
            )}
          </div>
        )}

        {/* Related calls */}
        {relatedCalls.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Historial con {(analysis.prospect_name as string) || "este prospecto"} ({relatedCalls.length + 1} llamadas)</h2>
            <div className="c3-related-list">
              {relatedCalls.map(r => (
                <a key={r.id} href={`/equipo/analisis/${r.id}`} className="c3-related-item">
                  <span className="c3-related-date">{new Date(r.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                  {r.score_general !== null && <span className="c3-related-score">{r.score_general}</span>}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Checklist visual */}
        {checklist.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Checklist ({covered}/{checklist.length})</h2>
            <div className="c3-checklist">
              {checklist.map((item, i) => (
                <div key={i} className={`c3-check-item ${item.covered ? "c3-check-yes" : "c3-check-no"}`}>
                  <span className="c3-check-icon">{item.covered ? "\u2713" : "\u2717"}</span>
                  <span className="c3-check-label">{item.field}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Phase scorecard */}
        {phases.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Scorecard</h2>
            {phases.map((p, i) => {
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
        )}

        {/* Coaching insights */}
        <div className="g3-insights">
          {analysis.patron_error && (
            <div className="g3-insight">
              <span className="g3-insight-label">Coaching</span>
              <p>{analysis.patron_error as string}</p>
            </div>
          )}
          {analysis.objecion_principal && (
            <div className="g3-insight">
              <span className="g3-insight-label">Objeción</span>
              <p>{analysis.objecion_principal as string}</p>
            </div>
          )}
          {analysis.siguiente_accion && (
            <div className="g3-insight">
              <span className="g3-insight-label">Siguiente paso</span>
              <p>{analysis.siguiente_accion as string}</p>
            </div>
          )}
        </div>

        {/* Recording metadata */}
        {(pauseCount > 0 || editPercentage >= 0 || hasAudio) && (
          <div className="g1-section">
            <h2 className="g1-section-title">Metadata de grabación</h2>
            <div className="g3-metadata">
              {hasAudio && <span className="g3-meta-tag">Audio grabado</span>}
              {pauseCount > 0 && (
                <span className="g3-meta-tag">{pauseCount} pausa{pauseCount > 1 ? "s" : ""} ({Math.floor(totalPaused / 60)}:{String(totalPaused % 60).padStart(2, "0")} pausado)</span>
              )}
              {editPercentage === 0 ? (
                <span className="g3-meta-tag g3-edit-none">Sin ediciones</span>
              ) : editPercentage <= 10 ? (
                <span className="g3-meta-tag g3-edit-low">Editado {Math.round(editPercentage * 10) / 10}%</span>
              ) : (
                <span className="g3-meta-tag g3-edit-high" title="Revisar — alta divergencia vs transcripción original">Editado {Math.round(editPercentage * 10) / 10}%</span>
              )}
            </div>
          </div>
        )}

        {/* Manager Note */}
        <div className="g1-section">
          <h2 className="g1-section-title">Nota para la captadora</h2>
          {editingNote ? (
            <div className="g4-note-edit">
              <textarea className="input-field" rows={3} value={managerNote} onChange={e => setManagerNote(e.target.value)} placeholder="Escribe una nota que la captadora verá en su resultado..." />
              <div className="g4-note-actions">
                <button className="g4-note-save" onClick={async () => {
                  await supabase.from("analyses").update({ manager_note: managerNote }).eq("id", id);
                  setEditingNote(false);
                }}>Guardar</button>
                <button className="g4-note-cancel" onClick={() => setEditingNote(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="g4-note-display" onClick={() => setEditingNote(true)}>
              {managerNote ? <p className="g4-note-text">{managerNote}</p> : <p className="g4-note-placeholder">Agregar nota...</p>}
            </div>
          )}
        </div>

        {/* Audio */}
        {hasAudio && audioUrl && !audioExpired && (
          <div className="g1-section">
            <h2 className="g1-section-title">Audio</h2>
            <audio controls src={audioUrl} className="g3-audio" />
          </div>
        )}

        {/* Transcription */}
        {transcription && (
          <div className="g1-section">
            <div className="g3-transcription-header">
              <h2 className="g1-section-title">Transcripción</h2>
              {editPercentage > 0 && (
                <span className={`g3-edit-badge ${editPercentage > 10 ? "g3-edit-badge-high" : "g3-edit-badge-low"}`} title={editPercentage > 10 ? "Revisar — alta divergencia vs transcripción original" : undefined}>
                  Editada {Math.round(editPercentage * 10) / 10}%
                </span>
              )}
            </div>
            <div className="g3-transcription">{transcription}</div>
            {editPercentage > 0 && transcriptionOriginal && (
              <>
                <button className="g3-show-original" onClick={() => setShowOriginal(!showOriginal)}>
                  {showOriginal ? "Ocultar original" : "Ver original"}
                </button>
                {showOriginal && (
                  <div className="g3-original-panel">
                    <span className="g3-original-label">Transcripción original (AssemblyAI)</span>
                    <div className="g3-transcription g3-transcription-original">{transcriptionOriginal}</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
