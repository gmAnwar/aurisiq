"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { WORKER_URL } from "../../lib/config";
import {
  checkBlobSize,
  isTranscribeFailure,
  outcomeForWorkerError,
  outcomeForWorkerText,
  TRANSCRIBE_MESSAGES,
  type TranscribeOutcome,
} from "../../lib/transcription-outcome";

type RecMode = "off" | "recording" | "paused" | "transcribing";

interface TranscriptionResult {
  text: string;
  original: string;
  message: string;
}

// Aviso persistente para el formulario de /analisis/nueva. `transcribePhase`
// no sirve para esto: solo se pinta mientras recMode === "transcribing" y ese
// modo se apaga en el mismo tick, así que el mensaje nunca se alcanzaba a ver.
export interface CaptureNotice {
  kind: "error" | "info";
  text: string;
}

interface RecordingContextType {
  recMode: RecMode;
  recElapsed: number;
  pauseCount: number;
  totalPausedSecs: number;
  recError: string;
  recLabel: string;

  transcribePct: number;
  transcribePhase: string;
  transcriptionResult: TranscriptionResult | null;
  clearTranscriptionResult: () => void;

  captureNotice: CaptureNotice | null;
  clearCaptureNotice: () => void;

  hasDraft: boolean;
  useDraft: (orgId: string) => Promise<void>;
  deleteDraft: () => Promise<void>;

  pendingOfflineCount: number;
  retryOffline: () => void;

  startRecording: (orgId: string) => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;

  analyserNode: AnalyserNode | null;
}

const RecordingContext = createContext<RecordingContextType | null>(null);

export function useRecording() {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error("useRecording must be used within RecordingProvider");
  return ctx;
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

const DB_NAME = "aurisiq_drafts";
const STORE_NAME = "recordings";
const OFFLINE_STORE = "offline_queue";

interface OfflineEntry {
  id: string;
  blob: Blob;
  orgId: string;
  elapsed: number;
  timestamp: number;
  status: "pending" | "uploading" | "error";
  attempts: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllOffline(): Promise<OfflineEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(OFFLINE_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror = () => { db.close(); resolve([]); };
    });
  } catch { return []; }
}

async function putOffline(entry: OfflineEntry) {
  try {
    const db = await openDB();
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).put(entry);
    db.close();
  } catch { /* ignore */ }
}

