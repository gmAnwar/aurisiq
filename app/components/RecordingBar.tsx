"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRecording } from "../contexts/RecordingContext";

function formatTime(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function RecordingBar() {
  const {
    recMode, recElapsed, pauseRecording, resumeRecording, stopRecording,
    transcribePct, transcribePhase,
  } = useRecording();
  const pathname = usePathname();
  const router = useRouter();

  const isOnC2 = pathname === "/analisis/nueva";
  const visible = recMode !== "off" && !isOnC2;

  // Add/remove body class for layout padding
  useEffect(() => {
    if (visible) {
      document.body.classList.add("has-recording-bar");
    } else {
      document.body.classList.remove("has-recording-bar");
    }
    return () => { document.body.classList.remove("has-recording-bar"); };
  }, [visible]);

  if (!visible) return null;

  if (recMode === "transcribing") {
    return (
      <div className="recording-bar">
        <span className="rb-dot" style={{ animationDuration: "2s" }} />
        <span className="rb-text">Procesando...</span>
        <span className="rb-timer">{formatTime(recElapsed)}</span>
        <div className="rb-progress">
          <div className="rb-progress-fill" style={{ width: `${transcribePct}%` }} />
        </div>
        <span className="rb-phase">{transcribePhase}</span>
        <button className="rb-link" onClick={() => router.push("/analisis/nueva")}>
          Volver a llamada
        </button>
      </div>
    );
  }

  return (
    <div className="recording-bar">
      <span className="rb-dot" style={recMode === "paused" ? { animation: "none", opacity: 0.3 } : undefined} />
      <span className="rb-text">{recMode === "paused" ? "En pausa" : "Grabando..."}</span>
      <span className="rb-timer">{formatTime(recElapsed)}</span>
      <div className="rb-controls">
        {recMode === "recording" ? (
          <button className="rb-btn rb-btn-pause" onClick={pauseRecording}>Pausar</button>
        ) : (
          <button className="rb-btn rb-btn-resume" onClick={resumeRecording}>Continuar</button>
        )}
        <button className="rb-btn rb-btn-stop" onClick={stopRecording}>Terminar</button>
      </div>
      <button className="rb-link" onClick={() => router.push("/analisis/nueva")}>
        Volver a llamada
      </button>
    </div>
  );
}
