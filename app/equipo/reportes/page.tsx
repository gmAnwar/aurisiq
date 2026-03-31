"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface Report {
  id: string;
  tipo: string;
  destinatario_tipo: string;
  created_at: string;
  content: Record<string, unknown> | null;
}

export default function ReportesPage() {
  const [activeTab, setActiveTab] = useState<"equipo" | "agencia">("equipo");
  const [teamReports, setTeamReports] = useState<Report[]>([]);
  const [agencyReports, setAgencyReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const { data: reports } = await supabase.from("reports")
        .select("id, tipo, destinatario_tipo, created_at, content")
        .eq("organization_id", me.organization_id)
        .order("created_at", { ascending: false })
        .limit(50);

      const all = reports || [];
      setTeamReports(all.filter(r => ["equipo", "todos"].includes(r.destinatario_tipo)));
      setAgencyReports(all.filter(r => ["agencia", "todos"].includes(r.destinatario_tipo)));
      setLoading(false);
    }
    load();
  }, []);

  const handleSendReport = async () => {
    setSending(true);
    setSendMsg("");
    // In production this would call the Worker to generate and send the report
    // For now, show a placeholder
    setTimeout(() => {
      setSending(false);
      setSendMsg("Funcionalidad de envío de reportes disponible en Etapa 4.");
    }, 1000);
  };

  const currentReports = activeTab === "equipo" ? teamReports : agencyReports;

  if (loading) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="skeleton-block skeleton-title" />
      <div className="skeleton-block skeleton-textarea" />
    </div></div>);
  }

  if (error) {
    return (<div className="g1-wrapper"><div className="g1-container">
      <div className="message-box message-error"><p>{error}</p></div>
    </div></div>);
  }

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Reportes</h1>
        </div>

        {/* Tabs */}
        <div className="g6-tabs">
          <button className={`g6-tab ${activeTab === "equipo" ? "g6-tab-active" : ""}`} onClick={() => setActiveTab("equipo")}>
            Equipo
          </button>
          <button className={`g6-tab ${activeTab === "agencia" ? "g6-tab-active" : ""}`} onClick={() => setActiveTab("agencia")}>
            Agencia
          </button>
        </div>

        {/* Send button (equipo tab only) */}
        {activeTab === "equipo" && (
          <button className="btn-submit" style={{ marginBottom: 20 }} onClick={handleSendReport} disabled={sending}>
            {sending ? "Generando..." : "Enviar reporte ahora"}
          </button>
        )}

        {sendMsg && (
          <div className="message-box message-success" style={{ marginBottom: 16 }}><p>{sendMsg}</p></div>
        )}

        {/* Report list */}
        {currentReports.length === 0 ? (
          <p className="g1-empty">
            {activeTab === "equipo"
              ? "No hay reportes de equipo enviados. Genera el primero con el botón de arriba."
              : "No hay reportes de agencia enviados aún."}
          </p>
        ) : (
          <div className="g6-report-list">
            {currentReports.map((r) => {
              const date = new Date(r.created_at);
              return (
                <div key={r.id} className="g6-report-card">
                  <div className="g6-report-meta">
                    <span className="g6-report-date">
                      {date.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                    <span className="g6-report-type">{r.tipo}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
