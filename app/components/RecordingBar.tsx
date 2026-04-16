"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRecording } from "../contexts/RecordingContext";

function formatTime(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Pages that handle recording internally — don't show bar, don't redirect
const RECORDING_PAGES = ["/analisis/nueva", "/grabar"];

export default function RecordingBar() {
  const {
    recMode, recElapsed, pauseRecording, resumeRecording, stopRecording,
    transcribePct, transcribePhase, transcriptionResult,
  } = useRecording();
  const pathname = usePathname();
  const router = useRouter();

  const isRecordingPage = RECORDING_PAGES.includes(pathname || "");
  const visible = recMode !== "off" && !isRecordingPage;

  useEffect(() => {
    if (visible) {
      document.body.classList.add("has-recording-bar");
    } else {
      document.body.classList.remove("has-recording-bar");
    }
    return () => { document.body.classList.remove("has-recording-bar"); };
  }, [visible]);

  // When transcription finishes on a non-recording page, redirect to the
  // recording page the user was on (default /analisis/nueva)
  useEffect(() => {
    if (!isRecordingPage && transcriptionResult && transcriptionResult.text) {
      router.push("/analisis/nueva");
    }
  }, [transcriptionResult, isRecordingPage, router]);

  if (!visible) return null;

  // Determine where "go back" should point
  const backHref = "/grabar";
  const backLabel = "Ir a grabacion";

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
        <button className="rb-link" onClick={() => router.push(backHref)}>
          {backLabel}
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
      <button className="rb-link" onClick={() => router.push(backHref)}>
        {backLabel}
      </button>
    </div>
  );
}
