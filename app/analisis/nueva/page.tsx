"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth, getActiveOrgId } from "../../../lib/auth";
import { computeEditPercentage } from "../../../lib/text";
import { useRecording } from "../../contexts/RecordingContext";

interface GuideField { field_name: string; phrases: string[]; }
interface GuidePhase { phase_name: string; transition?: string; fields?: GuideField[]; phrases?: string[]; }

interface LeadSource {
  id: string;
  name: string;
}

type Status = "idle" | "analyzing" | "error";

interface FunnelStage {
  id: string;
  name: string;
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function NuevaLlamadaPage() {
  const rec = useRecording();

  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
  const [prospectPhone, setProspectPhone] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileMsg, setFileMsg] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionOriginal, setTranscriptionOriginal] = useState<string | null>(null);
  const [transcriptionSource, setTranscriptionSource] = useState<"manual" | "audio">("manual");
  const [editPct, setEditPct] = useState(0);

  const [mobile, setMobile] = useState(false);
  const [analysisPct, setAnalysisPct] = useState(0);
  const [analysisPhase, setAnalysisPhase] = useState("");
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guidePhases, setGuidePhases] = useState<GuidePhase[]>([]);
  const [guideLoading, setGuideLoading] = useState(false);
  const [missedFields, setMissedFields] = useState<string[]>([]);
  const [dailyTarget, setDailyTarget] = useState<number | null>(null);
  const [dailyDone, setDailyDone] = useState(0);

  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const wordCount = transcription.trim().split(/\s+/).filter(Boolean).length;
  const MIN_WORDS = transcriptionSource === "audio" ? 50 : 200;

  const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm", ".mp4"];
  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  // ─── Consume transcription result from recording context ──
  useEffect(() => {
    if (rec.transcriptionResult) {
      setTranscription(rec.transcriptionResult.text);
      setTranscriptionOriginal(rec.transcriptionResult.original);
      setTranscriptionSource("audio");
      setEditPct(0);
      setFileMsg(rec.transcriptionResult.message);
      rec.clearTranscriptionResult();
    }
  }, [rec.transcriptionResult]);

  // ─── File upload transcription (independent of recording) ─
  const transcribeAudioBlob = async (blob: Blob, label?: string) => {
    if (blob.size < 1024) {
      setFileMsg("La grabación es muy corta. Intenta con un audio más largo.");
      return;
    }
    if (blob.size > 25 * 1024 * 1024) {
      setFileMsg("El audio excede 25MB. Intenta con un archivo más corto.");
      return;
    }
    setIsTranscribing(true);
    setFileMsg(label || "Transcribiendo audio...");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transcribe", audio_base64: base64, organization_id: orgId }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Normalize legacy worker size errors to the current 25MB limit
        const raw = (data.error as string) || "";
        if (/audio exceeds/i.test(raw)) {
          throw new Error("El audio excede 25MB. Intenta con un archivo más corto.");
        }
        throw new Error(raw || "No pudimos transcribir el audio. Intenta grabar de nuevo en un lugar con menos ruido.");
      }

      let text = data.text || "";
      const textWords = text.trim().split(/\s+/).filter(Boolean).length;

      if (textWords === 0) {
        setFileMsg("No pudimos transcribir el audio. Intenta grabar de nuevo en un lugar con menos ruido.");
        setIsTranscribing(false);
        return;
      } else {
        setFileMsg("Transcripción automática lista — revisa antes de analizar.");
      }

      if (text.length > 15000) {
        text = text.slice(0, 15000);
        setFileMsg("La transcripción es muy larga. Se mostrarán los primeros 15,000 caracteres. Revisa que incluya las partes más importantes de la llamada.");
      }

      setTranscription(text);
      setTranscriptionOriginal(text);
      setTranscriptionSource("audio");
      setEditPct(0);
      sessionStorage.setItem("c2_transcription", text);
      sessionStorage.setItem("c2_original", text);
      sessionStorage.setItem("c2_source_type", "audio");
    } catch (err) {
      setFileMsg(err instanceof Error ? err.message : "No pudimos transcribir el audio. Intenta grabar de nuevo en un lugar con menos ruido.");
    }
    setIsTranscribing(false);
  };

  const extractTextFromFile = async (file: File) => {
    setFileMsg("");
    const name = file.name.toLowerCase();

    if (AUDIO_EXTENSIONS.some(ext => name.endsWith(ext))) {
      await transcribeAudioBlob(file, `Transcribiendo "${file.name}"...`);
      return;
    }

    const CHAR_LIMIT = 15000;
    if (name.endsWith(".txt")) {
      const text = await file.text();
      if (text.length > CHAR_LIMIT) {
        setFileMsg(`El archivo tiene ${text.length.toLocaleString()} caracteres (máximo ${CHAR_LIMIT.toLocaleString()}).`);
        return;
      }
      setTranscription(text);
      setFileMsg(`Archivo "${file.name}" cargado.`);
    } else if (name.endsWith(".doc") || name.endsWith(".docx")) {
      const text = await file.text();
      const cleaned = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned.length > CHAR_LIMIT) {
        setFileMsg(`El texto extraído tiene ${cleaned.length.toLocaleString()} caracteres (máximo ${CHAR_LIMIT.toLocaleString()}).`);
        return;
      }
      if (cleaned.length < 50) {
        setFileMsg("No se pudo extraer texto del archivo. Intenta con un .txt.");
        return;
      }
      setTranscription(cleaned);
      setFileMsg(`Archivo "${file.name}" cargado.`);
    } else {
      setFileMsg("Formato no soportado. Usa .txt, .doc, .docx, .mp3, .m4a, .wav u .ogg.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (status === "analyzing") return;
    const file = e.dataTransfer.files?.[0];
    if (file) extractTextFromFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) extractTextFromFile(file);
    e.target.value = "";
  };
  // Stage is optional: Claude auto-detects it from the transcription
  // when the user leaves it blank. User can still choose a stage manually.
  const canSubmit = selectedSource !== "" && wordCount >= MIN_WORDS && status === "idle" && !isTranscribing;
  const charCount = transcription.length;
  const CHAR_LIMIT = 15000;

  useEffect(() => {
    setMobile(isMobile());
    async function init() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      // super_admin may override the active org via the navbar selector;
      // always resolve the effective org from localStorage first.
      const effectiveOrgId = getActiveOrgId() || session.organizationId;
      setUserId(session.userId);
      setOrgId(effectiveOrgId);

      const [sourcesRes, stagesRes] = await Promise.all([
        supabase.from("lead_sources").select("id, name")
          .eq("organization_id", effectiveOrgId).eq("active", true).order("name"),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", effectiveOrgId).order("order_index"),
      ]);

      const { data: sources, error } = sourcesRes;
      setFunnelStages(stagesRes.data || []);

      if (error) {
        setErrorMsg("No pudimos cargar las fuentes de lead. Intenta de nuevo.");
      } else {
        setLeadSources(sources || []);
      }

      setLoading(false);

      // Daily counter: objective + today's count
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [objRes, todayRes] = await Promise.all([
        supabase.from("objectives").select("target_value")
          .eq("organization_id", effectiveOrgId).eq("is_active", true)
          .eq("type", "volume").in("period_type", ["monthly"])
          .or(`target_user_id.eq.${session.userId},target_user_id.is.null`)
          .order("target_user_id", { ascending: false, nullsFirst: false })
          .limit(1),
        supabase.from("analyses").select("id")
          .eq("user_id", session.userId).eq("status", "completado")
          .gte("created_at", todayStart.toISOString()),
      ]);
      if (objRes.data && objRes.data.length > 0) {
        const monthly = objRes.data[0].target_value;
        setDailyTarget(Math.max(1, Math.ceil(monthly / 22)));
      }
      setDailyDone(todayRes.data?.length || 0);

      // Restore draft from sessionStorage
      const savedText = sessionStorage.getItem("c2_transcription");
      const savedStage = sessionStorage.getItem("c2_stage");
      const savedSource = sessionStorage.getItem("c2_source");
      const savedNotes = sessionStorage.getItem("c2_notes");
      const savedPhone = sessionStorage.getItem("c2_phone");
      const savedOriginal = sessionStorage.getItem("c2_original");
      const savedSrc = sessionStorage.getItem("c2_source_type");
      if (savedText) setTranscription(savedText);
      if (savedStage) setSelectedStage(savedStage);
      if (savedSource) setSelectedSource(savedSource);
      if (savedNotes) setNotes(savedNotes);
      if (savedPhone) setProspectPhone(savedPhone);
      if (savedOriginal) {
        setTranscriptionOriginal(savedOriginal);
        setTranscriptionSource((savedSrc as "manual" | "audio") || "manual");
      }
    }

    init();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Track edits to auto-transcribed text
  const handleTranscriptionChange = useCallback((value: string) => {
    setTranscription(value);
    sessionStorage.setItem("c2_transcription", value);
    if (transcriptionSource === "audio" && transcriptionOriginal) {
      const pct = computeEditPercentage(transcriptionOriginal, value);
      setEditPct(pct);
    }
  }, [transcriptionSource, transcriptionOriginal]);

  // ─── Waveform drawing (uses analyserNode from context) ────

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

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
      analyser.getByteFrequencyData(dataArray);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const barCount = 32;
      const barWidth = Math.floor(w / barCount) - 2;
      const step = Math.floor(bufferLength / barCount);
      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255;
        const barHeight = Math.max(2, value * h * 0.85);
        const x = i * (barWidth + 2);
        const y = (h - barHeight) / 2;
        ctx.fillStyle = value > 0.4 ? "#c87840" : "rgba(200,120,64,0.3)";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };
    draw();
  }, [rec.analyserNode]);

  useEffect(() => {
    if (rec.recMode === "recording" && rec.analyserNode && canvasRef.current) {
      drawWaveform();
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [rec.recMode, rec.analyserNode, drawWaveform]);

  // ─── Guide drawer ──────────────────────────────────────────

  const openGuide = async () => {
    if (!selectedStage || !orgId) return;
    setGuideOpen(true);
    if (guidePhases.length > 0) return;
    setGuideLoading(true);

    // Get speech for this stage. No scorecard filter — orgs may use
    // different scorecards across stages, and speech_versions is already
    // scoped by organization_id.
    let { data } = await supabase.from("speech_versions")
      .select("content")
      .eq("organization_id", orgId)
      .or("published.eq.true,is_provisional.eq.true")
      .eq("funnel_stage_id", selectedStage)
      .order("published", { ascending: false })
      .limit(1);

    // Fallback: org-wide speech (funnel_stage_id is NULL)
    if (!data || data.length === 0) {
      const fallback = await supabase.from("speech_versions")
        .select("content")
        .eq("organization_id", orgId)
        .or("published.eq.true,is_provisional.eq.true")
        .is("funnel_stage_id", null)
        .order("published", { ascending: false })
        .limit(1);
      data = fallback.data;
    }

    if (data && data.length > 0) {
      const content = data[0].content as unknown;
      setGuidePhases(parseGuideContent(content));
    }
    setGuideLoading(false);
  };

  // Parse speech content into guide phases — supports multiple formats
  function parseGuideContent(content: unknown): GuidePhase[] {
    if (!content) return [];

    // Root-level array: [{phase_name, frases|phrases, ...}]
    if (Array.isArray(content)) {
      return (content as Array<Record<string, unknown>>).map(p => ({
        phase_name: (p.phase_name as string) || (p.phase_id as string) || "",
        transition: (p.transition as string) || "",
        fields: (p.fields as GuideField[]) || [],
        phrases: Array.isArray(p.frases) ? (p.frases as string[]) : Array.isArray(p.phrases) ? (p.phrases as string[]) : [],
      }));
    }

    const c = content as Record<string, unknown>;
    if (Array.isArray(c.phases)) {
      return (c.phases as Array<Record<string, unknown>>).map(p => ({
        phase_name: (p.phase_name as string) || "",
        transition: (p.transition as string) || "",
        fields: (p.fields as GuideField[]) || [],
        phrases: Array.isArray(p.frases) ? (p.frases as string[]) : Array.isArray(p.phrases) ? (p.phrases as string[]) : [],
      }));
    }

    return Object.entries(c).map(([name, phrases]) => ({
      phase_name: name,
      phrases: Array.isArray(phrases) ? phrases as string[] : [],
    }));
  }

  // Reset guide when stage changes
  useEffect(() => { setGuidePhases([]); }, [selectedStage]);

  // Fetch missed fields from last 5 analyses for this stage
  useEffect(() => {
    if (!selectedStage || !userId) { setMissedFields([]); return; }
    (async () => {
      const { data } = await supabase.from("analyses")
        .select("checklist_results")
        .eq("user_id", userId)
        .eq("funnel_stage_id", selectedStage)
        .eq("status", "completado")
        .not("checklist_results", "is", null)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!data || data.length === 0) { setMissedFields([]); return; }

      const missCounts: Record<string, number> = {};
      for (const a of data) {
        const items = a.checklist_results as { field: string; covered: boolean }[] | null;
        if (!items) continue;
        for (const item of items) {
          if (!item.covered) missCounts[item.field] = (missCounts[item.field] || 0) + 1;
        }
      }

      const sorted = Object.entries(missCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .filter(([, count]) => count >= 2)
        .map(([field]) => field);

      setMissedFields(sorted);
    })();
  }, [selectedStage, userId]);

  // ─── Submit ────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit || !userId || !orgId) return;

    setStatus("analyzing");
    setErrorMsg("");
    setAnalysisPct(0);
    setAnalysisPhase("Enviando transcripción...");

    const phases = [
      { at: 0, text: "Enviando transcripción..." },
      { at: 15, text: "Analizando con IA..." },
      { at: 40, text: "Evaluando fases del scorecard..." },
      { at: 85, text: "Generando coaching personalizado..." },
      { at: 95, text: "Listo — redirigiendo a resultados..." },
    ];
    let pct = 0;
    const startTime = Date.now();
    progressRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      pct = Math.min(94, Math.floor(elapsed * 1.2));
      if (elapsed > 60) setAnalysisPhase("Tomando más de lo esperado...");
      else {
        const current = [...phases].reverse().find(p => pct >= p.at);
        if (current) setAnalysisPhase(current.text);
      }
      setAnalysisPct(pct);
    }, 500);

    try {
      const { data: scorecard } = await supabase
        .from("scorecards")
        .select("id")
        .or(`organization_id.eq.${orgId},organization_id.is.null`)
        .eq("active", true)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .single();

      if (!scorecard) throw new Error("scorecard");

      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcription: transcription.trim(),
          scorecard_id: scorecard.id,
          user_id: userId,
          organization_id: orgId,
          fuente_lead_id: selectedSource,
          funnel_stage_id: selectedStage || null,
          prospect_phone: prospectPhone.trim() || null,
          transcription_original: transcriptionOriginal,
          transcription_edited: transcriptionSource === "audio" && transcriptionOriginal && transcription.trim() !== transcriptionOriginal
            ? transcription.trim() : null,
          edit_percentage: transcriptionOriginal && transcription.trim() !== transcriptionOriginal
            ? editPct : 0,
          has_audio: transcriptionSource === "audio",
          pause_count: rec.pauseCount,
          total_paused_seconds: rec.totalPausedSecs,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) throw new Error("quota");
        if (res.status === 403) throw new Error("readonly");
        throw new Error(data.error || "worker_error");
      }

      const analysisId = data.analysis_id;

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(WORKER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "status", analysis_id: analysisId, organization_id: orgId }),
          });
          const statusData = await statusRes.json();

          if (statusData.status === "completado") {
            clearInterval(pollInterval);
            if (progressRef.current) clearInterval(progressRef.current);
            setAnalysisPct(100);
            setAnalysisPhase("Listo — redirigiendo a resultados...");

            // Pre-select the auto-detected stage in the dropdown if the
            // user didn't pick one. Fetch the analysis row to read the
            // funnel_stage_id Claude resolved.
            if (!selectedStage) {
              try {
                const { data: a } = await supabase
                  .from("analyses")
                  .select("funnel_stage_id")
                  .eq("id", analysisId)
                  .maybeSingle();
                if (a?.funnel_stage_id) setSelectedStage(a.funnel_stage_id);
              } catch { /* ignore */ }
            }

            setTimeout(() => {
              sessionStorage.removeItem("c2_transcription");
              sessionStorage.removeItem("c2_stage");
              sessionStorage.removeItem("c2_source");
              sessionStorage.removeItem("c2_notes");
              sessionStorage.removeItem("c2_phone");
              sessionStorage.removeItem("c2_original");
              sessionStorage.removeItem("c2_source_type");
              window.location.href = `/analisis/${analysisId}`;
            }, 600);
          } else if (statusData.status === "error") {
            clearInterval(pollInterval);
            if (progressRef.current) clearInterval(progressRef.current);
            setStatus("error");
            setErrorMsg(statusData.error_message || "Hubo un problema al analizar tu llamada. Intenta de nuevo.");
          }
        } catch {
          // Network error on poll — keep trying
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setStatus((current) => {
          if (current === "analyzing") {
            setErrorMsg("El análisis está tomando más tiempo de lo esperado. Intenta de nuevo en unos minutos.");
            return "error";
          }
          return current;
        });
      }, 120000);

    } catch (err: unknown) {
      if (progressRef.current) clearInterval(progressRef.current);
      setStatus("error");
      const message = err instanceof Error ? err.message : "error";
      if (message === "scorecard") {
        setErrorMsg("Tu organización aún no tiene un scorecard configurado. Contacta a tu gerente.");
      } else if (message === "quota") {
        setErrorMsg("Se alcanzó el límite de análisis del mes. Contacta a tu gerente para actualizar el plan.");
      } else if (message === "readonly") {
        setErrorMsg("Tu organización está en modo lectura. Contacta a tu gerente.");
      } else {
        setErrorMsg("No pudimos procesar tu llamada. Intenta de nuevo.");
      }
    }
  };

  const handleRetry = () => {
    setStatus("idle");
    setErrorMsg("");
  };

  if (loading) {
    return (
      <div className="container c2-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-select" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-button" />
      </div>
    );
  }

  // ─── Recording UI (replaces form while active) ─────────────

  if (rec.recMode !== "off") {
    return (
      <div className="container ear-container">
        {(rec.recMode === "recording" || rec.recMode === "paused") && (
          <div className="ear-recording">
            <div className="ear-rec-indicator">
              <span className="ear-rec-dot" style={rec.recMode === "paused" ? { animation: "none", opacity: 0.3 } : undefined} />
              <span className="ear-rec-label">{rec.recMode === "paused" ? "En pausa" : rec.recLabel}</span>
            </div>
            <span className="ear-timer">{formatTime(rec.recElapsed)}</span>
            <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
            {rec.recElapsed > 1800 && (
              <p className="ear-long-warning">Llevas más de 30 minutos grabando. Transcripciones muy largas pueden tardar más en analizar.</p>
            )}
            {rec.pauseCount > 0 && (
              <span className="ear-pause-info">{rec.pauseCount} pausa{rec.pauseCount > 1 ? "s" : ""}</span>
            )}
            <div className="ear-btn-row">
              {rec.recMode === "recording" ? (
                <button className="ear-pause-btn" onClick={rec.pauseRecording}>Pausar</button>
              ) : (
                <button className="ear-resume-btn" onClick={rec.resumeRecording}>Continuar</button>
              )}
              <button className="ear-stop-btn" onClick={rec.stopRecording}>
                Terminar llamada
              </button>
            </div>
            <button className="ear-retry-btn" onClick={rec.cancelRecording}>
              Cancelar
            </button>
          </div>
        )}
        {rec.recMode === "transcribing" && (
          <div className="ear-recording">
            <div className="ear-rec-indicator">
              <span className="ear-rec-dot" style={{ animationDuration: "2s" }} />
              <span className="ear-rec-label">Procesando</span>
            </div>
            <span className="ear-timer">{formatTime(rec.recElapsed)}</span>
            <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
            <div className="c2-progress-section" style={{ width: "100%", maxWidth: 320 }}>
              <div className="c2-progress-bg">
                <div className="c2-progress-fill" style={{ width: `${rec.transcribePct}%` }} />
              </div>
              <p className="c2-progress-phase">{rec.transcribePhase}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Normal C2 form ────────────────────────────────────────

  return (
    <div className="container c2-container">
      {/* Draft banner */}
      {rec.hasDraft && (
        <div className="c2-draft-banner">
          <p className="c2-draft-text">Tienes una grabación pendiente</p>
          <div className="c2-draft-actions">
            <button className="c2-draft-btn c2-draft-use" onClick={() => orgId && rec.useDraft(orgId)}>Transcribir</button>
            <button className="c2-draft-btn c2-draft-discard" onClick={rec.deleteDraft}>Descartar</button>
          </div>
        </div>
      )}

      <div className="c2-header">
        {dailyTarget !== null && (
          <p className={`c2-daily-counter ${dailyDone >= dailyTarget ? "c2-daily-done" : ""}`}>
            {dailyDone >= dailyTarget
              ? `${dailyDone} de ${dailyTarget} — objetivo cumplido`
              : `${dailyDone} de ${dailyTarget} llamadas hoy`}
          </p>
        )}
        <h1 className="c2-title">Nueva Llamada</h1>
        <p className="c2-subtitle">Pega la transcripción de tu llamada para analizarla</p>
      </div>

      <div className="c2-form">
        <div className="input-group">
          <label htmlFor="funnel-stage" className="input-label">
            Etapa del embudo <span style={{ fontWeight: 400, color: "var(--ink-light)" }}>(opcional — se detecta automáticamente)</span>
          </label>
          <select
            id="funnel-stage"
            className="input-field c2-select"
            value={selectedStage}
            onChange={(e) => { setSelectedStage(e.target.value); sessionStorage.setItem("c2_stage", e.target.value); }}
            disabled={status === "analyzing"}
          >
            <option value="">Detectar automáticamente</option>
            {funnelStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
          {missedFields.length > 0 && !transcription && rec.recMode === "off" && (
            <p className="c2-missed-tip">En tus últimas llamadas se te olvidó preguntar: {missedFields.join(", ")}</p>
          )}
        </div>

        <div className="input-group">
          <label htmlFor="fuente-lead" className="input-label">
            Fuente del lead *
          </label>
          <select
            id="fuente-lead"
            className="input-field c2-select"
            value={selectedSource}
            onChange={(e) => { setSelectedSource(e.target.value); sessionStorage.setItem("c2_source", e.target.value); }}
            disabled={status === "analyzing"}
          >
            <option value="">Selecciona de dónde vino el prospecto</option>
            {leadSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          {leadSources.length === 0 && !errorMsg && (
            <p className="c2-hint">
              No hay fuentes de lead configuradas. Tu gerente puede agregarlas en Configuración.
            </p>
          )}
        </div>

        <div className="input-group">
          <label htmlFor="prospect-phone" className="input-label">
            WhatsApp del prospecto <span style={{ fontWeight: 400, color: "var(--ink-light)" }}>(opcional)</span>
          </label>
          <input
            id="prospect-phone"
            type="tel"
            inputMode="tel"
            className="input-field"
            value={prospectPhone}
            onChange={(e) => { setProspectPhone(e.target.value); sessionStorage.setItem("c2_phone", e.target.value); }}
            placeholder="+52 55 1234 5678"
            disabled={status === "analyzing"}
            autoComplete="tel"
          />
          <p className="c2-hint">Si lo dejas vacío, lo detectamos automáticamente de la transcripción.</p>
        </div>

        <div className="input-group">
          <label htmlFor="transcription" className="input-label">
            Transcripción de la llamada *
          </label>
          <div
            className={`c2-drop-zone ${dragging ? "c2-drop-active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <textarea
              id="transcription"
              className="input-field c2-textarea"
              placeholder="Pega aquí la transcripción o arrastra un archivo de texto o audio"
              value={transcription}
              onChange={(e) => {
                if (e.target.value.length <= CHAR_LIMIT) {
                  handleTranscriptionChange(e.target.value);
                }
              }}
              disabled={status === "analyzing" || isTranscribing}
              rows={10}
            />
          </div>
          {transcriptionSource === "audio" && transcriptionOriginal && (
            <p className="c2-auto-banner">Transcripción automática — revisa antes de analizar</p>
          )}
          {editPct > 40 && (
            <p className="c2-edit-warning">Has editado una parte importante del texto ({editPct}%) — el análisis refleja tu versión.</p>
          )}
          <button
            className="c2-guide-link"
            onClick={openGuide}
            disabled={!selectedStage}
            type="button"
          >
            {selectedStage ? "Ver mi guía antes de llamar" : "Selecciona una etapa para ver tu guía"}
          </button>
          <div className="c2-file-row">
            <label className="c2-file-btn">
              Buscar archivo
              <input type="file" accept=".txt,.doc,.docx,.mp3,.m4a,.wav,.ogg,.opus,.webm,.mp4,audio/ogg,audio/opus" onChange={handleFileInput} hidden disabled={status === "analyzing" || isTranscribing} />
            </label>
            <button
              className="c2-rec-btn"
              onClick={() => orgId && rec.startRecording(orgId)}
              disabled={status === "analyzing" || isTranscribing || transcription.length > 0}
              type="button"
            >
              Grabar llamada
            </button>
            {fileMsg && <span className="c2-file-msg">{fileMsg}</span>}
          </div>
          <p className="c2-rec-hint">
            {mobile
              ? "Pon tu llamada en altavoz y presiona grabar."
              : "Selecciona la pestaña de tu llamada cuando se abra el selector."}
          </p>
          {rec.recError && <p className="c2-rec-error">{rec.recError}</p>}
          {isTranscribing && (
            <div className="c2-transcribing">
              <span className="c2-transcribing-spinner" />
              Transcribiendo audio...
            </div>
          )}
          <div className="c2-char-count">
            <span className={wordCount < MIN_WORDS ? "c2-char-warning" : ""}>
              {wordCount} palabras{wordCount < MIN_WORDS ? ` (mínimo ${MIN_WORDS})` : ""} · {charCount.toLocaleString()} / {CHAR_LIMIT.toLocaleString()} caracteres
            </span>
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="notes" className="input-label">
            Notas de contexto (opcional)
          </label>
          <textarea
            id="notes"
            className="input-field"
            placeholder="Ej: La grabación empezó al minuto 2, prospecto ya había hablado con otra captadora..."
            value={notes}
            onChange={(e) => { setNotes(e.target.value); sessionStorage.setItem("c2_notes", e.target.value); }}
            disabled={status === "analyzing"}
            rows={3}
            style={{ minHeight: 60, resize: "vertical" }}
          />
          <p className="c2-hint">Contexto adicional que ayude a interpretar mejor esta llamada.</p>
        </div>

        {status === "analyzing" && (
          <div className="c2-progress-section">
            <div className="c2-progress-bg">
              <div className="c2-progress-fill" style={{ width: `${analysisPct}%` }} />
            </div>
            <p className="c2-progress-phase">{analysisPhase}</p>
          </div>
        )}

        {errorMsg && (
          <div className="message-box message-error">
            <p>{errorMsg}</p>
            {status === "error" && (
              <button className="c2-retry-btn" onClick={handleRetry}>
                Reintentar
              </button>
            )}
          </div>
        )}

        {status !== "analyzing" && (
          <button
            className="btn-submit btn-terracota"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Analizar
          </button>
        )}
      </div>

      {/* Guide drawer */}
      {guideOpen && (
        <>
          <div className="c2-guide-backdrop" onClick={() => setGuideOpen(false)} />
          <div className="c2-guide-drawer">
            <div className="c2-guide-header">
              <span className="c2-guide-title">Tu guía de llamada</span>
              <button className="c2-guide-close" onClick={() => setGuideOpen(false)}>&times;</button>
            </div>
            <div className="c2-guide-body">
              {guideLoading && <p className="c2-guide-loading">Cargando guía...</p>}
              {!guideLoading && guidePhases.length === 0 && (
                <p className="c2-guide-empty">No hay guía disponible para esta etapa.</p>
              )}
              {guidePhases.map((phase, i) => (
                <div key={i} className="c2-guide-phase">
                  <h3 className="c5-phase-name">{phase.phase_name}</h3>
                  {phase.transition && <p className="c5-transition">{phase.transition}</p>}
                  {phase.fields && phase.fields.length > 0 ? (
                    <div className="c5-fields">
                      {phase.fields.map((field, j) => (
                        <GuideFieldItem key={j} field={field} />
                      ))}
                    </div>
                  ) : phase.phrases && phase.phrases.length > 0 ? (
                    <ul className="c5-phrase-list">
                      {phase.phrases.map((ph, j) => <li key={j} className="c5-phrase">{ph}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GuideFieldItem({ field }: { field: { field_name: string; phrases: string[] } }) {
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
