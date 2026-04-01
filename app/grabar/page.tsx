"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { requireAuth } from "../../lib/auth";

type Stage = "idle" | "recording" | "transcribing" | "review" | "error";

export default function GrabarPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcription, setTranscription] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  useEffect(() => {
    async function init() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setOrgId(session.organizationId);
      setAuthed(true);
    }
    init();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Waveform visualizer
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

  const startRecording = async () => {
    setErrorMsg("");
    setTranscription("");
    try {
      // getDisplayMedia requires video: true in most browsers — we request it and discard it
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });

      // Immediately stop video tracks — we only need audio
      stream.getVideoTracks().forEach(t => t.stop());

      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach(t => t.stop());
        setErrorMsg("No se seleccionó audio del sistema. Asegúrate de marcar \"Compartir audio\" en el popup del navegador.");
        return;
      }

      // Set up audio analyser for waveform
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        if (timerRef.current) clearInterval(timerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        analyserRef.current = null;

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 1024) {
          setErrorMsg("La grabación es muy corta. Intenta de nuevo con una llamada más larga.");
          setStage("idle");
          return;
        }
        handleTranscription(blob);
      };

      // Handle user stopping share from browser native UI
      stream.getAudioTracks()[0].onended = () => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setStage("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
      drawWaveform();
    } catch {
      setErrorMsg("No pudimos capturar el audio del sistema. Verifica que tu navegador soporte compartir audio.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleTranscription = async (blob: Blob) => {
    setStage("transcribing");
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
      setStage("review");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error al transcribir el audio.");
      setStage("error");
    }
  };

  const goToAnalysis = () => {
    // Store transcription in sessionStorage for C2 to pick up
    sessionStorage.setItem("aurisiq_recorded_transcription", transcription);
    window.location.href = "/analisis/nueva?source=recording";
  };

  if (!authed) {
    return (
      <div className="container ear-container">
        <div className="skeleton-block skeleton-title" />
      </div>
    );
  }

  return (
    <div className="container ear-container">
      {/* Idle state */}
      {stage === "idle" && (
        <div className="ear-idle">
          <h1 className="ear-title">Grabar Llamada</h1>
          <p className="ear-subtitle">Captura el audio de tu softphone, Zoom o cualquier app de llamadas</p>
          <button className="ear-start-btn" onClick={startRecording}>
            <span className="ear-start-icon" />
            Iniciar grabación
          </button>
          {errorMsg && <p className="ear-error">{errorMsg}</p>}
        </div>
      )}

      {/* Recording state */}
      {stage === "recording" && (
        <div className="ear-recording">
          <div className="ear-rec-indicator">
            <span className="ear-rec-dot" />
            <span className="ear-rec-label">Grabando audio del sistema</span>
          </div>
          <span className="ear-timer">{formatTime(elapsed)}</span>
          <canvas ref={canvasRef} className="ear-waveform" width={280} height={60} />
          <button className="ear-stop-btn" onClick={stopRecording}>
            Terminar llamada
          </button>
        </div>
      )}

      {/* Transcribing state */}
      {stage === "transcribing" && (
        <div className="ear-transcribing">
          <span className="ear-spinner" />
          <p className="ear-transcribing-text">Transcribiendo tu llamada...</p>
          <p className="ear-transcribing-sub">Esto puede tomar hasta 2 minutos</p>
        </div>
      )}

      {/* Review state */}
      {stage === "review" && (
        <div className="ear-review">
          <h2 className="ear-review-title">Transcripción lista</h2>
          <p className="ear-review-hint">Revisa el texto antes de analizar. Puedes editarlo en la siguiente pantalla.</p>
          <div className="ear-review-text">{transcription}</div>
          <button className="btn-submit btn-terracota" onClick={goToAnalysis} style={{ width: "100%", textAlign: "center" }}>
            Analizar esta llamada
          </button>
          <button className="ear-retry-btn" onClick={() => { setStage("idle"); setTranscription(""); }}>
            Grabar otra vez
          </button>
        </div>
      )}

      {/* Error state */}
      {stage === "error" && (
        <div className="ear-idle">
          <p className="ear-error">{errorMsg}</p>
          <button className="ear-start-btn" onClick={() => { setStage("idle"); setErrorMsg(""); }}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