async function deleteOffline(id: string) {
  try {
    const db = await openDB();
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).delete(id);
    db.close();
  } catch { /* ignore */ }
}

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [recMode, setRecMode] = useState<RecMode>("off");
  const [recElapsed, setRecElapsed] = useState(0);
  const [recError, setRecError] = useState("");
  const [recLabel, setRecLabel] = useState("");
  const [pauseCount, setPauseCount] = useState(0);
  const [totalPausedSecs, setTotalPausedSecs] = useState(0);

  const [transcribePct, setTranscribePct] = useState(0);
  const [transcribePhase, setTranscribePhase] = useState("");
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [captureNotice, setCaptureNotice] = useState<CaptureNotice | null>(null);

  const [hasDraft, setHasDraft] = useState(false);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const processingOfflineRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const allStreamsRef = useRef<MediaStream[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const intentionalStopRef = useRef(false);
  const cancelledRef = useRef(false);
  const pauseStartRef = useRef<number>(0);
  const orgIdRef = useRef<string>("");
  const recElapsedRef = useRef(0);
  const transcribeProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm;codecs=opus");

  // Keep recElapsedRef in sync for use in onstop callback
  useEffect(() => { recElapsedRef.current = recElapsed; }, [recElapsed]);

  // ─── Wake Lock ─────────────────────────────────────────────
  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<WakeLockSentinel> } }).wakeLock.request("screen");
      }
    } catch { /* ignore */ }
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  };

  // ─── IndexedDB Draft ──────────────────────────────────────
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

  // Check for drafts + offline queue on mount
  useEffect(() => {
    (async () => {
      const draft = await loadDraft();
      if (draft && draft.size > 1024) setHasDraft(true);
      const offline = await getAllOffline();
      setPendingOfflineCount(offline.filter(e => e.status !== "uploading").length);
    })();
  }, []);

  // ─── Offline queue processing ─────────────────────────────
  const processOfflineQueue = useCallback(async () => {
    if (processingOfflineRef.current) return;
    processingOfflineRef.current = true;

    try {
      const entries = await getAllOffline();
      const pending = entries.filter(e => e.status === "pending" || e.status === "error");
      for (const entry of pending) {
        if (!navigator.onLine) break;
        entry.status = "uploading";
        entry.attempts += 1;
        await putOffline(entry);

        const result = await transcribeAudioBlob(entry.blob, entry.elapsed, entry.orgId);
        // Adaptación al outcome tipado — la semántica de reintentos de la cola
        // queda idéntica (3 intentos y luego 'error').
        if (result.ok) {
          await deleteOffline(entry.id);
          setTranscriptionResult({ text: result.text, original: result.original, message: result.message });
          sessionStorage.setItem("c2_transcription", result.text);
          sessionStorage.setItem("c2_original", result.original);
          sessionStorage.setItem("c2_source_type", "audio");
        } else {
          entry.status = entry.attempts >= 3 ? "error" : "pending";
          await putOffline(entry);
        }
      }
    } catch { /* ignore */ }

    processingOfflineRef.current = false;
    const remaining = await getAllOffline();
    setPendingOfflineCount(remaining.filter(e => e.status !== "uploading").length);
  }, []);

  // Listen for connectivity recovery
  useEffect(() => {
    const handler = () => { processOfflineQueue(); };
    window.addEventListener("online", handler);
    // Also try on mount in case we're already online with pending items
    if (navigator.onLine) processOfflineQueue();
    return () => { window.removeEventListener("online", handler); };
  }, [processOfflineQueue]);

  const retryOffline = useCallback(() => {
    // Reset error entries to pending so processOfflineQueue picks them up
    (async () => {
      const entries = await getAllOffline();
      for (const e of entries) {
        if (e.status === "error") {
          e.status = "pending";
          e.attempts = 0;
          await putOffline(e);
        }
      }
      setPendingOfflineCount(entries.length);
      processOfflineQueue();
    })();
  }, [processOfflineQueue]);

  // ─── Transcription ────────────────────────────────────────
  // Devuelve un outcome tipado, nunca `null`. Cada rama de fallo trae su
  // userMessage en es-MX; la decisión de qué mensaje corresponde vive en
  // lib/transcription-outcome.ts (probado en Deno).
  const transcribeAudioBlob = async (blob: Blob, elapsed: number, orgId: string): Promise<TranscribeOutcome> => {
    const sizeFailure = checkBlobSize(blob.size);
    if (sizeFailure) return sizeFailure;

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
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        return outcomeForWorkerError(res.status, (data as { error?: string }).error || "");
      }

      return outcomeForWorkerText((data as { text?: string }).text, elapsed);
    } catch {
      // Red caída, DNS, CORS, FileReader reventado. Antes esto era el
      // `return null` que se comía el fallo entero.
      return { ok: false, userMessage: TRANSCRIBE_MESSAGES.network };
    }
  };

  // ─── Save draft on browser close ──────────────────────────
  useEffect(() => {
    const handleUnload = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive" && chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        if (blob.size > 1024) {
          // Synchronous save attempt via sync IDB (best effort)
          try {
            const req = indexedDB.open(DB_NAME, 1);
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction(STORE_NAME, "readwrite");
              tx.objectStore(STORE_NAME).put(blob, "draft");
            };
          } catch { /* best effort */ }
        }
      }
    };

    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  // ─── Cleanup on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (transcribeProgressRef.current) clearInterval(transcribeProgressRef.current);
      releaseWakeLock();
    };
  }, []);

  // ─── Pause / Resume ───────────────────────────────────────
  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      pauseStartRef.current = Date.now();
      setPauseCount(c => c + 1);
      setRecMode("paused");
      releaseWakeLock();
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      const pausedMs = Date.now() - pauseStartRef.current;
      setTotalPausedSecs(t => t + Math.round(pausedMs / 1000));
      recTimerRef.current = setInterval(() => setRecElapsed(p => p + 1), 1000);
      setRecMode("recording");
      acquireWakeLock();
    }
  }, []);

  // ─── Start Recording ──────────────────────────────────────
  const startRecording = useCallback(async (orgId: string) => {
    setRecError("");
    // Grabar de nuevo es la forma de "cerrar" el aviso del intento anterior.
    setCaptureNotice(null);
    cancelledRef.current = false;
    orgIdRef.current = orgId;
    allStreamsRef.current = [];

    try {
      let recordStream: MediaStream;
      let label = "";
      const mobile = isMobile();

      if (mobile) {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        allStreamsRef.current.push(micStream);
        recordStream = micStream;
        label = "Grabando...";
      } else {
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
          const audioCtx = new AudioContext();
          const micSource = audioCtx.createMediaStreamSource(micStream);
          const displaySource = audioCtx.createMediaStreamSource(displayStream);
          const destination = audioCtx.createMediaStreamDestination();
          micSource.connect(destination);
          displaySource.connect(destination);
          audioCtxRef.current = audioCtx;
          recordStream = destination.stream;
          label = "Grabando...";

          displayStream.getAudioTracks()[0].onended = () => {
            if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
          };
        } else {
          setRecError("Grabación activa");
          recordStream = micStream;
          label = "Grabando...";
        }
      }

      setRecLabel(label);

      // Analyser
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const analyserSource = audioCtxRef.current.createMediaStreamSource(recordStream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserSource.connect(analyser);
      analyserRef.current = analyser;
      setAnalyserNode(analyser);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/mp4";
      mimeTypeRef.current = mimeType;
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
        analyserRef.current = null;
        audioCtxRef.current = null;
        setAnalyserNode(null);
        releaseWakeLock();

        const blob = new Blob(chunksRef.current, { type: mimeType });

        // If not intentional stop (e.g. display share ended), save as draft
        if (!intentionalStopRef.current && blob.size > 1024) {
          saveDraft(blob);
          setHasDraft(true);
          setRecMode("off");
          setRecElapsed(0);
          return;
        }
        intentionalStopRef.current = false;

        // If cancelled, discard audio — don't transcribe
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setRecMode("off");
          setRecElapsed(0);
          return;
        }

        const elapsed = recElapsedRef.current;
        const currentOrgId = orgIdRef.current;

        // If offline, save to IndexedDB queue and exit early
        if (!navigator.onLine) {
          const entry: OfflineEntry = {
            id: `rec_${Date.now()}`,
            blob,
            orgId: currentOrgId,
            elapsed,
            timestamp: Date.now(),
            status: "pending",
            attempts: 0,
          };
          putOffline(entry).then(() => {
            getAllOffline().then(all => setPendingOfflineCount(all.length));
          });
          // Va al banner del formulario, no a transcribePhase: ese texto solo
          // se pinta con recMode === "transcribing" y la línea de abajo apaga
          // ese modo en el mismo tick, así que nunca se veía.
          setCaptureNotice({ kind: "info", text: TRANSCRIBE_MESSAGES.offlineQueued });
          setRecMode("off");
          setRecElapsed(0);
          return;
        }

        // Start transcription (online)
        setRecMode("transcribing");
        setTranscribePct(0);
        setTranscribePhase("Procesando audio...");

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

        transcribeAudioBlob(blob, elapsed, currentOrgId).then((outcome) => {
          if (transcribeProgressRef.current) clearInterval(transcribeProgressRef.current);

          // Incidente 2026-08-20: pct=100 y "Transcripción lista" se seteaban
          // ANTES de mirar el resultado. Un fallo terminaba con la barra llena,
          // el textarea vacío y cero explicación. Ahora el estado de éxito solo
          // se pinta cuando hay texto.
          if (isTranscribeFailure(outcome)) {
            setCaptureNotice({ kind: "error", text: outcome.userMessage });
            setRecMode("off");
            return;
          }

          setTranscribePct(100);
          setTranscribePhase("Transcripción lista");
          setCaptureNotice(null);
          setTranscriptionResult({ text: outcome.text, original: outcome.original, message: outcome.message });
          sessionStorage.setItem("c2_transcription", outcome.text);
          sessionStorage.setItem("c2_original", outcome.original);
          sessionStorage.setItem("c2_source_type", "audio");

          setTimeout(() => setRecMode("off"), 400);
        });
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecMode("recording");
      setRecElapsed(0);
      setPauseCount(0);
      setTotalPausedSecs(0);
      setTranscriptionResult(null);
      recTimerRef.current = setInterval(() => setRecElapsed(p => p + 1), 1000);
      acquireWakeLock();
    } catch {
      setRecError("No pudimos acceder al micrófono. Verifica los permisos de tu navegador.");
    }
  }, []);

  // ─── Stop Recording ───────────────────────────────────────
  const stopRecording = useCallback(() => {
    intentionalStopRef.current = true;
    const state = mediaRecorderRef.current?.state;
    if (state === "recording" || state === "paused") {
      if (state === "paused") mediaRecorderRef.current!.resume();
      mediaRecorderRef.current!.stop();
    }
  }, []);

  // ─── Cancel Recording ─────────────────────────────────────
  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    intentionalStopRef.current = true;
    const state = mediaRecorderRef.current?.state;
    if (state === "recording" || state === "paused") {
      if (state === "paused") mediaRecorderRef.current!.resume();
      mediaRecorderRef.current!.stop();
    }
    allStreamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    allStreamsRef.current = [];
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    analyserRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setAnalyserNode(null);
    setRecMode("off");
    setRecElapsed(0);
    setRecError("");
  }, []);

  // ─── Use Draft ────────────────────────────────────────────
  const useDraftFn = useCallback(async (orgId: string) => {
    const draft = await loadDraft();
    if (draft) {
      await deleteDraft();
      setCaptureNotice(null);
      setRecMode("transcribing");
      setTranscribePct(0);
      setTranscribePhase("Transcribiendo grabación pendiente...");

      const tStart = Date.now();
      transcribeProgressRef.current = setInterval(() => {
        const el = (Date.now() - tStart) / 1000;
        const p = Math.min(94, Math.floor(el * 0.8));
        setTranscribePct(p);
      }, 500);

      const outcome = await transcribeAudioBlob(draft, 0, orgId);
      if (transcribeProgressRef.current) clearInterval(transcribeProgressRef.current);

      // Mismo trato que el camino de grabación: sin texto no se anuncia "lista".
      if (isTranscribeFailure(outcome)) {
        setCaptureNotice({ kind: "error", text: outcome.userMessage });
        setRecMode("off");
        return;
      }

      setTranscribePct(100);
      setTranscribePhase("Transcripción lista");
      setTranscriptionResult({ text: outcome.text, original: outcome.original, message: outcome.message });
      sessionStorage.setItem("c2_transcription", outcome.text);
      sessionStorage.setItem("c2_original", outcome.original);
      sessionStorage.setItem("c2_source_type", "audio");

      setTimeout(() => setRecMode("off"), 400);
    }
  }, []);

  const clearTranscriptionResult = useCallback(() => {
    setTranscriptionResult(null);
  }, []);

  const clearCaptureNotice = useCallback(() => {
    setCaptureNotice(null);
  }, []);

  return (
    <RecordingContext.Provider value={{
      recMode, recElapsed, pauseCount, totalPausedSecs, recError, recLabel,
      transcribePct, transcribePhase, transcriptionResult, clearTranscriptionResult,
      captureNotice, clearCaptureNotice,
      hasDraft, useDraft: useDraftFn, deleteDraft,
      pendingOfflineCount, retryOffline,
      startRecording, stopRecording, cancelRecording, pauseRecording, resumeRecording,
      analyserNode,
    }}>
      {children}
    </RecordingContext.Provider>
  );
}
