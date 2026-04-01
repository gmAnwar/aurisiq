"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
  disabled: boolean;
}

export default function AudioRecorder({ onRecordingComplete, disabled }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const startRecording = useCallback(async () => {
    setError("");
    try {
      // getDisplayMedia captures system audio (softphone, Zoom, etc.)
      // The browser shows a native picker to select what to share
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onRecordingComplete(blob);
        setRecording(false);
        setElapsed(0);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000);
    } catch {
      setError("No pudimos acceder al micrófono. Verifica los permisos de tu navegador.");
    }
  }, [onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  if (recording) {
    return (
      <div className="c2-recorder c2-recorder-active">
        <span className="c2-rec-dot" />
        <span className="c2-rec-timer">Grabando... {formatTime(elapsed)}</span>
        <button className="c2-rec-stop" onClick={stopRecording} type="button">
          Detener
        </button>
      </div>
    );
  }

  return (
    <div className="c2-recorder">
      <button
        className="c2-rec-btn"
        onClick={startRecording}
        disabled={disabled}
        type="button"
      >
        Grabar llamada
      </button>
      {error && <p className="c2-rec-error">{error}</p>}
    </div>
  );
}
