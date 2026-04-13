"use client";

import { useState, useEffect, use } from "react";
import { supabase } from "../../../../lib/supabase";
import { requireAuth } from "../../../../lib/auth";
import { stripJson } from "../../../../lib/text";

interface AnalysisRow { id: string; score_general: number | null; clasificacion: string | null; created_at: string; categoria_descalificacion: string[] | null; patron_error: string | null; siguiente_accion: string | null; prospect_name: string | null; funnel_stage_id: string | null; property_type: string | null; business_type: string | null; }
interface PhaseRow { phase_name: string; score: number; score_max: number; analysis_id: string; }
interface DescalCat { code: string; label: string; }

type Tab = "hoy" | "progreso" | "objetivos" | "coaching";

export default function PerfilCaptadoraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState("");
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [phases, setPhases] = useState<PhaseRow[]>([]);
  const [descalMap, setDescalMap] = useState<Record<string, string>>({});
  const [stageMap, setStageMap] = useState<Record<string, string>>({});
  const [teamAvgByPhase, setTeamAvgByPhase] = useState<Record<string, number>>({});
  const [objectives, setObjectives] = useState<{ name: string; target_value: number; current_value: number; is_active: boolean }[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("hoy");
  const [dailyDone, setDailyDone] = useState(0);
  const [dailyTarget, setDailyTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["gerente", "direccion", "super_admin"]);
      if (!session) return;
      const me = { organization_id: session.organizationId };

      const { data: captadora } = await supabase.from("users").select("name").eq("id", id).single();
      if (!captadora) { setError("No encontrada."); setLoading(false); return; }
      setName(captadora.name);

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const [analysesRes, phasesRes, descalRes, teamPhasesRes, objRes, todayRes, stagesRes] = await Promise.all([
        supabase.from("analyses").select("id, score_general, clasificacion, created_at, categoria_descalificacion, patron_error, siguiente_accion, prospect_name, funnel_stage_id, property_type, business_type")
          .eq("user_id", id).eq("organization_id", me.organization_id).eq("status", "completado").order("created_at", { ascending: false }).limit(100),
        supabase.from("analysis_phases").select("phase_name, score, score_max, analysis_id")
          .eq("user_id", id).eq("organization_id", me.organization_id).order("created_at", { ascending: false }).limit(500),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", me.organization_id),
        supabase.from("analysis_phases").select("phase_name, score, score_max").eq("organization_id", me.organization_id).limit(1000),
        supabase.from("objectives").select("id, target_value, type, period_type, is_active, target_phase_id")
          .eq("organization_id", me.organization_id).eq("is_active", true)
          .or(`target_user_id.eq.${id},target_user_id.is.null`),
        supabase.from("analyses").select("id").eq("user_id", id).eq("organization_id", me.organization_id).eq("status", "completado").gte("created_at", todayStart.toISOString()),
        supabase.from("funnel_stages").select("id, name").eq("organization_id", me.organization_id).eq("active", true),
      ]);

      setAnalyses(analysesRes.data || []);
      setPhases(phasesRes.data || []);
      setDailyDone((todayRes.data || []).length);

      const dm: Record<string, string> = {};
      for (const c of (descalRes.data || []) as DescalCat[]) dm[c.code] = c.label;
      setDescalMap(dm);
      const sm: Record<string, string> = {};
      for (const s of stagesRes.data || []) sm[s.id] = s.name;
      setStageMap(sm);

      // Team avg by phase
      const phaseAcc: Record<string, { total: number; max: number }> = {};
      for (const p of teamPhasesRes.data || []) {
        if (!phaseAcc[p.phase_name]) phaseAcc[p.phase_name] = { total: 0, max: 0 };
        phaseAcc[p.phase_name].total += p.score; phaseAcc[p.phase_name].max += p.score_max;
      }
      const tavg: Record<string, number> = {};
      for (const [k, v] of Object.entries(phaseAcc)) tavg[k] = v.max > 0 ? v.total / v.max : 0;
      setTeamAvgByPhase(tavg);

      // Objectives
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const monthAnalyses = (analysesRes.data || []).filter(a => new Date(a.created_at) >= monthStart);
      const monthScores = monthAnalyses.filter(a => a.score_general !== null).map(a => a.score_general!);
      const monthAvg = monthScores.length > 0 ? Math.round(monthScores.reduce((a, b) => a + b, 0) / monthScores.length) : 0;

      const objs = (objRes.data || []).map(o => {
        let currentValue = 0;
        if (o.type === "volume") currentValue = monthAnalyses.length;
        else if (o.type === "score") currentValue = monthAvg;
        return { name: `${o.type === "volume" ? "Análisis" : "Score"} ${o.period_type}`, target_value: o.target_value, current_value: currentValue, is_active: o.is_active };
      });
      setObjectives(objs);

      const volObj = (objRes.data || []).find(o => o.type === "volume");
      if (volObj) setDailyTarget(Math.max(1, Math.ceil(volObj.target_value / 22)));

      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return (<div className="g1-wrapper"><div className="g1-container"><div className="skeleton-block skeleton-title" /><div className="skeleton-block skeleton-textarea" /></div></div>);
  if (error) return (<div className="g1-wrapper"><div className="g1-container"><div className="message-box message-error"><p>{error}</p></div></div></div>);

  const initial = name.charAt(0).toUpperCase();
  const allScores = analyses.filter(a => a.score_general !== null).map(a => a.score_general!);
  const avgAll = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null;
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentScores = analyses.filter(a => a.score_general !== null && new Date(a.created_at) >= thirtyDaysAgo).map(a => a.score_general!);
  const avg30 = recentScores.length > 0 ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length) : null;

  // User phase averages for opportunity
  const userPhaseAcc: Record<string, { total: number; max: number }> = {};
  for (const p of phases) { if (!userPhaseAcc[p.phase_name]) userPhaseAcc[p.phase_name] = { total: 0, max: 0 }; userPhaseAcc[p.phase_name].total += p.score; userPhaseAcc[p.phase_name].max += p.score_max; }
  let opportunityPhase: string | null = null; let biggestGap = 0;
  for (const [pn, acc] of Object.entries(userPhaseAcc)) { const ur = acc.max > 0 ? acc.total / acc.max : 0; const tr = teamAvgByPhase[pn] || 0; const gap = tr - ur; if (gap > biggestGap) { biggestGap = gap; opportunityPhase = pn; } }

  // Comparativa before/after — only if 5+ in each period
  const oldAnalyses = analyses.filter(a => new Date(a.created_at) < thirtyDaysAgo);
  const newAnalyses = analyses.filter(a => new Date(a.created_at) >= thirtyDaysAgo);
  const showComparison = oldAnalyses.length >= 5 && newAnalyses.length >= 5;

  const phaseComparison: { phase: string; before: number; after: number }[] = [];
  if (showComparison) {
    const oldIds = new Set(oldAnalyses.map(a => a.id));
    const newIds = new Set(newAnalyses.map(a => a.id));
    const phaseNames = [...new Set(phases.map(p => p.phase_name))];
    for (const pn of phaseNames) {
      const oldP = phases.filter(p => p.phase_name === pn && oldIds.has(p.analysis_id));
      const newP = phases.filter(p => p.phase_name === pn && newIds.has(p.analysis_id));
      if (oldP.length > 0 && newP.length > 0) {
        const before = Math.round((oldP.reduce((s, p) => s + p.score, 0) / oldP.reduce((s, p) => s + p.score_max, 0)) * 100);
        const after = Math.round((newP.reduce((s, p) => s + p.score, 0) / newP.reduce((s, p) => s + p.score_max, 0)) * 100);
        phaseComparison.push({ phase: pn, before, after });
      }
    }
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayAnalyses = analyses.filter(a => new Date(a.created_at) >= todayStart);

  const tabs: { key: Tab; label: string }[] = [
    { key: "hoy", label: "Hoy" },
    { key: "progreso", label: "Progreso" },
    { key: "objetivos", label: "Objetivos" },
    { key: "coaching", label: "Coaching" },
  ];

  return (
    <div className="g1-wrapper">
      <div className="g1-container">
        <div className="g2-header">
          <div className="g2-avatar">{initial}</div>
          <div>
            <h1 className="g1-title">{name}</h1>
            <div className="g2-score-row">
              {avgAll !== null && <span className="g2-score-pill">Histórico: {avgAll}</span>}
              {avg30 !== null && <span className="g2-score-pill">30d: {avg30}</span>}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="g6-tabs">
          {tabs.map(t => (
            <button key={t.key} className={`g6-tab ${activeTab === t.key ? "g6-tab-active" : ""}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Hoy */}
        {activeTab === "hoy" && (
          <>
            <div className="c4-stats" style={{ marginBottom: 16 }}>
              <div className="c4-stat-card"><span className="c4-stat-value">{dailyDone}</span><span className="c4-stat-label">Llamadas hoy</span></div>
              {dailyTarget !== null && (
                <div className="c4-stat-card"><span className="c4-stat-value">{dailyTarget - dailyDone > 0 ? dailyTarget - dailyDone : 0}</span><span className="c4-stat-label">Restantes</span></div>
              )}
            </div>
            {todayAnalyses.length > 0 ? (
              <div className="c4-list">
                {todayAnalyses.slice(0, 10).map(a => {
                  const codes = a.categoria_descalificacion || [];
                  return (
                    <a key={a.id} href={`/equipo/analisis/${a.id}`} className="c4-item" style={{ textDecoration: "none", color: "inherit" }}>
                      <div className="c4-item-left">
                        <span className="c4-item-date">{a.prospect_name || "Sin nombre"}</span>
                        <span className="c4-item-source">
                          {new Date(a.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                          {a.funnel_stage_id && stageMap[a.funnel_stage_id] ? ` · ${stageMap[a.funnel_stage_id]}` : ""}
                          {(a.property_type || a.business_type) ? ` · ${a.property_type || a.business_type}` : ""}
                          {" · "}{codes.length > 0 ? (
                            <span className="c1-pill-inline c1-pill-red">{descalMap[codes[0]] || codes[0]}</span>
                          ) : (
                            <span className="c1-pill-inline c1-pill-green">Calificado</span>
                          )}
                        </span>
                      </div>
                      <div className="c4-item-right">
                        <span className={`c4-item-score c4-score-${a.clasificacion || "regular"}`}>{a.score_general ?? "—"}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            ) : <p className="g1-empty">Sin análisis hoy.</p>}
          </>
        )}

        {/* Tab: Progreso */}
        {activeTab === "progreso" && (
          <>
            {allScores.length >= 3 && (
              <div className="g1-section">
                <h2 className="g1-section-title">Evolución de score</h2>
                <div className="g2-evolution">
                  {analyses.slice(0, 15).reverse().map(a => (
                    <div key={a.id} className="g2-evo-bar-wrap"><div className="g2-evo-bar" style={{ height: `${a.score_general || 0}%` }} /><span className="g2-evo-label">{a.score_general}</span></div>
                  ))}
                </div>
              </div>
            )}
            {showComparison && phaseComparison.length > 0 && (
              <div className="g1-section">
                <h2 className="g1-section-title">Comparativa antes / después (últimos 30 días vs anteriores)</h2>
                <div className="g2-comparison">
                  {phaseComparison.map((c, i) => (
                    <div key={i} className="g2-comp-row">
                      <span className="g2-comp-name">{c.phase}</span>
                      <span className="g2-comp-before">{c.before}%</span>
                      <span className="g2-comp-arrow">→</span>
                      <span className="g2-comp-after" style={{ color: c.after > c.before ? "var(--green)" : c.after < c.before ? "var(--red)" : "var(--ink)" }}>{c.after}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {opportunityPhase && (
              <div className="g1-section">
                <h2 className="g1-section-title">Área de oportunidad</h2>
                <div className="g2-opportunity"><strong>{opportunityPhase}</strong> — mayor brecha vs promedio del equipo ({Math.round(biggestGap * 100)}pp por debajo)</div>
              </div>
            )}
            <div className="g1-section">
              <h2 className="g1-section-title">Historial</h2>
              <div className="c4-list">
                {analyses.slice(0, 20).map(a => {
                  const d = new Date(a.created_at);
                  const primaryDescal = a.categoria_descalificacion?.[0];
                  return (
                    <a key={a.id} href={`/equipo/analisis/${a.id}`} className="c4-item" style={{ textDecoration: "none", color: "inherit" }}>
                      <div className="c4-item-left">
                        <span className="c4-item-date">{d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                        {primaryDescal && <span className="c4-item-source">{descalMap[primaryDescal] || "Razón no reconocida"}</span>}
                        {!primaryDescal && a.patron_error && <span className="c4-item-source">{stripJson(a.patron_error).slice(0, 60)}</span>}
                      </div>
                      <div className="c4-item-right">
                        {a.score_general !== null && <span className={`c4-item-score c4-score-${a.clasificacion || "regular"}`}>{a.score_general}</span>}
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Tab: Objetivos */}
        {activeTab === "objetivos" && (
          <div className="g1-section">
            {objectives.length === 0 ? (
              <p className="g1-empty">No hay objetivos configurados para esta captadora.</p>
            ) : (
              <div className="d1-objectives">
                {objectives.map((o, i) => {
                  const pct = o.target_value > 0 ? Math.min(100, Math.round((o.current_value / o.target_value) * 100)) : 0;
                  return (
                    <div key={i} className="d1-obj-card">
                      <div className="d1-obj-header"><span className="d1-obj-name">{o.name}</span><span className="d1-obj-pct">{o.current_value}/{o.target_value} ({pct}%)</span></div>
                      <div className="c3-phase-bar-bg"><div className="c3-phase-bar-fill" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab: Coaching */}
        {activeTab === "coaching" && (
          <div className="g1-section">
            <h2 className="g1-section-title">Historial de coaching</h2>
            {analyses.filter(a => a.patron_error || a.siguiente_accion).length === 0 ? (
              <p className="g1-empty">Sin datos de coaching aún. Se generan automáticamente con cada análisis.</p>
            ) : (
              <div className="g2-coaching-list">
                {analyses.filter(a => a.patron_error || a.siguiente_accion).slice(0, 15).map(a => {
                  const d = new Date(a.created_at);
                  const error = stripJson(a.patron_error);
                  const accion = stripJson(a.siguiente_accion);
                  if (!error && !accion) return null;
                  return (
                    <div key={a.id} className="g2-coaching-card">
                      <span className="g2-coaching-date">{d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} · Score: {a.score_general ?? "—"}</span>
                      <div className="g2-coaching-row">
                        <span className="g2-coaching-label">Lo que dije:</span>
                        <p>{error || "Sin patrón identificado en esta llamada"}</p>
                      </div>
                      <div className="g2-coaching-row">
                        <span className="g2-coaching-label">Cómo debería decirlo:</span>
                        <p>{accion || "Sin sugerencia específica para esta llamada"}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <a href="/equipo" className="c5-back-link">Volver al dashboard</a>
      </div>
    </div>
  );
}
