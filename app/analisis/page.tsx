"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import EditableField from "../components/EditableName";
import { getSampleAnalyses } from "../../lib/sampleData";
import { getOrgTimezone, todayStart, monthStart as getMonthStart, todayDisplay } from "../../lib/dates";
import { stripJson } from "../../lib/text";

interface Analysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  created_at: string;
  fuente_lead_id: string | null;
  patron_error: string | null;
  siguiente_accion: string | null;
  categoria_descalificacion: string[] | null;
  prospect_name: string | null;
  prospect_zone: string | null;
  property_type: string | null;
  manager_note: string | null;
}

export default function MiDiaPage() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [leadSources, setLeadSources] = useState<Record<string, string>>({});
  const [descalMap, setDescalMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [streak, setStreak] = useState(0);
  const [tipTitle, setTipTitle] = useState<string | null>(null);
  const [tipFull, setTipFull] = useState<string | null>(null);
  const [tipFrase, setTipFrase] = useState<string | null>(null);
  const [tipExpanded, setTipExpanded] = useState(false);
  const [monthlyTarget, setMonthlyTarget] = useState<number | null>(null);
  const [monthlyDone, setMonthlyDone] = useState(0);
  const [orgTz, setOrgTz] = useState("America/Monterrey");
  const [ranking, setRanking] = useState<{ pos: number; total: number } | null>(null);
  const [focusPhase, setFocusPhase] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setUserName(session.name);

      const [analysesRes, sourcesRes, userRes, descalRes, objRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, score_general, clasificacion, created_at, fuente_lead_id, patron_error, siguiente_accion, categoria_descalificacion, prospect_name, prospect_zone, property_type, manager_note")
          .eq("user_id", session.userId).eq("organization_id", session.organizationId).eq("status", "completado")
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("lead_sources").select("id, name").eq("organization_id", session.organizationId),
        supabase.from("users").select("current_streak, current_focus_phase").eq("id", session.userId).single(),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", session.organizationId),
        supabase.from("objectives").select("target_value, type, period_type")
          .eq("organization_id", session.organizationId).eq("is_active", true)
          .eq("type", "volume").in("period_type", ["monthly"])
          .or(`target_user_id.eq.${session.userId},target_user_id.is.null`)
          .order("target_user_id", { ascending: false, nullsFirst: false })
          .limit(1),
      ]);

      const realAnalyses = analysesRes.data || [];
      let all = realAnalyses;
      if (realAnalyses.length === 0) {
        all = getSampleAnalyses(session.organizationSlug);
        setUsingSampleData(true);
      }
      setAnalyses(all);
      setStreak(userRes.data?.current_streak || 0);
      setFocusPhase(userRes.data?.current_focus_phase || null);

      const sm: Record<string, string> = {};
      for (const s of sourcesRes.data || []) sm[s.id] = s.name;
      setLeadSources(sm);

      const dm: Record<string, string> = {};
      for (const c of descalRes.data || []) dm[c.code] = c.label;
      setDescalMap(dm);

      // Org timezone for date calculations
      const tz = await getOrgTimezone(session.organizationId);
      setOrgTz(tz);
      const mStart = getMonthStart(tz);

      // Monthly objective
      if (objRes.data && objRes.data.length > 0) {
        setMonthlyTarget(objRes.data[0].target_value);
        const thisMonthCount = all.filter(a => new Date(a.created_at) >= new Date(mStart)).length;
        setMonthlyDone(thisMonthCount);
      }

      // Tip from last 7 days — short title from patron_error, phrase from siguiente_accion
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const errors: Record<string, { count: number; analysisId: string }> = {};
      for (const a of all) {
        if (a.patron_error && new Date(a.created_at) >= weekAgo) {
          const cleaned = stripJson(a.patron_error.replace(/^[-•*]\s*/, ""));
          if (cleaned && !errors[cleaned]) {
            errors[cleaned] = { count: 0, analysisId: a.id };
          }
          if (cleaned) errors[cleaned].count++;
        }
      }
      const topErr = Object.entries(errors).sort((a, b) => b[1].count - a[1].count)[0];
      if (topErr) {
        const full = topErr[0];
        setTipFull(full);
        // Limit tip title to ~120 chars, cut at last sentence boundary
        let title = full;
        if (title.length > 120) {
          const cut = title.slice(0, 120);
          const lastPunct = Math.max(cut.lastIndexOf("."), cut.lastIndexOf(","), cut.lastIndexOf(";"));
          title = lastPunct > 40 ? cut.slice(0, lastPunct + 1) : cut.slice(0, cut.lastIndexOf(" "));
        }
        setTipTitle(title);
        const srcAnalysis = all.find(a => a.id === topErr[1].analysisId);
        if (srcAnalysis?.siguiente_accion) {
          setTipFrase(stripJson(srcAnalysis.siguiente_accion));
        }
      }

      // Ranking: compare avg score this week vs teammates
      const weekAgoRank = new Date();
      weekAgoRank.setDate(weekAgoRank.getDate() - 7);
      const { data: teamCaptadoras } = await supabase.from("users").select("id")
        .eq("organization_id", session.organizationId).eq("role", "captadora").eq("active", true);
      if (teamCaptadoras && teamCaptadoras.length > 1) {
        const ids = teamCaptadoras.map(u => u.id);
        const { data: teamAnalyses } = await supabase.from("analyses")
          .select("user_id, score_general")
          .in("user_id", ids).eq("status", "completado")
          .gte("created_at", weekAgoRank.toISOString())
          .not("score_general", "is", null);
        if (teamAnalyses) {
          const avgByUser: Record<string, { sum: number; count: number }> = {};
          for (const a of teamAnalyses) {
            if (!avgByUser[a.user_id]) avgByUser[a.user_id] = { sum: 0, count: 0 };
            avgByUser[a.user_id].sum += a.score_general!;
            avgByUser[a.user_id].count++;
          }
          const avgs = Object.entries(avgByUser).map(([uid, v]) => ({ uid, avg: v.sum / v.count }));
          avgs.sort((a, b) => b.avg - a.avg);
          const myAvg = avgByUser[session.userId];
          if (myAvg) {
            const myScore = myAvg.sum / myAvg.count;
            const pos = avgs.filter(a => a.avg > myScore).length + 1;
            setRanking({ pos, total: ids.length });
          }
        }
      }

      setLoading(false);
    }
    load();
  }, []);

  const updateName = useCallback((id: string, newName: string) => {
    setAnalyses(prev => prev.map(a => a.id === id ? { ...a, prospect_name: newName } : a));
  }, []);

  const todayStr = todayDisplay(orgTz);
  const tStart = todayStart(orgTz);
  const todayAnalyses = analyses.filter(a => new Date(a.created_at) >= new Date(tStart));

  // Daily target from monthly (divide by ~22 working days)
  const dailyTarget = monthlyTarget !== null ? Math.max(1, Math.ceil(monthlyTarget / 22)) : null;
  const dailyDone = todayAnalyses.length;
  const dailyComplete = dailyTarget !== null && dailyDone >= dailyTarget;
  const dailyPct = dailyTarget !== null ? Math.min(100, Math.round((dailyDone / dailyTarget) * 100)) : 0;

  // Daily score avg (only show if 2+)
  const todayScores = todayAnalyses.filter(a => a.score_general !== null).map(a => a.score_general!);
  const dailyAvg = todayScores.length >= 2 ? Math.round(todayScores.reduce((a, b) => a + b, 0) / todayScores.length) : null;

  // Last 5 calls today, with prospect call counts
  const last5 = todayAnalyses.slice(0, 5);
  const prospectCounts: Record<string, number> = {};
  for (const a of todayAnalyses) {
    const key = a.prospect_name?.toLowerCase().trim();
    if (key) prospectCounts[key] = (prospectCounts[key] || 0) + 1;
  }

  // Qualified count today
  const todayQualified = todayAnalyses.filter(a => !a.categoria_descalificacion || a.categoria_descalificacion.length === 0).length;

  // Yesterday's calls
  const yStart = new Date(new Date(tStart).getTime() - 86400000).toISOString();
  const yesterdayAnalyses = analyses.filter(a => {
    const t = new Date(a.created_at);
    return t >= new Date(yStart) && t < new Date(tStart);
  });

  // Score chart (last 10)
  const chartData = analyses.filter(a => a.score_general !== null).slice(0, 10).reverse();

  if (loading) {
    return (
      <div className="container c4-container">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-block skeleton-select" />
        <div className="skeleton-block skeleton-textarea" />
        <div className="skeleton-block skeleton-select" />
      </div>
    );
  }

  return (
    <div className="container c4-container">
      <div className="c4-header">
        <h1 className="c4-greeting">Hola, {userName}</h1>
        <p className="c4-date">{todayStr}</p>
        {streak > 0 && <span className="c1-streak">{streak} día{streak > 1 ? "s" : ""} de racha</span>}
      </div>

      {/* Sample data banner */}
      {usingSampleData && (
        <div className="c1-sample-banner">
          <p className="c1-sample-text">Estos son datos de ejemplo — cuando analices tu primera llamada aparecerán tus resultados reales</p>
          <Link href="/analisis/nueva" className="c1-sample-cta">Analizar primera llamada →</Link>
        </div>
      )}

      {/* Activity progress */}
      {dailyTarget !== null ? (
        <div className="c1-activity">
          {dailyComplete ? (
            <p className="c1-quota-done">Cuota de hoy completa</p>
          ) : (
            <>
              <div className="c1-activity-header">
                <span className="c1-activity-count">{dailyDone} / {dailyTarget} llamadas hoy</span>
              </div>
              <div className="c1-progress-bg">
                <div className="c1-progress-fill" style={{ width: `${dailyPct}%` }} />
              </div>
              {monthlyTarget !== null && (
                <p className="c1-activity-context">
                  Para llegar a tu objetivo de {monthlyTarget} análisis este mes ({monthlyDone} completados)
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="c1-no-objective-card">
          <p className="c1-no-objective-text">Tu gerente aún no ha configurado tu objetivo del mes</p>
          <p className="c1-no-objective-hint">Mientras tanto, sigue grabando llamadas para mejorar tu score</p>
        </div>
      )}

      {/* Daily stats — 3-4 metrics */}
      {todayAnalyses.length > 0 && (
        <div className="c4-stats">
          <div className="c4-stat-card">
            <span className="c4-stat-value">{todayAnalyses.length}</span>
            <span className="c4-stat-label">Llamadas</span>
          </div>
          <div className="c4-stat-card">
            <span className="c4-stat-value">{dailyAvg !== null ? dailyAvg : "—"}</span>
            <span className="c4-stat-label">Score prom.</span>
          </div>
          <div className="c4-stat-card">
            <span className="c4-stat-value">{todayQualified}/{todayAnalyses.length}</span>
            <span className="c4-stat-label">Calificados</span>
          </div>
          {ranking && (
            <div className="c4-stat-card">
              <span className="c4-stat-value">#{ranking.pos}</span>
              <span className="c4-stat-label">de {ranking.total}</span>
            </div>
          )}
        </div>
      )}

      {/* Focus phase — area de mejora */}
      {focusPhase && (
        <div className="c1-focus-card">
          <span className="c1-focus-label">Tu enfoque esta semana</span>
          <span className="c1-focus-phase">{focusPhase}</span>
        </div>
      )}

      {/* Tip del día — dark coach card */}
      {tipTitle && (
        <div className="tip-card">
          <div className="tip-lbl">Tu tip del día</div>
          <div className={`tip-title ${tipExpanded ? "tip-title-expanded" : ""}`}>
            {tipExpanded ? tipFull : tipTitle}
          </div>
          {tipFull && tipFull.length > 120 && (
            <button className="tip-toggle" onClick={() => setTipExpanded(!tipExpanded)}>
              {tipExpanded ? "Leer menos \u2191" : "Leer más \u2193"}
            </button>
          )}
          {tipFrase && <div className="tip-frase">{tipFrase}</div>}
        </div>
      )}

      {/* Last 5 calls today */}
      {last5.length > 0 && (
        <div className="c4-list-section">
          <p className="c4-list-title">Llamadas de hoy</p>
          <div className="c4-list">
            {last5.map((a) => {
              const time = new Date(a.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
              const codes = a.categoria_descalificacion || [];
              const hasDescal = codes.length > 0;
              const reasonLabel = hasDescal
                ? codes.map(c => descalMap[c] || c).join(", ")
                : "Lead calificado";
              const nameKey = a.prospect_name?.toLowerCase().trim();
              const callCount = nameKey ? (prospectCounts[nameKey] || 1) : 1;
              const parts = [a.prospect_zone, a.property_type].filter(Boolean);
              if (callCount > 1) parts.push(`${callCount} llamadas`);
              const metaLabel = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
              return (
                <Link key={a.id} href={a.id.startsWith("sample-") ? "/analisis/nueva" : `/analisis/${a.id}`} className="c4-item">
                  <div className="c4-item-left">
                    <span className="c4-item-date">
                      <EditableField analysisId={a.id} field="prospect_name" currentValue={a.prospect_name} placeholder="Sin nombre" onSave={(n) => updateName(a.id, n)} />
                      {metaLabel}
                    </span>
                    <span className="c4-item-source">
                      {time} · {hasDescal ? (
                        <>
                          <span className="c1-pill-inline c1-pill-red">{descalMap[codes[0]] || codes[0]}</span>
                          {codes.length > 1 && <span className="c1-pill-more">+{codes.length - 1}</span>}
                        </>
                      ) : (
                        <span className="c1-pill-inline c1-pill-green">Lead calificado</span>
                      )}
                    </span>
                    {a.manager_note && (
                      <span className="c1-note-badge">Tu gerente dejó un comentario</span>
                    )}
                  </div>
                  <div className="c4-item-right">
                    {a.score_general !== null && (
                      <span className={`c4-item-score c4-score-${a.clasificacion || "regular"}`}>{a.score_general}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {todayAnalyses.length === 0 && (
        <div className="c4-empty">
          <p className="c4-empty-title">Aún no tienes llamadas hoy</p>
          <Link href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center", marginTop: 12 }}>
            Hacer mi primera llamada del día
          </Link>
        </div>
      )}

      {/* Score chart */}
      {chartData.length >= 3 && (
        <div className="c1-chart-section">
          <p className="c4-list-title">Evolución de score</p>
          <div className="g2-evolution">
            {chartData.map((a) => (
              <div key={a.id} className="g2-evo-bar-wrap">
                <div className="g2-evo-bar" style={{ height: `${a.score_general || 0}%` }} />
                <span className="g2-evo-label">{a.score_general}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Yesterday */}
      {yesterdayAnalyses.length > 0 && (
        <details className="c1-yesterday">
          <summary className="c1-yesterday-summary">Ayer — {yesterdayAnalyses.length} llamada{yesterdayAnalyses.length > 1 ? "s" : ""}</summary>
          <div className="c4-list">
            {yesterdayAnalyses.slice(0, 10).map((a) => {
              const time = new Date(a.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
              const codes = a.categoria_descalificacion || [];
              const hasDescal = codes.length > 0;
              const label = [a.prospect_name, a.prospect_zone].filter(Boolean).join(" · ") || time;
              return (
                <Link key={a.id} href={a.id.startsWith("sample-") ? "/analisis/nueva" : `/analisis/${a.id}`} className="c4-item">
                  <div className="c4-item-left">
                    <span className="c4-item-date">{label}</span>
                    <span className="c4-item-source">
                      {time} · {hasDescal ? (
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
                </Link>
              );
            })}
          </div>
        </details>
      )}

      {/* CTA */}
      <Link href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center" }}>
        Nueva llamada
      </Link>

      {/* Full history link */}
      <Link href="/analisis/historial" className="c5-back-link">Ver todos mis análisis</Link>
    </div>
  );
}
