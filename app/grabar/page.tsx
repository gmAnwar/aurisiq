"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { requireAuth } from "../../lib/auth";

type Stage = "idle" | "recording" | "transcribing" | "review" | "error";

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function GrabarPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcription, setTranscription] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [mobile, setMobile] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  useEffect(() => {
    setMobile(isMobile());
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

  // Waveform visualizer — works with any MediaStream (mic or display)
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

  // Start waveform after canvas is rendered
  useEffect(() => {
    if (stage === "recording" && analyserRef.current && canvasRef.current) {
      drawWaveform();
    }
  }, [stage, drawWaveform]);

  const setupAnalyser = (stream: MediaStream) => {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    audioCtxRef.current = audioCtx;
  };

  const setupRecorder = (stream: MediaStream) => {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/mp4";
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      analyserRef.current = null;
      audioCtxRef.current = null;

      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size < 1024) {
        setErrorMsg("La grabación es muy corta. Intenta de nuevo con una llamada más larga.");
        setStage("idle");
        return;
      }
      handleTranscription(blob);
    };

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    setStage("recording");
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
  };

  const startRecording = async () => {
    setErrorMsg("");
    setTranscription("");
    try {
      let stream: MediaStream;

      if (mobile) {
        // Mobile: microphone via getUserMedia
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        // Desktop: system audio via getDisplayMedia
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });

        // Remove video tracks — we only need audio
        stream.getVideoTracks().forEach(t => t.stop());

        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach(t => t.stop());
          setErrorMsg("No se seleccionó audio del sistema. Asegúrate de marcar \"Compartir audio\" en el popup del navegador.");
          return;
        }

        // Handle user stopping share from browser native UI
        stream.getAudioTracks()[0].onended = () => {
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
          }
        };
      }

      setupAnalyser(stream);
      setupRecorder(stream);
    } catch {
      setErrorMsg(
        mobile
          ? "No pudimos acceder al micrófono. Verifica los permisos de tu navegador."
          : "No pudimos capturar el audio del sistema. Verifica que tu navegador soporte compartir audio."
      );
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
          <p className="ear-subtitle">
            {mobile
              ? "Pon tu llamada en altavoz y graba desde aquí"
              : "Captura el audio de tu softphone o llamada en la computadora"}
          </p>
          <button className="ear-start-btn" onClick={startRecording}>
            <span className="ear-start-icon" />
            Iniciar grabación
          </button>
          {errorMsg && <p className="ear-error">{errorMsg}</p>}
          {mobile && (
            <a href="/analisis/nueva" className="ear-upload-link">
              ¿Ya tienes el audio grabado? Súbelo aquí
            </a>
          )}
        </div>
      )}

      {/* Recording state */}
      {stage === "recording" && (
        <div className="ear-recording">
          <div className="ear-rec-indicator">
            <span className="ear-rec-dot" />
            <span className="ear-rec-label">
              {mobile ? "Grabando con micrófono" : "Grabando audio del sistema"}
            </span>
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
      {stage === "review" && (() => {
        const wordCount = transcription.trim().split(/\s+/).filter(Boolean).length;
        const tooShort = wordCount < 50;
        return (
          <div className="ear-review">
            <h2 className="ear-review-title">Transcripción lista</h2>
            {tooShort ? (
              <p className="ear-error">La transcripción es muy corta para analizar ({wordCount} palabras, mínimo 50). Graba una llamada más larga.</p>
            ) : (
              <p className="ear-review-hint">Revisa el texto antes de analizar. Puedes editarlo en la siguiente pantalla.</p>
            )}
            <div className="ear-review-text">{transcription}</div>
            {!tooShort && (
              <button className="btn-submit btn-terracota" onClick={goToAnalysis} style={{ width: "100%", textAlign: "center" }}>
                Analizar esta llamada
              </button>
            )}
            <button className="ear-retry-btn" onClick={() => { setStage("idle"); setTranscription(""); }}>
              Grabar otra vez
            </button>
          </div>
        );
      })()}

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
