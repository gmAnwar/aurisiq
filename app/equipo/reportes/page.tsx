"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { getOrgTimezone, weekStart as getWeekStart } from "../../../lib/dates";
import { getRoleLabel } from "../../../lib/roleLabel";

interface Report {
  id: string;
  tipo: string;
  destinatario_tipo: string;
  created_at: string;
  content: Record<string, unknown> | null;
}

interface CaptadoraConv {
  name: string;
  total: number;
  converted: number;
  convRate: number;
  avgScore: number;
}

export default function ReportesPage() {
  const [activeTab, setActiveTab] = useState<"equipo" | "agencia">("equipo");
  const [teamReports, setTeamReports] = useState<Report[]>([]);
  const [agencyReports, setAgencyReports] = useState<Report[]>([]);
  const [captadoraConv, setCaptadoraConv] = useState<CaptadoraConv[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [roleLabelVendedor, setRoleLabelVendedor] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };
      setOrgSlug(session.organizationSlug);
      setRoleLabelVendedor(session.roleLabelVendedor);

      const tz = await getOrgTimezone(me.organization_id);
      const ws = getWeekStart(tz);

      const [reportsRes, weekRes, teamRes] = await Promise.all([
        supabase.from("reports")
          .select("id, tipo, destinatario_tipo, created_at, content")
          .eq("organization_id", me.organization_id)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("analyses")
          .select("id, user_id, score_general, avanzo_a_siguiente_etapa")
          .eq("organization_id", me.organization_id).eq("status", "completado")
          .gte("created_at", ws),
        supabase.from("users").select("id, name, role")
          .eq("organization_id", me.organization_id).eq("active", true),
      ]);

      const all = reportsRes.data || [];
      setTeamReports(all.filter(r => ["equipo", "todos"].includes(r.destinatario_tipo)));
      setAgencyReports(all.filter(r => ["agencia", "todos"].includes(r.destinatario_tipo)));

      // Conversion by captadora
      const caps = (teamRes.data || []).filter(u => u.role === "captadora");
      const week = weekRes.data || [];
      const convData: CaptadoraConv[] = caps.map(c => {
        const mine = week.filter(a => a.user_id === c.id);
        const converted = mine.filter(a => a.avanzo_a_siguiente_etapa === "converted").length;
        const scores = mine.filter(a => a.score_general !== null).map(a => a.score_general!);
        return {
          name: c.name,
          total: mine.length,
          converted,
          convRate: mine.length > 0 ? Math.round((converted / mine.length) * 100) : 0,
          avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        };
      }).sort((a, b) => b.convRate - a.convRate);
      setCaptadoraConv(convData);

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

        {/* Conversion by captadora (equipo tab only) */}
        {activeTab === "equipo" && captadoraConv.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Conversión por captadora — semana actual</h2>
            <div className="g1-ranking">
              <div className="a1-source-header">
                <span>{getRoleLabel("captadora", { slug: orgSlug, role_label_vendedor: roleLabelVendedor })}</span><span>Leads</span><span>Conv.</span><span>Tasa</span><span>Score</span>
              </div>
              {captadoraConv.map((c, i) => (
                <div key={i} className="a1-source-row">
                  <span className="g1-rank-name">{c.name}</span>
                  <span className="g1-rank-count">{c.total}</span>
                  <span className="g1-rank-count">{c.converted}</span>
                  <span className="g1-rank-score" style={{ color: c.convRate >= 50 ? "var(--green)" : c.convRate >= 25 ? "var(--gold)" : "var(--red)" }}>{c.convRate}%</span>
                  <span className="g1-rank-score">{c.avgScore || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
