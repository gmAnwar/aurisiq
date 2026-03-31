"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface SourceStat {
  name: string;
  total: number;
  qualified: number;
  rate: number;
  delta: number | null;
}

interface DescalFreq {
  label: string;
  count: number;
  pct: number;
  primary: boolean;
}

export default function AgenciaDashboardPage() {
  const [qualRate, setQualRate] = useState(0);
  const [totalWeek, setTotalWeek] = useState(0);
  const [sources, setSources] = useState<SourceStat[]>([]);
  const [descalFreqs, setDescalFreqs] = useState<DescalFreq[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<{ id: string; description: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["agencia", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const now = new Date();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);

      const [weekRes, prevRes, sourcesRes, descalRes, alertsRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, categoria_descalificacion, fuente_lead_id")
          .eq("organization_id", me.organization_id).eq("status", "completado")
          .gte("created_at", weekStart.toISOString()),
        supabase.from("analyses")
          .select("id, categoria_descalificacion, fuente_lead_id")
          .eq("organization_id", me.organization_id).eq("status", "completado")
          .gte("created_at", prevWeekStart.toISOString()).lt("created_at", weekStart.toISOString()),
        supabase.from("lead_sources").select("id, name").eq("organization_id", me.organization_id),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", me.organization_id),
        supabase.from("alerts").select("id, description, created_at")
          .eq("organization_id", me.organization_id).eq("status", "activa")
          .order("created_at", { ascending: false }).limit(5),
      ]);

      setActiveAlerts(alertsRes.data || []);

      const week = weekRes.data || [];
      const prev = prevRes.data || [];
      setTotalWeek(week.length);

      const sourceMap: Record<string, string> = {};
      for (const s of sourcesRes.data || []) sourceMap[s.id] = s.name;

      const descalMap: Record<string, string> = {};
      for (const c of descalRes.data || []) descalMap[c.code] = c.label;

      // Qualification rate
      const qualified = week.filter(a => !a.categoria_descalificacion || a.categoria_descalificacion.length === 0).length;
      setQualRate(week.length > 0 ? Math.round((qualified / week.length) * 100) : 0);

      // Descalification frequencies — separate primary (pos 0) from secondary
      const primaryCounts: Record<string, number> = {};
      const secondaryCounts: Record<string, number> = {};
      for (const a of week) {
        const codes = a.categoria_descalificacion || [];
        if (codes[0]) primaryCounts[codes[0]] = (primaryCounts[codes[0]] || 0) + 1;
        for (let i = 1; i < codes.length; i++) {
          secondaryCounts[codes[i]] = (secondaryCounts[codes[i]] || 0) + 1;
        }
      }

      const descalTotal = week.filter(a => a.categoria_descalificacion && a.categoria_descalificacion.length > 0).length || 1;
      const freqs: DescalFreq[] = [
        ...Object.entries(primaryCounts).map(([code, count]) => ({
          label: descalMap[code] || "Razón no reconocida",
          count,
          pct: Math.round((count / descalTotal) * 100),
          primary: true,
        })),
        ...Object.entries(secondaryCounts)
          .filter(([code]) => !primaryCounts[code])
          .map(([code, count]) => ({
            label: descalMap[code] || "Razón no reconocida",
            count,
            pct: Math.round((count / descalTotal) * 100),
            primary: false,
          })),
      ].sort((a, b) => b.count - a.count);

      setDescalFreqs(freqs);

      // Source stats with delta
      const sourceThisWeek: Record<string, { total: number; qualified: number }> = {};
      const sourcePrevWeek: Record<string, { total: number; qualified: number }> = {};

      for (const a of week) {
        const sid = a.fuente_lead_id || "_none";
        if (!sourceThisWeek[sid]) sourceThisWeek[sid] = { total: 0, qualified: 0 };
        sourceThisWeek[sid].total++;
        if (!a.categoria_descalificacion || a.categoria_descalificacion.length === 0) sourceThisWeek[sid].qualified++;
      }

      for (const a of prev) {
        const sid = a.fuente_lead_id || "_none";
        if (!sourcePrevWeek[sid]) sourcePrevWeek[sid] = { total: 0, qualified: 0 };
        sourcePrevWeek[sid].total++;
        if (!a.categoria_descalificacion || a.categoria_descalificacion.length === 0) sourcePrevWeek[sid].qualified++;
      }

      const sourceStats: SourceStat[] = Object.entries(sourceThisWeek).map(([sid, s]) => {
        const thisRate = s.total > 0 ? Math.round((s.qualified / s.total) * 100) : 0;
        const prevS = sourcePrevWeek[sid];
        const prevRate = prevS && prevS.total > 0 ? Math.round((prevS.qualified / prevS.total) * 100) : null;
        return {
          name: sourceMap[sid] || "Sin fuente",
          total: s.total,
          qualified: s.qualified,
          rate: thisRate,
          delta: prevRate !== null ? thisRate - prevRate : null,
        };
      }).sort((a, b) => b.total - a.total);

      setSources(sourceStats);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="g1-kpis"><div className="skeleton-block" style={{height:80}}/><div className="skeleton-block" style={{height:80}}/></div><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Calidad de Leads</h1>
          <p className="g1-subtitle">Resumen de la semana</p>
        </div>

        {/* Alert banner */}
        {activeAlerts.length > 0 && (
          <a href="/agencia/alertas" style={{ textDecoration: "none", display: "block", marginBottom: 14 }}>
            <div className="a1-alert-banner">
              <span className="a1-alert-banner-icon">⚡</span>
              <div className="a1-alert-banner-text">
                <strong>{activeAlerts.length} alerta{activeAlerts.length > 1 ? "s" : ""} activa{activeAlerts.length > 1 ? "s" : ""}</strong>
                {" — "}{activeAlerts[0].description?.slice(0, 80) || "Revisar alertas"}
              </div>
            </div>
          </a>
        )}

        {/* Big number */}
        <div className="d2-hero">
          <span className="d2-hero-value">{qualRate}%</span>
          <span className="d2-hero-label">Tasa de calificación ({totalWeek} leads analizados)</span>
        </div>

        {/* Descalification reasons — primary visually differentiated */}
        {descalFreqs.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Razones de descalificación</h2>
            <div className="a1-descal-list">
              {descalFreqs.map((d, i) => (
                <div key={i} className={`a1-descal-row ${d.primary ? "a1-descal-primary" : "a1-descal-secondary"}`}>
                  <span className="a1-descal-label">{d.label}</span>
                  <span className="a1-descal-pct">{d.pct}%</span>
                  <span className="a1-descal-count">{d.count}x</span>
                  {d.primary && <span className="a1-descal-badge">Principal</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Source breakdown with delta */}
        <div className="g1-section">
          <h2 className="g1-section-title">Calificación por fuente</h2>
          {sources.length === 0 ? (
            <p className="g1-empty">No hay análisis con fuente de lead esta semana.</p>
          ) : (
            <div className="g1-ranking">
              <div className="a1-source-header">
                <span>Fuente</span><span>Leads</span><span>Calif.</span><span>Tasa</span><span>Delta</span>
              </div>
              {sources.map((s, i) => (
                <div key={i} className="a1-source-row">
                  <span className="g1-rank-name">{s.name}</span>
                  <span className="g1-rank-count">{s.total}</span>
                  <span className="g1-rank-count">{s.qualified}</span>
                  <span className="g1-rank-score">{s.rate}%</span>
                  <span className={`g1-rank-delta ${s.delta !== null && s.delta > 0 ? "g1-delta-up" : s.delta !== null && s.delta < 0 ? "g1-delta-down" : ""}`}>
                    {s.delta !== null ? `${s.delta > 0 ? "+" : ""}${s.delta}pp` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coverage */}
        <div className="g1-section">
          <h2 className="g1-section-title">Cobertura de análisis</h2>
          <p className="g1-empty">{totalWeek} llamadas analizadas esta semana.</p>
        </div>
      </div>
    </div>
  );
}
