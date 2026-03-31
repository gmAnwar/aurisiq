"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

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
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const canSubmit = selectedSource !== "" && selectedStage !== "" && transcription.trim().length > 0 && status === "idle";
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
            body: JSON.stringify({ action: "status", analysis_id: analysisId }),
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
          <textarea
            id="transcription"
            className="input-field c2-textarea"
            placeholder="Pega aquí la transcripción completa de tu llamada..."
            value={transcription}
            onChange={(e) => {
              if (e.target.value.length <= CHAR_LIMIT) {
                setTranscription(e.target.value);
              }
            }}
            disabled={status === "analyzing"}
            rows={10}
          />
          <div className="c2-char-count">
            <span className={charCount > CHAR_LIMIT * 0.9 ? "c2-char-warning" : ""}>
              {charCount.toLocaleString()} / {CHAR_LIMIT.toLocaleString()}
            </span>
          </div>
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
