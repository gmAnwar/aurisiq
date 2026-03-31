"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface Alert {
  id: string;
  description: string;
  source_affected: string | null;
  status: string;
  created_at: string;
}

export default function AgenciaAlertasPage() {
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [attendedAlerts, setAttendedAlerts] = useState<Alert[]>([]);
  const [showAttended, setShowAttended] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["agencia", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const { data } = await supabase.from("alerts")
        .select("id, description, source_affected, status, created_at")
        .eq("organization_id", me.organization_id)
        .order("created_at", { ascending: false });

      const all = data || [];
      setActiveAlerts(all.filter(a => a.status === "activa"));
      setAttendedAlerts(all.filter(a => a.status === "atendida"));
      setLoading(false);
    }
    load();
  }, []);

  const markAttended = async (alertId: string) => {
    await supabase.from("alerts").update({ status: "atendida" }).eq("id", alertId);
    setActiveAlerts(prev => prev.filter(a => a.id !== alertId));
    const moved = activeAlerts.find(a => a.id === alertId);
    if (moved) setAttendedAlerts(prev => [{ ...moved, status: "atendida" }, ...prev]);
  };

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Alertas</h1>
        </div>

        {/* Active alerts */}
        {activeAlerts.length === 0 ? (
          <div className="a3-empty-state">
            <p>No hay alertas activas. El sistema te notificará si alguna fuente cambia significativamente.</p>
          </div>
        ) : (
          <div className="a3-alert-list">
            {activeAlerts.map(a => (
              <div key={a.id} className="a3-alert-card a3-alert-active">
                <div className="a3-alert-content">
                  <span className="a3-alert-date">{new Date(a.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                  {a.source_affected && <span className="a3-alert-source">{a.source_affected}</span>}
                  <p className="a3-alert-desc">{a.description}</p>
                </div>
                <button className="a3-attend-btn" onClick={() => markAttended(a.id)}>Marcar como atendida</button>
              </div>
            ))}
          </div>
        )}

        {/* Attended alerts — collapsed by default */}
        {attendedAlerts.length > 0 && (
          <div className="g1-section" style={{ marginTop: 24 }}>
            <button className="c5-expand-btn" onClick={() => setShowAttended(!showAttended)}>
              {showAttended ? "Ocultar historial" : `Ver historial (${attendedAlerts.length} atendidas)`}
            </button>
            {showAttended && (
              <div className="a3-alert-list" style={{ marginTop: 12 }}>
                {attendedAlerts.map(a => (
                  <div key={a.id} className="a3-alert-card a3-alert-attended">
                    <div className="a3-alert-content">
                      <span className="a3-alert-date">{new Date(a.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                      {a.source_affected && <span className="a3-alert-source">{a.source_affected}</span>}
                      <p className="a3-alert-desc">{a.description}</p>
                    </div>
                    <span className="a3-attended-label">Atendida</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <a href="/agencia" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
