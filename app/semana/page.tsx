"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import { getOrgTimezone, weekStart as getWeekStart, prevWeekStart as getPrevWeekStart } from "../../lib/dates";
import { stripJson } from "../../lib/text";

interface Analysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  created_at: string;
  objecion_principal: string | null;
  siguiente_accion: string | null;
  prospect_name: string | null;
  prospect_zone: string | null;
  property_type: string | null;
  categoria_descalificacion: string[] | null;
  checklist_results: { field: string; covered: boolean }[] | null;
}

export default function MiSemanaPage() {
  const [weekAnalyses, setWeekAnalyses] = useState<Analysis[]>([]);
  const [prevAvg, setPrevAvg] = useState<number | null>(null);
  const [descalMap, setDescalMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;

      const tz = await getOrgTimezone(session.organizationId);
      const ws = getWeekStart(tz);
      const pws = getPrevWeekStart(tz);

      const [weekRes, prevRes, descalRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, score_general, clasificacion, created_at, objecion_principal, siguiente_accion, prospect_name, prospect_zone, property_type, categoria_descalificacion, checklist_results")
          .eq("user_id", session.userId).eq("organization_id", session.organizationId).eq("status", "completado")
          .gte("created_at", ws)
          .order("created_at", { ascending: false }),
        supabase.from("analyses")
          .select("score_general")
          .eq("user_id", session.userId).eq("organization_id", session.organizationId).eq("status", "completado")
          .gte("created_at", pws).lt("created_at", ws),
        supabase.from("descalification_categories")
          .select("code, label")
          .eq("organization_id", session.organizationId),
      ]);

      setWeekAnalyses(weekRes.data || []);

      const dm: Record<string, string> = {};
      for (const c of descalRes.data || []) dm[c.code] = c.label;
      setDescalMap(dm);

      const prevScores = (prevRes.data || []).filter(a => a.score_general !== null).map(a => a.score_general!);
      setPrevAvg(prevScores.length >= 2 ? Math.round(prevScores.reduce((a, b) => a + b, 0) / prevScores.length) : null);

      setLoading(false);
    }
    load();
  }, []);

  const weekScores = weekAnalyses.filter(a => a.score_general !== null).map(a => a.score_general!);
  const weekAvg = weekScores.length >= 1 ? Math.round(weekScores.reduce((a, b) => a + b, 0) / weekScores.length) : null;
  const delta = weekAvg !== null && prevAvg !== null ? weekAvg - prevAvg : null;
  const qualified = weekAnalyses.filter(a => !a.categoria_descalificacion || a.categoria_descalificacion.length === 0).length;

  // Daily chart data — group by day
  const dayNames = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const dailyData: Record<number, number[]> = {};
  for (const a of weekAnalyses) {
    if (a.score_general !== null) {
      const day = new Date(a.created_at).getDay();
      if (!dailyData[day]) dailyData[day] = [];
      dailyData[day].push(a.score_general);
    }
  }

  // Build 7-day chart points
  const today = new Date().getDay();
  const chartPoints: { day: string; avg: number | null; min: number; max: number; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = (today - i + 7) % 7;
    const scores = dailyData[d] || [];
    chartPoints.push({
      day: dayNames[d],
      avg: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      min: scores.length > 0 ? Math.min(...scores) : 0,
      max: scores.length > 0 ? Math.max(...scores) : 0,
      count: scores.length,
    });
  }

  // Top 3 missed fields from checklist
  const missCounts: Record<string, number> = {};
  for (const a of weekAnalyses) {
    if (!a.checklist_results) continue;
    for (const item of a.checklist_results) {
      if (!item.covered) missCounts[item.field] = (missCounts[item.field] || 0) + 1;
    }
  }
  const topMissed = Object.entries(missCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, count]) => count >= 2);

  if (loading) {
    return (
      <div className="container c4-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-textarea" />
      </div>
    );
  }

  // SVG chart
  const chartW = 320;
  const chartH = 120;
  const pad = 24;
  const plotW = chartW - pad * 2;
  const plotH = chartH - pad;
  const hasChart = chartPoints.some(p => p.avg !== null);

  const svgPoints = chartPoints.map((p, i) => ({
    x: pad + (i / 6) * plotW,
    y: p.avg !== null ? pad + plotH - (p.avg / 100) * plotH : null,
    minY: p.count > 1 ? pad + plotH - (p.min / 100) * plotH : null,
    maxY: p.count > 1 ? pad + plotH - (p.max / 100) * plotH : null,
  }));

  const linePath = svgPoints.filter(p => p.y !== null).map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <div className="container c4-container">
      <h1 className="c4-greeting">Mi Semana</h1>

      {/* Summary card */}
      <div className="c4-stats">
        <div className="c4-stat-card">
          <span className="c4-stat-value">{weekAnalyses.length}</span>
          <span className="c4-stat-label">Llamadas</span>
        </div>
        <div className="c4-stat-card">
          <span className="c4-stat-value">
            {weekAvg ?? "—"}
            {delta !== null && (
              <span className={`c1-delta ${delta > 0 ? "g1-delta-up" : delta < 0 ? "g1-delta-down" : ""}`}>
                {delta > 0 ? "+" : ""}{delta}
              </span>
            )}
          </span>
          <span className="c4-stat-label">Score prom.</span>
        </div>
        <div className="c4-stat-card">
          <span className="c4-stat-value">{qualified}/{weekAnalyses.length}</span>
          <span className="c4-stat-label">Calificados</span>
        </div>
      </div>

      {/* Score evolution chart */}
      {hasChart && (
        <div className="c4-chart-section">
          <p className="c4-list-title">Evolución de score</p>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="c4-svg-chart">
            {/* Grid lines */}
            {[25, 50, 75].map(v => {
              const y = pad + plotH - (v / 100) * plotH;
              return <line key={v} x1={pad} y1={y} x2={chartW - pad} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth="1" />;
            })}
            {/* Range areas */}
            {svgPoints.map((p, i) => (
              p.minY !== null && p.maxY !== null && p.y !== null ? (
                <rect key={`r${i}`} x={p.x - 3} y={p.maxY} width={6} height={p.minY - p.maxY} rx={2} fill="rgba(200,168,75,0.15)" />
              ) : null
            ))}
            {/* Line */}
            {linePath && <path d={linePath} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
            {/* Points */}
            {svgPoints.map((p, i) => (
              p.y !== null ? <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--gold)" /> : null
            ))}
            {/* Day labels */}
            {chartPoints.map((p, i) => (
              <text key={`l${i}`} x={svgPoints[i].x} y={chartH - 2} textAnchor="middle" fontSize="9" fill="var(--ink-light)" fontFamily="DM Sans">{p.day}</text>
            ))}
            {/* Score labels */}
            {svgPoints.map((p, i) => (
              p.y !== null ? (
                <text key={`s${i}`} x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fill="var(--ink)" fontWeight="600" fontFamily="DM Sans">
                  {chartPoints[i].avg}
                </text>
              ) : null
            ))}
          </svg>
        </div>
      )}

      {/* Top 3 missed fields */}
      {topMissed.length > 0 && (
        <div className="c4-missed-section">
          <p className="c4-list-title">Áreas de mejora esta semana</p>
          <div className="c4-missed-list">
            {topMissed.map(([field, count], i) => (
              <div key={i} className="c4-missed-item">
                <span className="c4-missed-field">{field}</span>
                <span className="c4-missed-count">{count}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly call list */}
      {weekAnalyses.length > 0 && (
        <div className="c4-list-section">
          <p className="c4-list-title">Todas las llamadas</p>
          <div className="c4-list">
            {weekAnalyses.map((a) => {
              const date = new Date(a.created_at);
              const dayTime = `${date.toLocaleDateString("es-MX", { weekday: "short", day: "numeric" })} ${date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
              const label = [a.prospect_name, a.prospect_zone, a.property_type].filter(Boolean).join(" · ") || dayTime;
              const codes = a.categoria_descalificacion || [];
              const hasDescal = codes.length > 0;
              return (
                <a key={a.id} href={`/analisis/${a.id}`} className="c4-item">
                  <div className="c4-item-left">
                    <span className="c4-item-date">{label}</span>
                    <span className="c4-item-source">
                      {dayTime} · {hasDescal ? (
                        <span className="c1-pill-inline c1-pill-red">{descalMap[codes[0]] || codes[0]}</span>
                      ) : (
                        <span className="c1-pill-inline c1-pill-green">Calificado</span>
                      )}
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

      {weekAnalyses.length === 0 && (
        <div className="c4-empty">
          <p className="c4-empty-title">No tienes análisis esta semana</p>
          <Link href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 12 }}>
            Hacer mi primera llamada
          </Link>
        </div>
      )}

      <Link href="/analisis" className="c5-back-link">Volver a Mi día</Link>
    </div>
  );
}
