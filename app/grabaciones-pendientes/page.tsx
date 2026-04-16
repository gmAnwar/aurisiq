"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import {
  getAllRecordings,
  deleteRecording,
  updateRecordingStatus,
  downloadRecordingBlob,
  type PendingRecording,
} from "../../lib/recordings-queue";
import { uploadRecording, submitForAnalysis } from "../../lib/recording-upload";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  uploading: "Subiendo...",
  uploaded: "Lista para analizar",
  analyzing: "Analizando...",
  completed: "Completado",
  error: "Error",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "queue-status-pending",
  uploading: "queue-status-uploading",
  uploaded: "queue-status-uploaded",
  analyzing: "queue-status-analyzing",
  completed: "queue-status-uploaded",
  error: "queue-status-error",
};

export default function GrabacionesPendientesPage() {
  const router = useRouter();
  const [recordings, setRecordings] = useState<PendingRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState<string | null>(null); // track transition

  const refresh = async (uid?: string) => {
    const id = uid || userId;
    if (!id) return;
    const all = await getAllRecordings(id);

    // Resolve real analysis_id for recordings stuck in "analyzing" or
    // "completed" where analysis_id actually stores background_job.id.
    // The background_jobs.result->>'analysis_id' is the real analyses.id.
    for (const rec of all) {
      if (!rec.analysis_id) continue;
      if (rec.status !== "analyzing" && rec.status !== "completed") continue;

      const { data: job } = await supabase
        .from("background_jobs")
        .select("status, result")
        .eq("id", rec.analysis_id) // currently stores job.id
        .maybeSingle();

      if (!job) continue;

      const realAnalysisId = (job.result as { analysis_id?: string })?.analysis_id;

      if (job.status === "completed" && realAnalysisId) {
        // Only update if we haven't fixed it yet (analysis_id still points to job.id)
        if (rec.analysis_id !== realAnalysisId || rec.status !== "completed") {
          await updateRecordingStatus(rec.id, "completed", { analysis_id: realAnalysisId });
          // Auto-navigate if this recording just completed (was analyzing before)
          if (rec.status === "analyzing") {
            setJustCompleted(realAnalysisId);
          }
        }
      } else if (job.status === "error") {
        await updateRecordingStatus(rec.id, "error", { last_error: "Analisis fallo" });
      }
    }

    const updated = await getAllRecordings(id);
    setRecordings(updated.filter(r => !r.incomplete));
  };

  // Auto-navigate when a recording just completed
  useEffect(() => {
    if (justCompleted) {
      router.push(`/analisis/${justCompleted}`);
    }
  }, [justCompleted, router]);

  useEffect(() => {
    async function init() {
      const session = await requireAuth(["captadora", "gerente", "super_admin"]);
      if (!session) return;
      setUserId(session.userId);
      await refresh(session.userId);
      setLoading(false);
    }
    init();
  }, []);

  // Poll for status changes
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => refresh(), 5000);
    return () => clearInterval(interval);
  }, [userId]);

  const handleRetry = async (rec: PendingRecording) => {
    await updateRecordingStatus(rec.id, "pending", { attempt_count: 0, last_error: null });
    try { await uploadRecording({ ...rec, status: "pending", attempt_count: 0 }); } catch { /* will show error */ }
    await refresh();
  };

  const handleAnalyze = async (rec: PendingRecording) => {
    if (rec.status !== "uploaded") return;
    try {
      await submitForAnalysis(rec);
    } catch { /* will show error */ }
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteRecording(id);
    setConfirmDelete(null);
    await refresh();
  };

  const handleDownload = (rec: PendingRecording) => {
    downloadRecordingBlob(rec);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
  };

  if (loading) {
    return (
      <div className="queue-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  const active = recordings.filter(r => r.status !== "completed");
  const errors = active.filter(r => r.status === "error");
  const nonErrors = active.filter(r => r.status !== "error");

  return (
    <div className="queue-container">
      <h1 className="queue-title">Grabaciones pendientes</h1>

      {active.length === 0 && (
        <div className="queue-empty">
          <p>No hay grabaciones pendientes</p>
          <Link href="/grabar" className="btn-submit" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
            Grabar consulta
          </Link>
        </div>
      )}

      {/* Active recordings */}
      {nonErrors.map(rec => (
        <div key={rec.id} className="queue-card">
          <div className="queue-card-header">
            <div>
              <div className="queue-card-name">{rec.prospect_name || "Sin nombre"}</div>
              <div className="queue-card-meta">{formatDate(rec.created_at)} · {formatTime(rec.duration_seconds)}</div>
            </div>
            <span className={`queue-card-status ${STATUS_CLASS[rec.status]}`}>
              {STATUS_LABELS[rec.status]}
            </span>
          </div>
          <div className="queue-card-actions">
            {rec.status === "uploaded" && (
              <button onClick={() => handleAnalyze(rec)}>Analizar</button>
            )}
            <button onClick={() => handleDownload(rec)}>Descargar</button>
            {rec.analysis_id && rec.status === "completed" && (
              <Link href={`/analisis/${rec.analysis_id}`}>Ver resultado</Link>
            )}
            {confirmDelete === rec.id ? (
              <>
                <button onClick={() => handleDelete(rec.id)} style={{ color: "#991b1b" }}>Confirmar</button>
                <button onClick={() => setConfirmDelete(null)}>Cancelar</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(rec.id)}>Eliminar</button>
            )}
          </div>
          {(rec.status === "pending" || rec.status === "uploading") && (
            <p style={{ fontSize: 11, color: "var(--ink-light)", marginTop: 8, fontStyle: "italic" }}>
              Subiendo audio... se analizara automaticamente cuando haya conexion.
            </p>
          )}
          {rec.status === "analyzing" && (
            <p style={{ fontSize: 11, color: "var(--ink-light)", marginTop: 8, fontStyle: "italic" }}>
              Analizando — se abrira automaticamente cuando termine.
            </p>
          )}
        </div>
      ))}

      {/* Error section */}
      {errors.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "#991b1b", margin: "20px 0 10px" }}>
            Errores — NO respaldadas en la nube
          </h2>
          {errors.map(rec => (
            <div key={rec.id} className="queue-card queue-card--error">
              <div className="queue-card-header">
                <div>
                  <div className="queue-card-name">{rec.prospect_name || "Sin nombre"}</div>
                  <div className="queue-card-meta">{formatDate(rec.created_at)} · {formatTime(rec.duration_seconds)}</div>
                </div>
                <span className={`queue-card-status ${STATUS_CLASS.error}`}>Error</span>
              </div>
              <div className="queue-card-warning">
                Esta grabacion NO esta respaldada en la nube. NO limpies datos del navegador.
                {rec.last_error && <><br/>Error: {rec.last_error}</>}
              </div>
              <div className="queue-card-actions">
                <button onClick={() => handleRetry(rec)}>Reintentar</button>
                <button onClick={() => handleDownload(rec)}>Descargar audio</button>
                {confirmDelete === rec.id ? (
                  <>
                    <button onClick={() => handleDelete(rec.id)} style={{ color: "#991b1b" }}>Confirmar</button>
                    <button onClick={() => setConfirmDelete(null)}>Cancelar</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDelete(rec.id)}>Eliminar</button>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {active.length > 0 && (
        <Link href="/grabar" style={{ display: "block", textAlign: "center", marginTop: 20, fontSize: 14, color: "var(--accent)" }}>
          Grabar otra consulta
        </Link>
      )}
    </div>
  );
}
