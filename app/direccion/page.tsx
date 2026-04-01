"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface Objective { id: string; name: string; target_value: number; current_value: number; }
interface FunnelRow { stage: string; count: number; rate: number; }

export default function DashboardEjecutivoPage() {
  const [funnelStages, setFunnelStages] = useState<FunnelRow[]>([]);
  const [deltaVsLastMonth, setDeltaVsLastMonth] = useState<number | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [totalAnalyses, setTotalAnalyses] = useState(0);
  const [monthlyComparison, setMonthlyComparison] = useState<{ month: string; count: number; convRate: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["direccion", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();

      const [thisMonthRes, lastMonthRes, objRes, stagesRes] = await Promise.all([
        supabase.from("analyses").select("id, avanzo_a_siguiente_etapa, funnel_stage_id")
          .eq("organization_id", me.organization_id).eq("status", "completado").gte("created_at", thisMonthStart),
        supabase.from("analyses").select("id, avanzo_a_siguiente_etapa")
          .eq("organization_id", me.organization_id).eq("status", "completado").gte("created_at", lastMonthStart).lt("created_at", thisMonthStart),
        supabase.from("objectives").select("id, name, target_value, current_value")
          .eq("organization_id", me.organization_id),
        supabase.from("funnel_stages").select("id, name")
          .eq("organization_id", me.organization_id).order("order_index"),
      ]);

      const thisMonth = thisMonthRes.data || [];
      const lastMonth = lastMonthRes.data || [];
      const allStages = stagesRes.data || [];
      setTotalAnalyses(thisMonth.length);

      // Funnel — count analyses per funnel stage
      const countByStage: Record<string, number> = {};
      for (const a of thisMonth) {
        if (a.funnel_stage_id) {
          countByStage[a.funnel_stage_id] = (countByStage[a.funnel_stage_id] || 0) + 1;
        }
      }

      const total = thisMonth.length || 1;
      const funnel: FunnelRow[] = allStages.map(s => {
        const count = countByStage[s.id] || 0;
        return { stage: s.name, count, rate: Math.round((count / total) * 100) };
      });

      setFunnelStages(funnel);

      // Delta
      if (lastMonth.length > 0) {
        const thisConv = thisMonth.filter(a => a.avanzo_a_siguiente_etapa === "converted").length;
        const lastConv = lastMonth.filter(a => a.avanzo_a_siguiente_etapa === "converted").length;
        const thisRate = thisMonth.length > 0 ? (thisConv / thisMonth.length) * 100 : 0;
        const lastRate = lastMonth.length > 0 ? (lastConv / lastMonth.length) * 100 : 0;
        setDeltaVsLastMonth(Math.round(thisRate - lastRate));
      }

      setObjectives((objRes.data || []) as Objective[]);

      // 3-month comparison
      const { data: threeMonthData } = await supabase.from("analyses")
        .select("id, avanzo_a_siguiente_etapa, created_at")
        .eq("organization_id", me.organization_id).eq("status", "completado")
        .gte("created_at", threeMonthsAgo);

      const monthBuckets: Record<string, { count: number; converted: number }> = {};
      for (const a of threeMonthData || []) {
        const d = new Date(a.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!monthBuckets[key]) monthBuckets[key] = { count: 0, converted: 0 };
        monthBuckets[key].count++;
        if (a.avanzo_a_siguiente_etapa === "converted") monthBuckets[key].converted++;
      }

      const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const comparison = Object.entries(monthBuckets)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => ({
          month: months[parseInt(key.split("-")[1]) - 1],
          count: v.count,
          convRate: v.count > 0 ? Math.round((v.converted / v.count) * 100) : 0,
        }));
      setMonthlyComparison(comparison);
      setLoading(false);
    }
    load();
  }, []);

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
          <h1 className="g1-title">Dashboard Ejecutivo</h1>
          <p className="g1-subtitle">Métricas de negocio este mes</p>
        </div>

        {/* KPIs */}
        <div className="g1-kpis">
          <div className="g1-kpi">
            <span className="g1-kpi-value">{totalAnalyses}</span>
            <span className="g1-kpi-label">Análisis este mes</span>
          </div>
          <div className="g1-kpi">
            <span className="g1-kpi-value">
              {funnelStages.find(f => f.stage === "Convertido")?.rate || 0}%
            </span>
            <span className="g1-kpi-label">Tasa de conversión</span>
          </div>
          <div className="g1-kpi">
            {deltaVsLastMonth !== null ? (
              <span className={`g1-kpi-value ${deltaVsLastMonth > 0 ? "g1-delta-up" : deltaVsLastMonth < 0 ? "g1-delta-down" : ""}`}>
                {deltaVsLastMonth > 0 ? "+" : ""}{deltaVsLastMonth}pp
              </span>
            ) : (
              <span className="g1-kpi-value">—</span>
            )}
            <span className="g1-kpi-label">Delta vs mes anterior</span>
          </div>
        </div>

        {/* Funnel */}
        <div className="g1-section">
          <h2 className="g1-section-title">Embudo de captaciones</h2>
          <div className="d1-funnel">
            {funnelStages.map((s, i) => (
              <div key={i} className="d1-funnel-row">
                <span className="d1-funnel-label">{s.stage}</span>
                <div className="d1-funnel-bar-bg">
                  <div className="d1-funnel-bar-fill" style={{ width: `${s.rate}%` }} />
                </div>
                <span className="d1-funnel-value">{s.count} ({s.rate}%)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Empty funnel helper */}
        {totalAnalyses === 0 && funnelStages.length > 0 && (
          <div className="c5-empty-card" style={{ marginBottom: 14 }}>
            <div className="c5-empty-sub">Cuando las captadoras envíen análisis, verás aquí la distribución por etapa del embudo.</div>
          </div>
        )}

        {/* 3-month comparison */}
        {monthlyComparison.length > 1 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Comparativa mensual</h2>
            <div className="d1-monthly">
              {monthlyComparison.map((m, i) => (
                <div key={i} className="d1-monthly-col">
                  <div className="d1-monthly-bar-wrap">
                    <div className="d1-monthly-bar" style={{ height: `${m.convRate}%` }} />
                  </div>
                  <span className="d1-monthly-rate">{m.convRate}%</span>
                  <span className="d1-monthly-count">{m.count}</span>
                  <span className="d1-monthly-label">{m.month}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Objectives */}
        <div className="g1-section">
          <h2 className="g1-section-title">Iniciativas</h2>
          {objectives.length === 0 ? (
            <p className="g1-empty">No hay objetivos configurados para esta organización.</p>
          ) : (
            <div className="d1-objectives">
              {objectives.map(o => {
                const pct = o.target_value > 0 ? Math.min(100, Math.round((o.current_value / o.target_value) * 100)) : 0;
                return (
                  <div key={o.id} className="d1-obj-card">
                    <div className="d1-obj-header">
                      <span className="d1-obj-name">{o.name}</span>
                      <span className="d1-obj-pct">{pct}%</span>
                    </div>
                    <div className="c3-phase-bar-bg"><div className="c3-phase-bar-fill" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
