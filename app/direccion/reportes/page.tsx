"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";

interface Report {
  id: string;
  tipo: string;
  created_at: string;
  content: Record<string, unknown> | null;
}

export default function ReportesEjecutivosPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["direccion", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const { data } = await supabase.from("reports")
        .select("id, tipo, created_at, content")
        .eq("organization_id", me.organization_id)
        .in("destinatario_tipo", ["direccion", "todos"])
        .eq("tipo", "mensual")
        .order("created_at", { ascending: false }).limit(20);

      setReports(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Reportes Ejecutivos</h1>
          <p className="g1-subtitle">Reportes mensuales de dirección</p>
        </div>

        {reports.length === 0 ? (
          <p className="g1-empty">No hay reportes ejecutivos generados aún. Se generarán automáticamente al final de cada mes (Etapa 4).</p>
        ) : (
          <div className="g6-report-list">
            {reports.map((r) => {
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

        <a href="/direccion" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
