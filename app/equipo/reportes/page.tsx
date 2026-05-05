"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { requireAuth } from "../../../lib/auth";
import { getOrgTimezone } from "../../../lib/dates";
import {
  getPresetRange,
  PRESET_LABELS,
  formatDateShort,
  fromISODate,
  type PresetKey,
  type DateRange,
} from "../../../lib/date-presets";
import { getRoleLabel } from "../../../lib/roleLabel";
import DateRangeFilter from "../../components/DateRangeFilter";

interface Report {
  id: string;
  tipo: string;
  destinatario_tipo: string;
  created_at: string;
  content: Record<string, unknown> | null;
}

interface CaptadoraConv {
  id: string;
  name: string;
  total: number;
  converted: number;
  convRate: number;
  avgScore: number;
  lastActivity: Date | null;
}

function ReportesInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rangeParam = (searchParams.get("range") as PresetKey | "custom" | null) || "this_month";
  const fromParam = searchParams.get("from") || undefined;
  const toParam = searchParams.get("to") || undefined;

  const [activeTab, setActiveTab] = useState<"equipo" | "agencia">("equipo");
  const [tz, setTz] = useState<string>("America/Monterrey");
  const [orgId, setOrgId] = useState<string>("");
  const [teamReports, setTeamReports] = useState<Report[]>([]);
  const [agencyReports, setAgencyReports] = useState<Report[]>([]);
  const [captadoraConv, setCaptadoraConv] = useState<CaptadoraConv[]>([]);
  const [loading, setLoading] = useState(true);
  const [error] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [roleLabelVendedor, setRoleLabelVendedor] = useState<string | null>(null);

  const dateRange = useMemo<DateRange | null>(() => {
    if (rangeParam === "custom" && fromParam && toParam) {
      const from = fromISODate(fromParam);
      const to = new Date(fromISODate(toParam).getTime() + 86400000);
      return { from, to };
    }
    return getPresetRange(rangeParam as PresetKey, tz);
  }, [rangeParam, fromParam, toParam, tz]);

  const periodLabel = useMemo(() => {
    if (rangeParam === "custom" && fromParam && toParam) {
      return `Personalizado: ${formatDateShort(fromISODate(fromParam))} – ${formatDateShort(fromISODate(toParam))}`;
    }
    return PRESET_LABELS[rangeParam as PresetKey] || "Período";
  }, [rangeParam, fromParam, toParam]);

  useEffect(() => {
    async function init() {
      const session = await requireAuth(["gerente", "super_admin"]);
      if (!session) return;
      setOrgSlug(session.organizationSlug);
      setRoleLabelVendedor(session.roleLabelVendedor);
      const orgTz = await getOrgTimezone(session.organizationId);
      setTz(orgTz);
      setOrgId(session.organizationId);
    }
    init();
  }, []);

  useEffect(() => {
    if (!orgId) return;

    async function load() {
      const fromIso = dateRange?.from.toISOString();
      const toIso = dateRange?.to.toISOString();

      let periodQuery = supabase.from("analyses")
        .select("id, user_id, score_general, avanzo_a_siguiente_etapa")
        .eq("organization_id", orgId).eq("status", "completado");
      if (fromIso && toIso) {
        periodQuery = periodQuery.gte("created_at", fromIso).lt("created_at", toIso);
      }

      const [reportsRes, periodRes, teamRes, lastActivityRes] = await Promise.all([
        supabase.from("reports")
          .select("id, tipo, destinatario_tipo, created_at, content")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }).limit(50),
        periodQuery,
        supabase.from("users").select("id, name, role, roles")
          .eq("organization_id", orgId).eq("active", true),
        supabase.from("analyses")
          .select("user_id, created_at")
          .eq("organization_id", orgId).eq("status", "completado")
          .order("created_at", { ascending: false }),
      ]);

      const all = reportsRes.data || [];
      setTeamReports(all.filter(r => ["equipo", "todos"].includes(r.destinatario_tipo)));
      setAgencyReports(all.filter(r => ["agencia", "todos"].includes(r.destinatario_tipo)));

      const lastActivity: Record<string, Date> = {};
      for (const a of lastActivityRes.data || []) {
        if (!lastActivity[a.user_id]) lastActivity[a.user_id] = new Date(a.created_at);
      }

      const caps = (teamRes.data || []).filter(u => (u.roles as string[] | null)?.includes("captadora") ?? u.role === "captadora");
      const period = periodRes.data || [];
      const convData: CaptadoraConv[] = caps.map(c => {
        const mine = period.filter(a => a.user_id === c.id);
        const converted = mine.filter(a => a.avanzo_a_siguiente_etapa === "converted").length;
        const scores = mine.filter(a => a.score_general !== null).map(a => a.score_general!);
        return {
          id: c.id,
          name: c.name,
          total: mine.length,
          converted,
          convRate: mine.length > 0 ? Math.round((converted / mine.length) * 100) : 0,
          avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
          lastActivity: lastActivity[c.id] || null,
        };
      });
      setCaptadoraConv(convData);

      setLoading(false);
    }
    load();
  }, [orgId, dateRange?.from.getTime(), dateRange?.to.getTime()]);

  const updateRange = (newRange: PresetKey | "custom", from?: string, to?: string) => {
    const params = new URLSearchParams();
    params.set("range", newRange);
    if (newRange === "custom" && from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    router.push(`/equipo/reportes?${params.toString()}`, { scroll: false });
  };

  const groups = useMemo(() => {
    const active = captadoraConv.filter(c => c.total > 0).sort((a, b) => b.total - a.total);
    const inactiveWithHist = captadoraConv.filter(c => c.total === 0 && c.lastActivity !== null)
      .sort((a, b) => (b.lastActivity!.getTime() - a.lastActivity!.getTime()));
    const noHist = captadoraConv.filter(c => c.total === 0 && c.lastActivity === null)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { active, inactiveWithHist, noHist };
  }, [captadoraConv]);

  const handleSendReport = async () => {
    setSending(true);
    setSendMsg("");
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

  const captadoraLabel = getRoleLabel("captadora", { slug: orgSlug, role_label_vendedor: roleLabelVendedor });
  const showSectionHeaders = groups.inactiveWithHist.length > 0 || groups.noHist.length > 0;

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Reportes</h1>
        </div>

        <DateRangeFilter
          range={rangeParam as PresetKey | "custom"}
          from={fromParam}
          to={toParam}
          onChange={updateRange}
          tz={tz}
        />

        <div className="g6-tabs">
          <button className={`g6-tab ${activeTab === "equipo" ? "g6-tab-active" : ""}`} onClick={() => setActiveTab("equipo")}>
            Equipo
          </button>
          <button className={`g6-tab ${activeTab === "agencia" ? "g6-tab-active" : ""}`} onClick={() => setActiveTab("agencia")}>
            Agencia
          </button>
        </div>

        {activeTab === "equipo" && captadoraConv.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Conversión por captadora — {periodLabel}</h2>
            <div className="g1-ranking">
              <div className="g6-conv-header">
                <span>{captadoraLabel}</span>
                <span>Análisis</span>
                <span>Última actividad</span>
                <span>Leads</span>
                <span>Conv.</span>
                <span>Tasa</span>
                <span>Score</span>
              </div>

              {showSectionHeaders && groups.active.length > 0 && (
                <div className="g6-section-divider">Activas en el período</div>
              )}
              {groups.active.map(c => (
                <div key={c.id} className="g6-conv-row">
                  <span className="g1-rank-name">{c.name}</span>
                  <span className="g1-rank-count">{c.total}</span>
                  <span className="g1-rank-count">{c.lastActivity ? formatDateShort(c.lastActivity) : "Nunca"}</span>
                  <span className="g1-rank-count">{c.total}</span>
                  <span className="g1-rank-count">{c.converted}</span>
                  <span className="g1-rank-score" style={{ color: c.convRate >= 50 ? "var(--green)" : c.convRate >= 25 ? "var(--gold)" : "var(--red)" }}>{c.convRate}%</span>
                  <span className="g1-rank-score">{c.avgScore || "—"}</span>
                </div>
              ))}

              {groups.inactiveWithHist.length > 0 && (
                <div className="g6-section-divider">Sin actividad en el período</div>
              )}
              {groups.inactiveWithHist.map(c => (
                <div key={c.id} className="g6-conv-row g6-inactive-row">
                  <span className="g1-rank-name">{c.name}</span>
                  <span className="g1-rank-count">0</span>
                  <span className="g1-rank-count">{c.lastActivity ? formatDateShort(c.lastActivity) : "Nunca"}</span>
                  <span className="g1-rank-count">0</span>
                  <span className="g1-rank-count">0</span>
                  <span className="g1-rank-score">—</span>
                  <span className="g1-rank-score">—</span>
                </div>
              ))}

              {groups.noHist.length > 0 && (
                <div className="g6-section-divider">Sin actividad histórica</div>
              )}
              {groups.noHist.map(c => (
                <div key={c.id} className="g6-conv-row g6-inactive-row">
                  <span className="g1-rank-name">{c.name}</span>
                  <span className="g1-rank-count">0</span>
                  <span className="g1-rank-count">Nunca</span>
                  <span className="g1-rank-count">0</span>
                  <span className="g1-rank-count">0</span>
                  <span className="g1-rank-score">—</span>
                  <span className="g1-rank-score">—</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "equipo" && (
          <button className="btn-submit" style={{ marginBottom: 20 }} onClick={handleSendReport} disabled={sending}>
            {sending ? "Generando..." : "Enviar reporte ahora"}
          </button>
        )}

        {sendMsg && (
          <div className="message-box message-success" style={{ marginBottom: 16 }}><p>{sendMsg}</p></div>
        )}

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

export default function ReportesPage() {
  return (
    <Suspense fallback={<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /></div></div>}>
      <ReportesInner />
    </Suspense>
  );
}
