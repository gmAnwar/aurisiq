"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";

interface Analysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  created_at: string;
  objecion_principal: string | null;
  siguiente_accion: string | null;
}

export default function MiSemanaPage() {
  const [weekAnalyses, setWeekAnalyses] = useState<Analysis[]>([]);
  const [prevWeekAnalyses, setPrevWeekAnalyses] = useState<{ id: string; score_general: number | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      const now = new Date();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
      const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);

      const [weekRes, prevRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, score_general, clasificacion, created_at, objecion_principal, siguiente_accion")
          .eq("user_id", session.userId).eq("status", "completado")
          .gte("created_at", weekStart.toISOString())
          .order("created_at", { ascending: false }),
        supabase.from("analyses")
          .select("id, score_general")
          .eq("user_id", session.userId).eq("status", "completado")
          .gte("created_at", prevWeekStart.toISOString()).lt("created_at", weekStart.toISOString()),
      ]);

      setWeekAnalyses(weekRes.data || []);
      setPrevWeekAnalyses(prevRes.data || []);
      setLoading(false);
    }
    load();
  }, []);

  const weekScores = weekAnalyses.filter(a => a.score_general !== null).map(a => a.score_general!);
  const weekAvg = weekScores.length >= 2 ? Math.round(weekScores.reduce((a, b) => a + b, 0) / weekScores.length) : null;
  const prevScores = prevWeekAnalyses.filter(a => a.score_general !== null).map(a => a.score_general!);
  const prevAvg = prevScores.length >= 2 ? Math.round(prevScores.reduce((a, b) => a + b, 0) / prevScores.length) : null;
  const delta = weekAvg !== null && prevAvg !== null ? weekAvg - prevAvg : null;

  // Best call
  const best = weekAnalyses.filter(a => a.score_general !== null).sort((a, b) => b.score_general! - a.score_general!)[0] || null;

  // Most frequent objection
  const objCounts: Record<string, { count: number; response: string | null }> = {};
  for (const a of weekAnalyses) {
    if (a.objecion_principal) {
      const cleaned = a.objecion_principal.replace(/^\*+\s*/, "").trim();
      if (cleaned) {
        if (!objCounts[cleaned]) objCounts[cleaned] = { count: 0, response: null };
        objCounts[cleaned].count++;
        if (a.siguiente_accion && !objCounts[cleaned].response) objCounts[cleaned].response = a.siguiente_accion;
      }
    }
  }
  const topObj = Object.entries(objCounts).sort((a, b) => b[1].count - a[1].count)[0] || null;

  // Daily chart — group by day of week
  const dayNames = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const dailyScores: Record<number, number[]> = {};
  for (const a of weekAnalyses) {
    if (a.score_general !== null) {
      const day = new Date(a.created_at).getDay();
      if (!dailyScores[day]) dailyScores[day] = [];
      dailyScores[day].push(a.score_general);
    }
  }
  const dailyChart = Object.entries(dailyScores).map(([day, scores]) => ({
    day: dayNames[parseInt(day)],
    avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    count: scores.length,
  }));

  if (loading) {
    return (
      <div className="container c4-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-select" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  return (
    <div className="container c4-container">
      <div className="c4-header">
        <h1 className="c4-greeting">Mi Semana</h1>
      </div>

      {/* Stats */}
      <div className="c4-stats">
        <div className="c4-stat-card">
          <span className="c4-stat-value">{weekAnalyses.length}</span>
          <span className="c4-stat-label">Llamadas</span>
        </div>
        {weekAvg !== null && (
          <div className="c4-stat-card">
            <span className="c4-stat-value">
              {weekAvg}
              {delta !== null && (
                <span className={`c1-delta ${delta > 0 ? "g1-delta-up" : delta < 0 ? "g1-delta-down" : ""}`}>
                  {delta > 0 ? "+" : ""}{delta}
                </span>
              )}
            </span>
            <span className="c4-stat-label">Score prom.</span>
          </div>
        )}
      </div>

      {/* Best call — dark card like legacy */}
      {best && (
        <a href={`/analisis/${best.id}`} className="c4-best-card" style={{ textDecoration: "none", display: "block" }}>
          <div className="c4-best-lbl">Tu mejor llamada</div>
          <div className="c4-best-score">{best.score_general}</div>
          <div className="c4-best-date">
            {new Date(best.created_at).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" })}
          </div>
          {best.siguiente_accion && (
            <div className="c4-best-quote">{best.siguiente_accion}</div>
          )}
        </a>
      )}

      {/* Most frequent objection */}
      {topObj && (
        <div className="g1-section">
          <p className="c4-list-title">Objeción más frecuente</p>
          <div className="c1-tip">
            <p className="c1-tip-text" style={{ fontWeight: 600 }}>{topObj[0]} ({topObj[1].count}x)</p>
            {topObj[1].response && (
              <p className="c1-tip-text" style={{ marginTop: 8, opacity: 0.8 }}>Mejor respuesta: {topObj[1].response}</p>
            )}
          </div>
        </div>
      )}

      {/* Daily chart */}
      {dailyChart.length >= 3 && (
        <div className="c1-chart-section">
          <p className="c4-list-title">Score por día</p>
          <div className="g2-evolution">
            {dailyChart.map((d, i) => (
              <div key={i} className="g2-evo-bar-wrap">
                <div className="g2-evo-bar" style={{ height: `${d.avg}%` }} />
                <span className="g2-evo-label">{d.avg}</span>
                <span className="g2-evo-label" style={{ fontSize: 10 }}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {weekAnalyses.length === 0 && (
        <div className="c4-empty">
          <p>No tienes análisis esta semana.</p>
          <p>Empieza analizando tu primera llamada.</p>
        </div>
      )}

      {/* Full history */}
      {weekAnalyses.length > 0 && (
        <div className="c4-list-section">
          <p className="c4-list-title">Todas las llamadas</p>
          <div className="c4-list">
            {weekAnalyses.map((a) => {
              const date = new Date(a.created_at);
              return (
                <a key={a.id} href={`/analisis/${a.id}`} className="c4-item">
                  <div className="c4-item-left">
                    <span className="c4-item-date">
                      {date.toLocaleDateString("es-MX", { weekday: "short", day: "numeric" })} {date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
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
  );
}
