"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { computeEditPercentage } from "../../../lib/text";

interface LeadSource {
  id: string;
  name: string;
}

type Status = "idle" | "analyzing" | "error";
type RecMode = "off" | "recording" | "paused" | "transcribing";

interface FunnelStage {
  id: string;
  name: string;
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function NuevaLlamadaPage() {
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
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

  // Inline recording state
  const [recMode, setRecMode] = useState<RecMode>("off");
  const [recElapsed, setRecElapsed] = useState(0);
  const [recError, setRecError] = useState("");
  const [recLabel, setRecLabel] = useState("");
  const [mobile, setMobile] = useState(false);
  const [analysisPct, setAnalysisPct] = useState(0);
  const [analysisPhase, setAnalysisPhase] = useState("");
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [transcribePct, setTranscribePct] = useState(0);
  const [transcribePhase, setTranscribePhase] = useState("");
  const transcribeProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pauseCount, setPauseCount] = useState(0);
  const [totalPausedSecs, setTotalPausedSecs] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const pauseStartRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const allStreamsRef = useRef<MediaStream[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const intentionalStopRef = useRef(false);

  const wordCount = transcription.trim().split(/\s+/).filter(Boolean).length;
  const MIN_WORDS = transcriptionSource === "audio" ? 50 : 200;

  const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".ogg", ".webm", ".mp4"];
  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  const transcribeAudioBlob = async (blob: Blob, label?: string) => {
    if (blob.size < 1024) {
      setFileMsg("La grabación es muy corta. Intenta con un audio más largo.");
      return;
    }
    if (blob.size > 10 * 1024 * 1024) {
      setFileMsg("El audio excede 10MB. Intenta con un archivo más corto.");
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
      if (!res.ok) throw new Error(data.error || "Error al transcribir");
      setTranscription(data.text);
      setTranscriptionOriginal(data.text);
      setTranscriptionSource("audio");
      setEditPct(0);
      setFileMsg("Transcripción automática lista — revisa antes de analizar.");
      sessionStorage.setItem("c2_transcription", data.text);
      sessionStorage.setItem("c2_original", data.text);
      sessionStorage.setItem("c2_source_type", "audio");
    } catch (err) {
      setFileMsg(err instanceof Error ? err.message : "Error al transcribir el audio.");
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
  const canSubmit = selectedSource !== "" && selectedStage !== "" && wordCount >= MIN_WORDS && status === "idle" && !isTranscribing;
  const charCount = transcription.length;
  const CHAR_LIMIT = 15000;

  useEffect(() => {
    setMobile(isMobile());
    async function init() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      setUserId(session.userId);
      setOrgId(session.organizationId);

      const [sourcesRes, stagesRes] = await Promise.all([
        supabase.from("lead_sources").select("id, name")
          .eq("organization_id", session.organizationId).eq("active", true).order("name"),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", session.organizationId).order("order_index"),
      ]);

      const { data: sources, error } = sourcesRes;
      setFunnelStages(stagesRes.data || []);

      if (error) {
        setErrorMsg("No pudimos cargar las fuentes de lead. Intenta de nuevo.");
      } else {
        setLeadSources(sources || []);
      }

      setLoading(false);

      // Restore draft from sessionStorage
      const savedText = sessionStorage.getItem("c2_transcription");
      const savedStage = sessionStorage.getItem("c2_stage");
      const savedSource = sessionStorage.getItem("c2_source");
      const savedNotes = sessionStorage.getItem("c2_notes");
      const savedOriginal = sessionStorage.getItem("c2_original");
      const savedSrc = sessionStorage.getItem("c2_source_type");
      if (savedText) setTranscription(savedText);
      if (savedStage) setSelectedStage(savedStage);
      if (savedSource) setSelectedSource(savedSource);
      if (savedNotes) setNotes(savedNotes);
      if (savedOriginal) {
        setTranscriptionOriginal(savedOriginal);
        setTranscriptionSource((savedSrc as "manual" | "audio") || "manual");
      }
    }

    // Check for draft recording in IndexedDB
    checkDraft();

    init();
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (transcribeProgressRef.current) clearInterval(transcribeProgressRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      releaseWakeLock();
      // Save draft if recording is active on unmount
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop(); // triggers onstop which saves chunks
      }
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

  // ─── Inline recording ──────────────────────────────────────

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
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
  }, []);

  useEffect(() => {
    if (recMode === "recording" && analyserRef.current && canvasRef.current) {
      drawWaveform();
    }
  }, [recMode, drawWaveform]);

  // ─── Wake Lock ──────────────────────────────────────────────
  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<WakeLockSentinel> } }).wakeLock.request("screen");
      }
    } catch { /* ignore — not supported or denied */ }
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  };

  // ─── IndexedDB Draft ───────────────────────────────────────
  const DB_NAME = "aurisiq_drafts";
  const STORE_NAME = "recordings";

  const openDB = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const saveDraft = async (blob: Blob) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, "draft");
      db.close();
    } catch { /* ignore */ }
  };

  const loadDraft = async (): Promise<Blob | null> => {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get("draft");
        req.onsuccess = () => { db.close(); resolve(req.result || null); };
        req.onerror = () => { db.close(); resolve(null); };
      });
    } catch { return null; }
  };

  const deleteDraft = async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete("draft");
      db.close();
      setHasDraft(false);
    } catch { /* ignore */ }
  };

  const checkDraft = async () => {
    const draft = await loadDraft();
    if (draft && draft.size > 1024) setHasDraft(true);
  };

  const useDraft = async () => {
    const draft = await loadDraft();
    if (draft) {
      await deleteDraft();
      await transcribeAudioBlob(draft, "Transcribiendo grabación pendiente...");
    }
  };

  // ─── Pause / Resume ────────────────────────────────────────
  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      pauseStartRef.current = Date.now();
      setPauseCount(c => c + 1);
      setRecMode("paused");
      releaseWakeLock();
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      const pausedMs = Date.now() - pauseStartRef.current;
      setTotalPausedSecs(t => t + Math.round(pausedMs / 1000));
      recTimerRef.current = setInterval(() => setRecElapsed(p => p + 1), 1000);
      setRecMode("recording");
      drawWaveform();
      acquireWakeLock();
    }
  };

  const startRecording = async () => {
    setRecError("");
    allStreamsRef.current = [];
    try {
      let recordStream: MediaStream;
      let label = "";

      if (mobile) {
        // Mobile: microphone only
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        allStreamsRef.current.push(micStream);
        recordStream = micStream;
        label = "Grabando...";
      } else {
        // Desktop: combine microphone + system audio
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        allStreamsRef.current.push(micStream);

        let displayStream: MediaStream | null = null;
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          displayStream.getVideoTracks().forEach(t => t.stop());
          if (displayStream.getAudioTracks().length === 0) {
            displayStream.getTracks().forEach(t => t.stop());
            displayStream = null;
          }
        } catch {
          displayStream = null;
        }

        if (displayStream) {
          allStreamsRef.current.push(displayStream);
          // Combine both streams via AudioContext
          const audioCtx = new AudioContext();
          const micSource = audioCtx.createMediaStreamSource(micStream);
          const displaySource = audioCtx.createMediaStreamSource(displayStream);
          const destination = audioCtx.createMediaStreamDestination();
          micSource.connect(destination);
          displaySource.connect(destination);
          audioCtxRef.current = audioCtx;
          recordStream = destination.stream;
          label = "Grabando...";

          // Stop recording if user ends display share
          displayStream.getAudioTracks()[0].onended = () => {
            if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
          };
        } else {
          // Fallback: microphone only
          setRecError("Grabación activa");
          recordStream = micStream;
          label = "Grabando...";
        }
      }

      setRecLabel(label);

      // Set up analyser on the stream that goes to the recorder
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const analyserSource = audioCtxRef.current.createMediaStreamSource(recordStream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserSource.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/mp4";
      const recorder = new MediaRecorder(recordStream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        allStreamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
        allStreamsRef.current = [];
        audioCtxRef.current?.close();
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        analyserRef.current = null;
        audioCtxRef.current = null;
        releaseWakeLock();
        const blob = new Blob(chunksRef.current, { type: mimeType });

        // If page unmount (not intentional stop), save as draft
        if (!intentionalStopRef.current && blob.size > 1024) {
          saveDraft(blob);
          return;
        }
        intentionalStopRef.current = false;

        setRecMode("transcribing");
        setTranscribePct(0);
        setTranscribePhase("Procesando audio...");

        // Simulated transcription progress
        const tPhases = [
          { at: 0, text: "Procesando audio..." },
          { at: 20, text: "Transcribiendo conversación..." },
          { at: 50, text: "Identificando participantes..." },
          { at: 80, text: "Finalizando texto..." },
          { at: 95, text: "Transcripción lista" },
        ];
        const tStart = Date.now();
        transcribeProgressRef.current = setInterval(() => {
          const el = (Date.now() - tStart) / 1000;
          const p = Math.min(94, Math.floor(el * 0.8));
          const cur = [...tPhases].reverse().find(ph => p >= ph.at);
          if (cur) setTranscribePhase(cur.text);
          setTranscribePct(p);
        }, 500);

        transcribeAudioBlob(blob, "Transcribiendo grabación...").then(() => {
          if (transcribeProgressRef.current) clearInterval(transcribeProgressRef.current);
          setTranscribePct(100);
          setTranscribePhase("Transcripción lista");
          setTimeout(() => setRecMode("off"), 400);
        });
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecMode("recording");
      setRecElapsed(0);
      setPauseCount(0);
      setTotalPausedSecs(0);
      recTimerRef.current = setInterval(() => setRecElapsed(p => p + 1), 1000);
      acquireWakeLock();
    } catch {
      setRecError("No pudimos acceder al micrófono. Verifica los permisos de tu navegador.");
    }
  };

  const stopRecording = () => {
    intentionalStopRef.current = true;
    const state = mediaRecorderRef.current?.state;
    if (state === "recording" || state === "paused") {
      if (state === "paused") mediaRecorderRef.current!.resume(); // must resume before stop
      mediaRecorderRef.current!.stop();
    }
  };

  const cancelRecording = () => {
    intentionalStopRef.current = true;
    const state = mediaRecorderRef.current?.state;
    if (state === "recording" || state === "paused") {
      if (state === "paused") mediaRecorderRef.current!.resume();
      mediaRecorderRef.current!.stop();
    }
    allStreamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    allStreamsRef.current = [];
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setRecMode("off");
    setRecElapsed(0);
    setRecError("");
  };

  // ─── Submit ────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit || !userId || !orgId) return;

    setStatus("analyzing");
    setErrorMsg("");
    setAnalysisPct(0);
    setAnalysisPhase("Enviando transcripción...");

    // Simulated progress bar
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
      // Advance ~1% per second up to 94%, then hold
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
          funnel_stage_id: selectedStage,
          transcription_original: transcriptionOriginal,
          transcription_edited: transcriptionSource === "audio" && transcriptionOriginal && transcription.trim() !== transcriptionOriginal
            ? transcription.trim() : null,
          edit_percentage: transcriptionOriginal && transcription.trim() !== transcriptionOriginal
            ? editPct : 0,
          has_audio: transcriptionSource === "audio",
          pause_count: pauseCount,
          total_paused_seconds: totalPausedSecs,
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
            setTimeout(() => {
              sessionStorage.removeItem("c2_transcription");
              sessionStorage.removeItem("c2_stage");
              sessionStorage.removeItem("c2_source");
              sessionStorage.removeItem("c2_notes");
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

  if (recMode !== "off") {
    return (
      <div className="container ear-container">
        {(recMode === "recording" || recMode === "paused") && (
          <div className="ear-recording">
            <div className="ear-rec-indicator">
              <span className="ear-rec-dot" style={recMode === "paused" ? { animation: "none", opacity: 0.3 } : undefined} />
              <span className="ear-rec-label">{recMode === "paused" ? "En pausa" : recLabel}</span>
            </div>
            <span className="ear-timer">{formatTime(recElapsed)}</span>
            <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
            {pauseCount > 0 && (
              <span className="ear-pause-info">{pauseCount} pausa{pauseCount > 1 ? "s" : ""}</span>
            )}
            <div className="ear-btn-row">
              {recMode === "recording" ? (
                <button className="ear-pause-btn" onClick={pauseRecording}>Pausar</button>
              ) : (
                <button className="ear-resume-btn" onClick={resumeRecording}>Continuar</button>
              )}
              <button className="ear-stop-btn" onClick={stopRecording}>
                Terminar llamada
              </button>
            </div>
            <button className="ear-retry-btn" onClick={cancelRecording}>
              Cancelar
            </button>
          </div>
        )}
        {recMode === "transcribing" && (
          <div className="ear-recording">
            <div className="ear-rec-indicator">
              <span className="ear-rec-dot" style={{ animationDuration: "2s" }} />
              <span className="ear-rec-label">Procesando</span>
            </div>
            <span className="ear-timer">{formatTime(recElapsed)}</span>
            <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
            <div className="c2-progress-section" style={{ width: "100%", maxWidth: 320 }}>
              <div className="c2-progress-bg">
                <div className="c2-progress-fill" style={{ width: `${transcribePct}%` }} />
              </div>
              <p className="c2-progress-phase">{transcribePhase}</p>
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
      {hasDraft && (
        <div className="c2-draft-banner">
          <p className="c2-draft-text">Tienes una grabación pendiente</p>
          <div className="c2-draft-actions">
            <button className="c2-draft-btn c2-draft-use" onClick={useDraft}>Transcribir</button>
            <button className="c2-draft-btn c2-draft-discard" onClick={deleteDraft}>Descartar</button>
          </div>
        </div>
      )}

      <div className="c2-header">
        <h1 className="c2-title">Nueva Llamada</h1>
        <p className="c2-subtitle">Pega la transcripción de tu llamada para analizarla</p>
      </div>

      <div className="c2-form">
        <div className="input-group">
          <label htmlFor="funnel-stage" className="input-label">
            Etapa del embudo *
          </label>
          <select
            id="funnel-stage"
            className="input-field c2-select"
            value={selectedStage}
            onChange={(e) => { setSelectedStage(e.target.value); sessionStorage.setItem("c2_stage", e.target.value); }}
            disabled={status === "analyzing"}
          >
            <option value="">Selecciona la etapa</option>
            {funnelStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
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
              placeholder="Pega aquí la transcripción o arrastra un archivo .txt / .docx..."
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
          <div className="c2-file-row">
            <label className="c2-file-btn">
              Buscar archivo
              <input type="file" accept=".txt,.doc,.docx,.mp3,.m4a,.wav,.ogg,.webm,.mp4" onChange={handleFileInput} hidden disabled={status === "analyzing" || isTranscribing} />
            </label>
            <button
              className="c2-rec-btn"
              onClick={startRecording}
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
          {recError && <p className="c2-rec-error">{recError}</p>}
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
    </div>
  );
}
