"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { computeEditPercentage } from "../../../lib/text";
import AudioRecorder from "./AudioRecorder";

interface LeadSource {
  id: string;
  name: string;
}

type Status = "idle" | "analyzing" | "error";

interface FunnelStage {
  id: string;
  name: string;
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

  const wordCount = transcription.trim().split(/\s+/).filter(Boolean).length;
  const MIN_WORDS = 200;

  const extractTextFromFile = async (file: File) => {
    setFileMsg("");
    const name = file.name.toLowerCase();
    if (name.endsWith(".txt")) {
      const text = await file.text();
      if (text.length > CHAR_LIMIT) {
        setFileMsg(`El archivo tiene ${text.length.toLocaleString()} caracteres (máximo ${CHAR_LIMIT.toLocaleString()}).`);
        return;
      }
      setTranscription(text);
      setFileMsg(`Archivo "${file.name}" cargado.`);
    } else if (name.endsWith(".doc") || name.endsWith(".docx")) {
      // For .doc/.docx, extract raw text from the binary by stripping XML tags
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
      setFileMsg("Formato no soportado. Usa .txt, .doc o .docx.");
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
  const canSubmit = selectedSource !== "" && selectedStage !== "" && wordCount >= MIN_WORDS && status === "idle";
  const charCount = transcription.length;
  const CHAR_LIMIT = 15000;

  useEffect(() => {
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
    }

    init();
  }, []);

  const WORKER_URL = "https://aurisiq-worker.anwarhsg.workers.dev";

  const handleRecordingComplete = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    setErrorMsg("");
    setFileMsg("");
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
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error al transcribir el audio.");
    }
    setIsTranscribing(false);
  }, [orgId]);

  // Track edits to auto-transcribed text
  const handleTranscriptionChange = useCallback((value: string) => {
    setTranscription(value);
    if (transcriptionSource === "audio" && transcriptionOriginal) {
      const pct = computeEditPercentage(transcriptionOriginal, value);
      setEditPct(pct);
    }
  }, [transcriptionSource, transcriptionOriginal]);

  const handleSubmit = async () => {
    if (!canSubmit || !userId || !orgId) return;

    setStatus("analyzing");
    setErrorMsg("");

    try {
      // Get scorecard (org-specific first, then global)
      const { data: scorecard } = await supabase
        .from("scorecards")
        .select("id")
        .or(`organization_id.eq.${orgId},organization_id.is.null`)
        .eq("active", true)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .single();

      if (!scorecard) throw new Error("scorecard");

      // Submit to Worker — it creates analyses + analysis_jobs
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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) throw new Error("quota");
        if (res.status === 403) throw new Error("readonly");
        throw new Error(data.error || "worker_error");
      }

      const analysisId = data.analysis_id;

      // Poll Worker for status
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
            window.location.href = `/analisis/${analysisId}`;
          } else if (statusData.status === "error") {
            clearInterval(pollInterval);
            setStatus("error");
            setErrorMsg(statusData.error_message || "Hubo un problema al analizar tu llamada. Intenta de nuevo.");
          }
        } catch {
          // Network error on poll — keep trying
        }
      }, 3000);

      // Timeout after 2 minutes
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

  return (
    <div className="container c2-container">
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
            onChange={(e) => setSelectedStage(e.target.value)}
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
            onChange={(e) => setSelectedSource(e.target.value)}
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
              <input type="file" accept=".txt,.doc,.docx" onChange={handleFileInput} hidden disabled={status === "analyzing" || isTranscribing} />
            </label>
            <AudioRecorder
              onRecordingComplete={handleRecordingComplete}
              disabled={status === "analyzing" || isTranscribing || transcription.length > 0}
            />
            {fileMsg && <span className="c2-file-msg">{fileMsg}</span>}
          </div>
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
            onChange={(e) => setNotes(e.target.value)}
            disabled={status === "analyzing"}
            rows={3}
            style={{ minHeight: 60, resize: "vertical" }}
          />
          <p className="c2-hint">Contexto adicional que ayude a interpretar mejor esta llamada.</p>
        </div>

        {status === "analyzing" && (
          <div className="c2-analyzing">
            <span className="loader loader-terracota" />
            <p className="c2-analyzing-text">Analizando tu llamada...</p>
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

        <button
          className="btn-submit btn-terracota"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Analizar
        </button>
      </div>
    </div>
  );
}
