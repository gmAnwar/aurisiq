"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import { useRecording } from "../contexts/RecordingContext";
import {
  putRecording,
  countPending,
  checkStorageAvailable,
  getIncompleteRecordings,
  deleteRecording,
  RecordingLock,
  type PendingRecording,
} from "../../lib/recordings-queue";
import { uploadWithRetry, submitForAnalysis } from "../../lib/recording-upload";

interface FunnelStage {
  id: string;
  name: string;
  scorecard_id: string | null;
}

type PageState = "idle" | "recording" | "post";

export default function GrabarPage() {
  const rec = useRecording();

  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [storageWarning, setStorageWarning] = useState(false);
  const [callNotes, setCallNotes] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");
  const [orgVertical, setOrgVertical] = useState("");
  const [recoveryRec, setRecoveryRec] = useState<PendingRecording | null>(null);

  // Auto-save ref
  const autoSaveIdRef = useRef<string | null>(null);

  // Multi-tab lock
  const lockRef = useRef<RecordingLock | null>(null);
  const [lockedByOther, setLockedByOther] = useState(false);

  // Waveform
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Recording limits based on vertical
  const PRESENCIAL_VERTICALS = ["body_spa", "dentistas", "quiropractico"];
  const isPresencial = orgVertical !== "" && PRESENCIAL_VERTICALS.includes(orgVertical);
  const maxRecordingMin = isPresencial ? 50 : 25;
  const maxRecordingSec = maxRecordingMin * 60;

  // Unique scorecards for toggle
  const uniqueScorecards = funnelStages
    .filter(s => s.scorecard_id)
    .reduce<{ id: string; name: string; stageId: string }[]>((acc, s) => {
      if (!acc.some(x => x.id === s.scorecard_id)) acc.push({ id: s.scorecard_id!, name: s.name, stageId: s.id });
      return acc;
    }, []);
  const isMultiScorecard = uniqueScorecards.length >= 2;

  // Init
  useEffect(() => {
    async function init() {
      const session = await requireAuth(["captadora", "gerente", "super_admin"]);
      if (!session) return;
      setUserId(session.userId);
      setOrgId(session.organizationId);

      const [stagesRes, count, storage, scRes] = await Promise.all([
        supabase.from("funnel_stages").select("id, name, scorecard_id")
          .eq("organization_id", session.organizationId).eq("active", true).order("order_index"),
        countPending(session.userId),
        checkStorageAvailable(),
        supabase.from("scorecards").select("vertical").eq("organization_id", session.organizationId).eq("active", true).limit(1).maybeSingle(),
      ]);

      setFunnelStages(stagesRes.data || []);
      setPendingCount(count);
      if (!storage.available) setStorageWarning(true);
      if (scRes.data?.vertical) setOrgVertical(scRes.data.vertical);

      // Check for incomplete recordings (crash recovery)
      const incomplete = await getIncompleteRecordings(session.userId);
      if (incomplete.length > 0) {
        const newest = incomplete[0];
        const ageMin = (Date.now() - new Date(newest.created_at).getTime()) / 60000;
        if (ageMin > 5) {
          setRecoveryRec(newest);
        } else {
          // Recent incomplete — silently delete (probably just finished)
          for (const r of incomplete) await deleteRecording(r.id);
        }
      }

      setLoading(false);
    }
    init();

    // Multi-tab lock
    const lock = new RecordingLock();
    lockRef.current = lock;
    lock.onChange(setLockedByOther);
    return () => lock.destroy();
  }, []);

  // Auto-save metadata every 30s during recording (crash recovery marker)
  useEffect(() => {
    if (rec.recMode !== "recording" && rec.recMode !== "paused") {
      // Recording stopped — clean up incomplete marker
      if (autoSaveIdRef.current) {
        deleteRecording(autoSaveIdRef.current).catch(() => {});
        autoSaveIdRef.current = null;
      }
      return;
    }
    if (!userId || !orgId) return;

    const saveId = autoSaveIdRef.current || crypto.randomUUID();
    autoSaveIdRef.current = saveId;

    const save = () => {
      putRecording({
        id: saveId,
        audio_blob: new Blob([]), // placeholder — actual audio not available until stop
        duration_seconds: rec.recElapsed,
        created_at: new Date().toISOString(),
        organization_id: orgId,
        user_id: userId,
        scorecard_id: null,
        funnel_stage_id: null,
        prospect_name: null,
        notes: callNotes || null,
        status: "pending",
        attempt_count: 0,
        last_error: null,
        uploaded_audio_url: null,
        analysis_id: null,
        incomplete: true,
        mime_type: "audio/webm",
      }).catch(() => {});
    };

    save(); // Save immediately on start
    const interval = setInterval(save, 30000);
    return () => clearInterval(interval);
  }, [rec.recMode, userId, orgId]);

  // Track recording state changes
  useEffect(() => {
    if (rec.recMode === "recording" || rec.recMode === "paused") {
      setPageState("recording");
    } else if (rec.recMode === "off" && pageState === "recording") {
      // Just stopped — check if there's a transcription result (means audio was processed)
      if (rec.transcriptionResult) {
        setPageState("post");
      }
    }
  }, [rec.recMode]);

  // When transcription result arrives, move to post state
  useEffect(() => {
    if (rec.transcriptionResult && pageState !== "post") {
      setPageState("post");
    }
  }, [rec.transcriptionResult]);

  // Waveform drawing
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = rec.analyserNode;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);
      ctx.fillStyle = "#f5f5f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "var(--accent, #00C2E0)";
      ctx.beginPath();
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };
    draw();
  }, [rec.analyserNode]);

  useEffect(() => {
    if (rec.recMode === "recording" && rec.analyserNode && canvasRef.current) drawWaveform();
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [rec.recMode, rec.analyserNode, drawWaveform]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ─── Start recording ──────────────────────────────────────
  const handleStart = async () => {
    if (!orgId || lockedByOther) return;
    lockRef.current?.acquireLock();
    await rec.startRecording(orgId);
  };

  // ─── Save to queue + upload in background ─────────────────
  const handleSaveToQueue = async () => {
    if (!userId || !orgId || !rec.transcriptionResult) return;
    setSubmitting(true);
    setSubmitMsg("Guardando...");

    const stageId = selectedStage || (uniqueScorecards.length === 1 ? uniqueScorecards[0].stageId : "");
    const scorecardId = stageId
      ? funnelStages.find(s => s.id === stageId)?.scorecard_id || null
      : (uniqueScorecards.length === 1 ? uniqueScorecards[0].id : null);

    const recording: PendingRecording = {
      id: crypto.randomUUID(),
      audio_blob: new Blob([rec.transcriptionResult.original], { type: "text/plain" }),
      duration_seconds: rec.recElapsed,
      created_at: new Date().toISOString(),
      organization_id: orgId,
      user_id: userId,
      scorecard_id: scorecardId,
      funnel_stage_id: stageId || null,
      prospect_name: prospectName.trim() || null,
      notes: callNotes.trim() || null,
      status: "pending",
      attempt_count: 0,
      last_error: null,
      uploaded_audio_url: null,
      analysis_id: null,
      incomplete: false,
      mime_type: "text/plain",
    };

    await putRecording(recording);
    setPendingCount(prev => prev + 1);

    // Background upload
    uploadWithRetry(recording).catch(() => {});

    setSubmitMsg("Guardado en cola");
    setTimeout(() => {
      setPageState("idle");
      setCallNotes("");
      setProspectName("");
      setSelectedStage("");
      setSubmitting(false);
      setSubmitMsg("");
      rec.clearTranscriptionResult();
    }, 800);
  };

  // ─── Analyze now (inline, like /analisis/nueva) ───────────
  const handleAnalyzeNow = async () => {
    if (!userId || !orgId || !rec.transcriptionResult) return;
    setSubmitting(true);
    setSubmitMsg("Enviando para análisis...");

    const stageId = selectedStage || (uniqueScorecards.length === 1 ? uniqueScorecards[0].stageId : "");
    const scorecardId = stageId
      ? funnelStages.find(s => s.id === stageId)?.scorecard_id || null
      : (uniqueScorecards.length === 1 ? uniqueScorecards[0].id : null);

    if (!scorecardId) {
      setSubmitMsg("Selecciona el tipo de visita");
      setSubmitting(false);
      return;
    }

    try {
      // Create background job directly with transcription text
      const { data: job, error } = await supabase
        .from("background_jobs")
        .insert({
          organization_id: orgId,
          user_id: userId,
          type: "analysis",
          status: "pending",
          priority: 0,
          payload: {
            transcription_text: rec.transcriptionResult.text,
            scorecard_id: scorecardId,
            funnel_stage_id: stageId || null,
            fuente_lead_id: null,
            prospect_phone: null,
            transcription_original: rec.transcriptionResult.original,
            transcription_edited: rec.transcriptionResult.text !== rec.transcriptionResult.original ? rec.transcriptionResult.text : null,
            edit_percentage: 0,
            call_notes: callNotes.trim() || null,
            has_audio: true,
            pause_count: rec.pauseCount,
            total_paused_seconds: rec.totalPausedSecs,
            avanzo_a_siguiente_etapa: "pending",
          },
          max_retries: 2,
        })
        .select("id")
        .single();

      if (error || !job) throw new Error(error?.message || "Failed to create job");

      // Invoke edge function
      const { data: { session } } = await supabase.auth.getSession();
      const edgeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/analyze`;
      await fetch(edgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ job_id: job.id }),
      });

      setSubmitMsg("Analizando...");

      // Poll for completion
      const poll = setInterval(async () => {
        const { data: j } = await supabase.from("background_jobs").select("status, result").eq("id", job.id).single();
        if (j?.status === "completed") {
          clearInterval(poll);
          const analysisId = (j.result as { analysis_id?: string })?.analysis_id;
          if (analysisId) {
            rec.clearTranscriptionResult();
            window.location.href = `/analisis/${analysisId}`;
          }
        } else if (j?.status === "error") {
          clearInterval(poll);
          setSubmitMsg("Error en análisis. Guardando en cola...");
          await handleSaveToQueue();
        }
      }, 3000);

      setTimeout(() => clearInterval(poll), 180000);
    } catch (err) {
      setSubmitMsg("Error — guardando en cola...");
      await handleSaveToQueue();
    }
  };

  if (loading) {
    return (
      <div className="grabar-container">
        <div className="skeleton-block skeleton-title" />
      </div>
    );
  }

  // ─── Transcribing state ───────────────────────────────────
  if (rec.recMode === "transcribing") {
    return (
      <div className="grabar-container">
        <div className="grabar-hero">
          <div className="ear-recording">
            <div className="ear-rec-indicator">
              <span className="ear-rec-dot" style={{ animationDuration: "2s" }} />
              <span className="ear-rec-label">Procesando</span>
            </div>
            <span className="ear-timer">{formatTime(rec.recElapsed)}</span>
            <div className="c2-progress-section" style={{ width: "100%", maxWidth: 320 }}>
              <div className="c2-progress-bg">
                <div className="c2-progress-fill" style={{ width: `${rec.transcribePct}%` }} />
              </div>
              <p className="c2-progress-phase">{rec.transcribePhase}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Recording state ──────────────────────────────────────
  if (pageState === "recording" && rec.recMode !== "off") {
    return (
      <div className="grabar-container">
        <div className="ear-recording">
          <div className="ear-rec-indicator">
            <span className="ear-rec-dot" style={rec.recMode === "paused" ? { animation: "none", opacity: 0.3 } : undefined} />
            <span className="ear-rec-label">{rec.recMode === "paused" ? "En pausa" : rec.recLabel}</span>
          </div>
          <span className="ear-timer">{formatTime(rec.recElapsed)}</span>
          <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
          {rec.recElapsed > maxRecordingSec * 0.8 && (
            <p className="ear-long-warning">
              {rec.recElapsed > maxRecordingSec
                ? `Limite de ${maxRecordingMin} min excedido. Detén la grabación.`
                : `Llevas mas de ${Math.floor(rec.recElapsed / 60)} minutos. Limite: ${maxRecordingMin} min.`}
            </p>
          )}
          <div className="ear-btn-row">
            {rec.recMode === "recording" ? (
              <button className="ear-pause-btn" onClick={rec.pauseRecording}>Pausar</button>
            ) : (
              <button className="ear-resume-btn" onClick={rec.resumeRecording}>Continuar</button>
            )}
            <button className="ear-stop-btn" onClick={() => { rec.stopRecording(); lockRef.current?.releaseLock(); }}>
              Terminar
            </button>
          </div>
          <button className="ear-retry-btn" onClick={() => { rec.cancelRecording(); lockRef.current?.releaseLock(); setPageState("idle"); }}>
            Cancelar
          </button>
        </div>

        {/* Notes during recording */}
        <div style={{ width: "100%", maxWidth: 400, marginTop: 16 }}>
          <textarea
            className="input-field"
            rows={3}
            placeholder="Notas rapidas..."
            value={callNotes}
            onChange={(e) => setCallNotes(e.target.value)}
            style={{ fontSize: 13, resize: "vertical" }}
          />
        </div>
      </div>
    );
  }

  // ─── Post-recording state ─────────────────────────────────
  if (pageState === "post" && rec.transcriptionResult) {
    return (
      <div className="grabar-container">
        <div className="grabar-post">
          <div className="grabar-post-summary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            {formatTime(rec.recElapsed)}
            <span>{(rec.transcriptionResult.text.length / 1024).toFixed(1)} KB</span>
          </div>

          {/* Scorecard toggle for multi-scorecard orgs */}
          {isMultiScorecard && (
            <>
              <p style={{ fontSize: 14, fontWeight: 500, marginTop: 8 }}>Tipo de visita</p>
              <div className="c2-scorecard-toggle">
                {uniqueScorecards.map(sc => (
                  <button
                    key={sc.id}
                    type="button"
                    className={`c2-toggle-pill${selectedStage === sc.stageId ? " c2-toggle-pill--active" : ""}`}
                    onClick={() => setSelectedStage(sc.stageId)}
                    disabled={submitting}
                  >
                    {sc.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Prospect name */}
          <input
            type="text"
            className="input-field"
            placeholder="Nombre del paciente (opcional)"
            value={prospectName}
            onChange={(e) => setProspectName(e.target.value)}
            disabled={submitting}
          />

          {/* Action buttons */}
          <button
            className="btn-submit btn-terracota"
            onClick={handleAnalyzeNow}
            disabled={submitting || (isMultiScorecard && !selectedStage)}
            style={{ padding: "14px 20px", fontSize: 16, fontWeight: 600 }}
          >
            {submitting ? submitMsg : "Analizar ahora"}
          </button>

          <button
            className="btn-submit"
            onClick={handleSaveToQueue}
            disabled={submitting}
            style={{ padding: "12px 20px", fontSize: 14 }}
          >
            Nueva consulta (analizar despues)
          </button>
        </div>
      </div>
    );
  }

  // ─── Idle state — Hero button ─────────────────────────────
  return (
    <div className="grabar-container">
      {/* Recovery modal for incomplete recordings */}
      {recoveryRec && (
        <div style={{ width: "100%", maxWidth: 400, padding: 16, background: "#fef9c3", border: "1px solid #fde047", borderRadius: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Grabacion incompleta encontrada
          </p>
          <p style={{ fontSize: 13, color: "#854d0e", marginBottom: 12 }}>
            {Math.round((Date.now() - new Date(recoveryRec.created_at).getTime()) / 60000)} min ago · {Math.round(recoveryRec.duration_seconds / 60)} min grabados
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-submit"
              style={{ fontSize: 13, padding: "8px 14px" }}
              onClick={() => {
                // Can't recover actual audio (wasn't saved), just acknowledge
                deleteRecording(recoveryRec.id);
                setRecoveryRec(null);
              }}
            >
              Descartar
            </button>
          </div>
        </div>
      )}
      <div className="grabar-hero">
        {storageWarning && (
          <p style={{ fontSize: 12, color: "#854d0e", background: "#fef9c3", padding: "6px 12px", borderRadius: 6, textAlign: "center" }}>
            Espacio de almacenamiento bajo. Las grabaciones largas podrian fallar.
          </p>
        )}

        {lockedByOther ? (
          <div className="grabar-locked-msg">
            Hay una grabacion activa en otra pestana. Cierra esa pestana para grabar aqui.
          </div>
        ) : (
          <>
            <button className="grabar-btn" onClick={handleStart} disabled={!orgId}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="22"/>
              </svg>
            </button>
            <span className="grabar-btn-label">Grabar consulta</span>
          </>
        )}

        <div className="grabar-secondary">
          <Link href="/analisis/nueva">o subir audio / pegar transcripcion</Link>
        </div>
      </div>

      {pendingCount > 0 && (
        <Link href="/grabaciones-pendientes" className="grabar-pending-link">
          {pendingCount} pendiente{pendingCount > 1 ? "s" : ""}
        </Link>
      )}
    </div>
  );
}
