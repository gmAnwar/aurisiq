"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import { getOrgTimezone, todayStart as getTodayStart, weekStart as getWeekStart, prevWeekStart as getPrevWeekStart } from "../../lib/dates";

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

interface RecentCall {
  id: string;
  userName: string;
  prospect_name: string | null;
  score_general: number | null;
  clasificacion: string | null;
  categoria_descalificacion: string[] | null;
  fuente_lead_id: string | null;
  created_at: string;
}

interface Insight {
  icon: string;
  text: string;
}

export default function EquipoDashboard() {
  const [todayCount, setTodayCount] = useState(0);
  const [yesterdayCount, setYesterdayCount] = useState(0);
  const [todayAvg, setTodayAvg] = useState<number | null>(null);
  const [todayQualified, setTodayQualified] = useState(0);
  const [captadoras, setCaptadoras] = useState<CaptadoraCard[]>([]);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<{ id: string; description: string }[]>([]);
  const [descalMap, setDescalMap] = useState<Record<string, string>>({});
  const [leadSourceMap, setLeadSourceMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [topPatterns, setTopPatterns] = useState<{ text: string; count: number }[]>([]);
  const [weekAnalysisCount, setWeekAnalysisCount] = useState(0);
  const [orgName, setOrgName] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "direccion", "super_admin"]);
      if (!session) return;
      const orgId = session.organizationId;

      const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).single();
      setOrgName(org?.name || "");

      const tz = await getOrgTimezone(orgId);
      const ws = getWeekStart(tz);
      const pws = getPrevWeekStart(tz);
      const ts = getTodayStart(tz);
      const yesterdayStart = new Date(new Date(ts).getTime() - 86400000).toISOString();

      const [teamRes, weekRes, prevRes, todayRes, yesterdayRes, objRes, alertsRes, descalRes, recentRes, leadSourcesRes] = await Promise.all([
        supabase.from("users").select("id, name, role").eq("organization_id", orgId).eq("active", true),
        supabase.from("analyses").select("id, user_id, score_general, categoria_descalificacion, patron_error")
          .eq("organization_id", orgId).eq("status", "completado").gte("created_at", ws),
        supabase.from("analyses").select("user_id, score_general")
          .eq("organization_id", orgId).eq("status", "completado").gte("created_at", pws).lt("created_at", ws),
        supabase.from("analyses").select("user_id, score_general, categoria_descalificacion")
          .eq("organization_id", orgId).eq("status", "completado").gte("created_at", ts),
        supabase.from("analyses").select("id")
          .eq("organization_id", orgId).eq("status", "completado").gte("created_at", yesterdayStart).lt("created_at", ts),
        supabase.from("objectives").select("target_user_id, target_value, type, period_type")
          .eq("organization_id", orgId).eq("is_active", true).eq("type", "volume").in("period_type", ["monthly"]),
        supabase.from("alerts").select("id, description")
          .eq("organization_id", orgId).eq("status", "activa").order("created_at", { ascending: false }).limit(5),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", orgId),
        supabase.from("analyses").select("id, user_id, prospect_name, score_general, clasificacion, categoria_descalificacion, fuente_lead_id, created_at")
          .eq("organization_id", orgId).eq("status", "completado").order("created_at", { ascending: false }).limit(10),
        supabase.from("lead_sources").select("id, name").eq("organization_id", orgId),
      ]);

      setActiveAlerts(alertsRes.data || []);
      const dm: Record<string, string> = {};
      for (const c of descalRes.data || []) dm[c.code] = c.label;
      setDescalMap(dm);
      const lsm: Record<string, string> = {};
      for (const ls of leadSourcesRes.data || []) lsm[ls.id] = ls.name;
      setLeadSourceMap(lsm);

      const caps = (teamRes.data || []).filter(u => u.role === "captadora");
      const capNames: Record<string, string> = {};
      for (const u of teamRes.data || []) capNames[u.id] = u.name;

      const week = weekRes.data || [];
      const prev = prevRes.data || [];
      const today = todayRes.data || [];

      // Today summary
      setTodayCount(today.length);
      setYesterdayCount(yesterdayRes.data?.length || 0);
      const todayScores = today.filter(a => a.score_general !== null).map(a => a.score_general!);
      setTodayAvg(todayScores.length > 0 ? Math.round(todayScores.reduce((a, b) => a + b, 0) / todayScores.length) : null);
      setTodayQualified(today.filter(a => !a.categoria_descalificacion || a.categoria_descalificacion.length === 0).length);

      // Top patterns from this week's analyses
      setWeekAnalysisCount(week.length);
      const patternCounts: Record<string, number> = {};
      for (const a of week) {
        const raw = (a as { patron_error?: string | null }).patron_error;
        if (raw) {
          const cleaned = raw.replace(/^[-•*]\s*/, "").slice(0, 150).trim();
          if (cleaned) patternCounts[cleaned] = (patternCounts[cleaned] || 0) + 1;
        }
      }
      const sorted = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
      setTopPatterns(sorted.map(([text, count]) => ({ text, count })));

      // Per-user stats
      const weekByUser: Record<string, number[]> = {};
      const prevByUser: Record<string, number[]> = {};
      const todayByUser: Record<string, number> = {};

      for (const a of week) { if (a.score_general !== null) { if (!weekByUser[a.user_id]) weekByUser[a.user_id] = []; weekByUser[a.user_id].push(a.score_general); } }
      for (const a of prev) { if (a.score_general !== null) { if (!prevByUser[a.user_id]) prevByUser[a.user_id] = []; prevByUser[a.user_id].push(a.score_general); } }
      for (const a of today) { todayByUser[a.user_id] = (todayByUser[a.user_id] || 0) + 1; }

      const globalObj = (objRes.data || []).find(o => !o.target_user_id);
      const objByUser: Record<string, number> = {};
      for (const o of objRes.data || []) { if (o.target_user_id) objByUser[o.target_user_id] = o.target_value; }

      const cards: CaptadoraCard[] = caps.map(u => {
        const ws2 = weekByUser[u.id] || [];
        const ps = prevByUser[u.id] || [];
        const thisAvg = ws2.length > 0 ? Math.round(ws2.reduce((a, b) => a + b, 0) / ws2.length) : 0;
        const prevA = ps.length > 0 ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
        const target = objByUser[u.id] || (globalObj?.target_value ?? null);
        const dailyTarget = target !== null ? Math.max(1, Math.ceil(target / 22)) : null;
        const dailyDone = todayByUser[u.id] || 0;
        let status: "green" | "yellow" | "red" | "none" = "none";
        if (dailyTarget !== null) {
          const pct = dailyDone / dailyTarget;
          status = pct >= 1 ? "green" : pct >= 0.5 ? "yellow" : "red";
        }
        return { userId: u.id, name: u.name, avgScore: thisAvg, count: ws2.length, delta: prevA !== null && ws2.length > 0 ? thisAvg - prevA : null, dailyDone, dailyTarget, status };
      });

      // Sort by score desc for ranking
      cards.sort((a, b) => b.avgScore - a.avgScore);
      setCaptadoras(cards);

      // Recent calls
      setRecentCalls((recentRes.data || []).map(a => ({
        ...a,
        userName: capNames[a.user_id] || "—",
      })));

      // Auto-insights
      const ins: Insight[] = [];
      for (const c of cards) {
        if (c.delta !== null && c.delta < -10) ins.push({ icon: "⚠️", text: `${c.name} bajó ${Math.abs(c.delta)} pts esta semana — revisar llamadas` });
        if (c.delta !== null && c.delta > 10 && c.count >= 3) ins.push({ icon: "🎯", text: `${c.name} subió ${c.delta} pts esta semana — buen progreso` });
      }
      // Descal frequency
      const descalCounts: Record<string, number> = {};
      for (const a of week) { for (const code of a.categoria_descalificacion || []) descalCounts[code] = (descalCounts[code] || 0) + 1; }
      const topDescal = Object.entries(descalCounts).sort((a, b) => b[1] - a[1])[0];
      if (topDescal && topDescal[1] >= 3) {
        ins.push({ icon: "📉", text: `${topDescal[1]} leads descartados por "${dm[topDescal[0]] || topDescal[0]}" esta semana` });
      }
      setInsights(ins.slice(0, 4));

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block" style={{height:80}}/></div></div>);

  const statusEmoji = { green: "🟢", yellow: "🟡", red: "🔴", none: "⚙️" };
  const todayDelta = todayCount - yesterdayCount;

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g1-header">
          <h1 className="g1-title">Dashboard — {orgName}</h1>
        </div>

        {/* Alerts */}
        {activeAlerts.length > 0 && (
          <div className="a1-alert-banner" style={{ marginBottom: 14 }}>
            <span className="a1-alert-banner-icon">⚡</span>
            <div className="a1-alert-banner-text">
              <strong>{activeAlerts.length} alerta{activeAlerts.length > 1 ? "s" : ""}</strong>
              {" — "}{activeAlerts[0].description?.slice(0, 100) || "Revisar alertas"}
            </div>
          </div>
        )}

        {/* Today summary */}
        <div className="g1-today-card">
          <span className="g1-today-label">Hoy</span>
          <div className="g1-today-stats">
            <span>{todayCount} llamadas</span>
            <span>Score: {todayAvg ?? "—"}</span>
            <span>{todayQualified}/{todayCount} calificados</span>
          </div>
          {todayDelta !== 0 && (
            <span className={`g1-today-delta ${todayDelta > 0 ? "g1-delta-up" : "g1-delta-down"}`}>
              {todayDelta > 0 ? "+" : ""}{todayDelta} vs ayer
            </span>
          )}
        </div>

        {/* Auto insights */}
        {insights.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Insights</h2>
            <div className="g1-insights">
              {insights.map((ins, i) => (
                <div key={i} className="g1-insight-row">
                  <span className="g1-insight-icon">{ins.icon}</span>
                  <span className="g1-insight-text">{ins.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ranking */}
        <div className="g1-section">
          <h2 className="g1-section-title">Ranking de la semana</h2>
          <div className="g1-traffic">
            {captadoras.map((c, i) => (
              <a key={c.userId} href={`/equipo/captadora/${c.userId}`} className="g1-traffic-card" style={{ textDecoration: "none", color: "inherit" }}>
                <span className="g1-rank">#{i + 1}</span>
                <span className="g1-traffic-status">{statusEmoji[c.status]}</span>
                <div className="g1-traffic-info">
                  <span className="g1-traffic-name">{c.name}</span>
                  <span className="g1-traffic-detail">
                    {c.count} llamadas · Score: {c.avgScore}
                    {c.delta !== null && (
                      <span className={c.delta > 0 ? "g1-delta-up" : c.delta < 0 ? "g1-delta-down" : ""}>
                        {" "}{c.delta > 0 ? "↑" : c.delta < 0 ? "↓" : ""}{Math.abs(c.delta)}
                      </span>
                    )}
                    {c.dailyTarget !== null ? ` · Hoy: ${c.dailyDone}/${c.dailyTarget}` : ""}
                  </span>
                </div>
              </a>
            ))}
            {captadoras.length === 0 && <p className="g1-empty">No hay captadoras registradas.</p>}
          </div>
        </div>

        {/* Recent calls */}
        {/* Top patterns this week */}
        <div className="g1-section">
          <h2 className="g1-section-title">Patrones más frecuentes esta semana</h2>
          {weekAnalysisCount < 5 ? (
            <p className="g1-patterns-empty">Datos insuficientes aún ({weekAnalysisCount} análisis esta semana)</p>
          ) : topPatterns.length === 0 ? (
            <p className="g1-patterns-empty">Sin patrones detectados esta semana</p>
          ) : (
            <div className="g1-patterns-list">
              {topPatterns.map((p, i) => (
                <div key={i} className="g1-pattern-row">
                  <span className="g1-pattern-count">{p.count}x</span>
                  <span className="g1-pattern-text">{p.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {recentCalls.length > 0 && (
          <div className="g1-section">
            <h2 className="g1-section-title">Últimas llamadas del equipo</h2>
            <div className="c4-list">
              {recentCalls.map(a => {
                const time = new Date(a.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
                const day = new Date(a.created_at).toLocaleDateString("es-MX", { weekday: "short", day: "numeric" });
                const codes = a.categoria_descalificacion || [];
                return (
                  <a key={a.id} href={`/equipo/analisis/${a.id}`} className="c4-item" style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="c4-item-left">
                      <span className="c4-item-date">{a.userName} · {a.prospect_name || "Prospecto"}</span>
                      <span className="c4-item-source">
                        {day} {time}
                        {" · "}{codes.length > 0 ? (
                          <span className="c1-pill-inline c1-pill-red">{descalMap[codes[0]] || codes[0]}</span>
                        ) : (
                          <span className="c1-pill-inline c1-pill-green">Calificado</span>
                        )}
                        {" · "}<span className="g1-fuente-badge">{a.fuente_lead_id ? (leadSourceMap[a.fuente_lead_id] || "Fuente") : "Sin fuente"}</span>
                      </span>
                    </div>
                    <div className="c4-item-right">
                      {a.score_general !== null && (
                        <span className={`c4-item-score c4-score-${a.clasificacion || "regular"}`}>{a.score_general}</span>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
