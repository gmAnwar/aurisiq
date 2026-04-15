"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { requireAuth } from "../../lib/auth";
import {
  getAllRecordings,
  deleteRecording,
  updateRecordingStatus,
  downloadRecordingBlob,
  type PendingRecording,
} from "../../lib/recordings-queue";
import { uploadRecording, submitForAnalysis, checkAnalysisStatus } from "../../lib/recording-upload";

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
  const [recordings, setRecordings] = useState<PendingRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = async (uid?: string) => {
    const id = uid || userId;
    if (!id) return;
    const all = await getAllRecordings(id);
    setRecordings(all.filter(r => !r.incomplete));
  };

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
