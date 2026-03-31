"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface CaptadoraCard {
  userId: string;
  name: string;
  avgScore: number;
  count: number;
  delta: number | null;
  dailyDone: number;
  dailyTarget: number | null;
  status: "green" | "yellow" | "red" | "none";
}

interface ObjecionFreq { objecion: string; count: number; }

export default function EquipoDashboard() {
  const [totalWeek, setTotalWeek] = useState(0);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [bestCaptadora, setBestCaptadora] = useState<string | null>(null);
  const [mostImproved, setMostImproved] = useState<string | null>(null);
  const [captadoras, setCaptadoras] = useState<CaptadoraCard[]>([]);
  const [objeciones, setObjeciones] = useState<ObjecionFreq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "direccion", "super_admin"]);
      if (!session) return;
      const orgId = session.organizationId;

      const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).single();
      setOrgName(org?.name || "");

      const now = new Date();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

      const [teamRes, weekRes, prevRes, todayRes, objRes] = await Promise.all([
        supabase.from("users").select("id, name, role").eq("organization_id", orgId).eq("active", true),
        supabase.from("analyses").select("id, user_id, score_general, objecion_principal")
          .eq("organization_id", orgId).eq("status", "completado").gte("created_at", weekStart.toISOString()),
        supabase.from("analyses").select("user_id, score_general")
          .eq("organization_id", orgId).eq("status", "completado")
          .gte("created_at", prevWeekStart.toISOString()).lt("created_at", weekStart.toISOString()),
        supabase.from("analyses").select("user_id")
          .eq("organization_id", orgId).eq("status", "completado").gte("created_at", todayStart.toISOString()),
        supabase.from("objectives").select("target_user_id, target_value, type, period_type")
          .eq("organization_id", orgId).eq("is_active", true).eq("type", "volume").in("period_type", ["monthly"]),
      ]);

      const caps = (teamRes.data || []).filter(u => u.role === "captadora");
      const week = weekRes.data || [];
      const prev = prevRes.data || [];
      const todayData = todayRes.data || [];

      setTotalWeek(week.length);
      const scores = week.filter(a => a.score_general !== null).map(a => a.score_general!);
      setAvgScore(scores.length >= 2 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null);

      // Per-user stats
      const weekByUser: Record<string, number[]> = {};
      const prevByUser: Record<string, number[]> = {};
      const todayByUser: Record<string, number> = {};

      for (const a of week) { if (a.score_general !== null) { if (!weekByUser[a.user_id]) weekByUser[a.user_id] = []; weekByUser[a.user_id].push(a.score_general); } }
      for (const a of prev) { if (a.score_general !== null) { if (!prevByUser[a.user_id]) prevByUser[a.user_id] = []; prevByUser[a.user_id].push(a.score_general); } }
      for (const a of todayData) { todayByUser[a.user_id] = (todayByUser[a.user_id] || 0) + 1; }

      // Objectives per user
      const objByUser: Record<string, number> = {};
      const globalObj = (objRes.data || []).find(o => !o.target_user_id);
      for (const o of objRes.data || []) {
        if (o.target_user_id) objByUser[o.target_user_id] = o.target_value;
      }

      const cards: CaptadoraCard[] = caps.map(u => {
        const ws = weekByUser[u.id] || [];
        const ps = prevByUser[u.id] || [];
        const thisAvg = ws.length > 0 ? Math.round(ws.reduce((a, b) => a + b, 0) / ws.length) : 0;
        const prevAvg = ps.length > 0 ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
        const target = objByUser[u.id] || (globalObj?.target_value ?? null);
        const dailyTarget = target !== null ? Math.max(1, Math.ceil(target / 22)) : null;
        const dailyDone = todayByUser[u.id] || 0;

        let status: "green" | "yellow" | "red" | "none" = "none";
        if (dailyTarget !== null) {
          const pct = dailyDone / dailyTarget;
          if (pct >= 1) status = "green";
          else if (pct >= 0.5) status = "yellow";
          else status = "red";
        }

        return {
          userId: u.id, name: u.name, avgScore: thisAvg, count: ws.length,
          delta: prevAvg !== null && ws.length > 0 ? thisAvg - prevAvg : null,
          dailyDone, dailyTarget, status,
        };
      });

      // Sort: red first, then yellow, then green, then none
      const statusOrder = { red: 0, yellow: 1, green: 2, none: 3 };
      cards.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
      setCaptadoras(cards);

      if (cards.length > 0 && cards.some(c => c.count > 0)) {
        const sorted = [...cards].sort((a, b) => b.avgScore - a.avgScore);
        setBestCaptadora(sorted.find(c => c.count > 0)?.name || null);
        const withDelta = cards.filter(c => c.delta !== null && c.delta > 0);
        withDelta.sort((a, b) => (b.delta || 0) - (a.delta || 0));
        setMostImproved(withDelta[0]?.name || null);
      }

      // Top objeciones
      const objCount: Record<string, number> = {};
      for (const a of week) {
        if (a.objecion_principal) {
          const cleaned = a.objecion_principal.replace(/^\*+\s*/, "").trim();
          if (cleaned) objCount[cleaned] = (objCount[cleaned] || 0) + 1;
        }
      }
      setObjeciones(Object.entries(objCount).map(([o, c]) => ({ objecion: o, count: c })).sort((a, b) => b.count - a.count).slice(0, 3));
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="g1-kpis"><div className="skeleton-block" style={{height:80}}/><div className="skeleton-block" style={{height:80}}/><div className="skeleton-block" style={{height:80}}/><div className="skeleton-block" style={{height:80}}/></div></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  const statusEmoji = { green: "🟢", yellow: "🟡", red: "🔴", none: "⚪" };

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Dashboard — {orgName}</h1>
          <p className="g1-subtitle">Resumen del equipo esta semana</p>
        </div>

        <div className="g1-kpis">
          <div className="g1-kpi"><span className="g1-kpi-value">{totalWeek}</span><span className="g1-kpi-label">Análisis semana</span></div>
          <div className="g1-kpi"><span className="g1-kpi-value">{avgScore !== null ? avgScore : "—"}</span><span className="g1-kpi-label">Score promedio</span></div>
          <div className="g1-kpi"><span className="g1-kpi-value g1-kpi-name">{bestCaptadora || "—"}</span><span className="g1-kpi-label">Mejor score</span></div>
          <div className="g1-kpi"><span className="g1-kpi-value g1-kpi-name">{mostImproved || "—"}</span><span className="g1-kpi-label">Mayor mejora</span></div>
        </div>

        {/* Traffic light — captadoras by objective status */}
        <div className="g1-section">
          <h2 className="g1-section-title">Equipo hoy</h2>
          <div className="g1-traffic">
            {captadoras.map(c => (
              <a key={c.userId} href={`/equipo/captadora/${c.userId}`} className="g1-traffic-card" style={{ textDecoration: "none", color: "inherit" }}>
                <span className="g1-traffic-status">{statusEmoji[c.status]}</span>
                <div className="g1-traffic-info">
                  <span className="g1-traffic-name">{c.name}</span>
                  <span className="g1-traffic-detail">
                    {c.dailyTarget !== null
                      ? `${c.dailyDone}/${c.dailyTarget} hoy`
                      : "Sin objetivo"}
                    {c.count > 0 ? ` · Score: ${c.avgScore}` : ""}
                    {c.delta !== null ? ` (${c.delta > 0 ? "+" : ""}${c.delta})` : ""}
                  </span>
                </div>
              </a>
            ))}
            {captadoras.length === 0 && <p className="g1-empty">No hay captadoras registradas.</p>}
          </div>
        </div>

        {/* Objeciones */}
        <div className="g1-section">
          <h2 className="g1-section-title">Top objeciones de la semana</h2>
          {objeciones.length === 0 ? (
            <p className="g1-empty">Sin objeciones registradas esta semana.</p>
          ) : (
            <div className="g1-objeciones">
              {objeciones.map((o, i) => (
                <div key={i} className="g1-objecion-row">
                  <span className="g1-objecion-rank">#{i + 1}</span>
                  <span className="g1-objecion-text">{o.objecion}</span>
                  <span className="g1-objecion-count">{o.count}x</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alertas */}
        <div className="g1-section">
          <h2 className="g1-section-title">Alertas</h2>
          <p className="g1-empty">No hay alertas activas. El sistema notificará si algún indicador cambia significativamente.</p>
        </div>
      </div>
    </div>
  );
}
