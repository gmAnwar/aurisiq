"use client";

import { useState, useEffect, use } from "react";
import { supabase } from "../../../../lib/supabase";
import { requireAuth } from "../../../../lib/auth";

interface Phase { phase_name: string; score: number; score_max: number; }
interface DescalCat { code: string; label: string; }

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "direccion", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const { data: a } = await supabase.from("analyses")
        .select("id, user_id, score_general, clasificacion, momento_critico, patron_error, objecion_principal, siguiente_accion, categoria_descalificacion, created_at, organization_id, manager_note")
        .eq("id", id).single();

      if (!a) { setError("Análisis no encontrado."); setLoading(false); return; }
      setAnalysis(a);
      setManagerNote((a.manager_note as string) || "");

      const [userRes, phasesRes, descalRes, jobRes] = await Promise.all([
        supabase.from("users").select("name").eq("id", a.user_id as string).single(),
        supabase.from("analysis_phases").select("phase_name, score, score_max").eq("analysis_id", id).order("created_at", { ascending: true }),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", a.organization_id as string),
        supabase.from("analysis_jobs").select("transcription_text, has_audio, audio_url, audio_expires_at, transcription_original, edit_percentage").eq("analysis_id", id).single(),
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
      }

      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-textarea" />
      <div className="skeleton-block skeleton-textarea" />
    </div></div>);
  }

  if (error || !analysis) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="message-box message-error"><p>{error}</p></div>
    </div></div>);
  }

  const date = new Date(analysis.created_at as string);
  const descalCodes = (analysis.categoria_descalificacion as string[] | null) || [];

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        {/* Header */}
        <div className="g3-header">
          <div className="g3-meta">
            <span>{date.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</span>
            <span>·</span>
            <a href={`/equipo/captadora/${analysis.user_id}`} className="g3-captadora-link">{captadoraName}</a>
          </div>
          {(analysis.score_general as number | null) !== null && (
            <div className="c3-score-footer" style={{ marginTop: 12 }}>
              <span className="c3-score-label">Score</span>
              <span className="c3-score-value">{analysis.score_general as number}</span>
              {analysis.clasificacion && (
                <span className={`c3-clasificacion c3-clas-${analysis.clasificacion}`}>{analysis.clasificacion as string}</span>
              )}
            </div>
          )}
        </div>

        {/* Phase scorecard */}
        {phases.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Scorecard</h2>
            <div className="g3-scorecard">
              {phases.map((p, i) => {
                const pct = p.score_max > 0 ? (p.score / p.score_max) * 100 : 0;
                return (
                  <div key={i} className="c3-phase-row">
                    <div className="c3-phase-header">
                      <span className="c3-phase-name">{p.phase_name}</span>
                      <span className="c3-phase-score">{p.score}/{p.score_max}</span>
                    </div>
                    <div className="c3-phase-bar-bg">
                      <div className="c3-phase-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Insights */}
        <div className="g3-insights">
          {analysis.momento_critico && (
            <div className="g3-insight">
              <span className="g3-insight-label">Momento crítico</span>
              <p>{analysis.momento_critico as string}</p>
            </div>
          )}
          {analysis.patron_error && (
            <div className="g3-insight">
              <span className="g3-insight-label">Patrón de error</span>
              <p>{analysis.patron_error as string}</p>
            </div>
          )}
          {analysis.objecion_principal && (
            <div className="g3-insight">
              <span className="g3-insight-label">Objeción principal</span>
              <p>{analysis.objecion_principal as string}</p>
            </div>
          )}
          {analysis.siguiente_accion && (
            <div className="g3-insight">
              <span className="g3-insight-label">Siguiente acción</span>
              <p>{analysis.siguiente_accion as string}</p>
            </div>
          )}
        </div>

        {/* Descalification reasons */}
        {descalCodes.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Razones de descalificación</h2>
            <div className="c3-descal-list">
              {descalCodes.map((code, i) => (
                <span key={i} className={i === 0 ? "c3-descal-primary" : "c3-descal-secondary"}>
                  {descalMap[code] || "Razón no reconocida"}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Manager Note */}
        <div className="g1-section">
          <h2 className="g1-section-title">Nota del gerente</h2>
          {editingNote ? (
            <div className="g4-note-edit">
              <textarea className="input-field" rows={3} value={managerNote} onChange={e => setManagerNote(e.target.value)} placeholder="Escribe una nota sobre este análisis..." />
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
                <span className="g3-edit-badge">Editada {editPercentage}%</span>
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
