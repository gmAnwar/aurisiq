"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { requireAuth } from "../../lib/auth";
import { getOrgTimezone, todayStart, monthStart as getMonthStart, todayDisplay } from "../../lib/dates";

interface Analysis {
  id: string;
  score_general: number | null;
  clasificacion: string | null;
  created_at: string;
  fuente_lead_id: string | null;
  patron_error: string | null;
  siguiente_accion: string | null;
  categoria_descalificacion: string[] | null;
}

export default function MiDiaPage() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [leadSources, setLeadSources] = useState<Record<string, string>>({});
  const [descalMap, setDescalMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [streak, setStreak] = useState(0);
  const [tipTitle, setTipTitle] = useState<string | null>(null);
  const [tipFrase, setTipFrase] = useState<string | null>(null);
  const [monthlyTarget, setMonthlyTarget] = useState<number | null>(null);
  const [monthlyDone, setMonthlyDone] = useState(0);
  const [orgTz, setOrgTz] = useState("America/Monterrey");

  useEffect(() => {
    async function load() {
      const session = await requireAuth(["captadora", "super_admin"]);
      if (!session) return;
      setUserName(session.name);

      const [analysesRes, sourcesRes, userRes, descalRes, objRes] = await Promise.all([
        supabase.from("analyses")
          .select("id, score_general, clasificacion, created_at, fuente_lead_id, patron_error, siguiente_accion, categoria_descalificacion")
          .eq("user_id", session.userId).eq("status", "completado")
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("lead_sources").select("id, name").eq("organization_id", session.organizationId),
        supabase.from("users").select("current_streak").eq("id", session.userId).single(),
        supabase.from("descalification_categories").select("code, label").eq("organization_id", session.organizationId),
        supabase.from("objectives").select("target_value, type, period_type")
          .eq("organization_id", session.organizationId).eq("is_active", true)
          .eq("type", "volume").in("period_type", ["monthly"])
          .or(`target_user_id.eq.${session.userId},target_user_id.is.null`)
          .limit(1),
      ]);

      const all = analysesRes.data || [];
      setAnalyses(all);
      setStreak(userRes.data?.current_streak || 0);

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

      // Strip JSON artifacts from Claude output
      const stripJson = (t: string) => {
        let s = t;
        // Remove fenced code blocks (```...```)
        const tripleIdx = s.indexOf("\u0060\u0060\u0060");
        if (tripleIdx > 0) s = s.slice(0, tripleIdx);
        // Remove trailing JSON objects
        s = s.replace(/\n\s*\{\s*"[\s\S]*$/g, "");
        // Remove inline json patterns
        s = s.replace(/\s*json\s*\{[\s\S]*$/gi, "");
        return s.trim();
      };

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
        setTipTitle(topErr[0]);
        const srcAnalysis = all.find(a => a.id === topErr[1].analysisId);
        if (srcAnalysis?.siguiente_accion) {
          setTipFrase(stripJson(srcAnalysis.siguiente_accion));
        }
      }

      setLoading(false);
    }
    load();
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

  // Last 5 calls today
  const last5 = todayAnalyses.slice(0, 5);

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
        <div className="c1-activity c1-no-objective">
          <p>Tu gerente aún no ha configurado tu objetivo del mes.</p>
        </div>
      )}

      {/* Daily stats — score avg only if 2+ */}
      {todayAnalyses.length > 0 && (
        <div className="c4-stats">
          <div className="c4-stat-card">
            <span className="c4-stat-value">{todayAnalyses.length}</span>
            <span className="c4-stat-label">Llamadas hoy</span>
          </div>
          {dailyAvg !== null && (
            <div className="c4-stat-card">
              <span className="c4-stat-value">{dailyAvg}</span>
              <span className="c4-stat-label">Score promedio</span>
            </div>
          )}
        </div>
      )}

      {/* Tip del día — dark coach card */}
      {tipTitle && (
        <div className="tip-card">
          <div className="tip-lbl">Tu tip del día</div>
          <div className="tip-title">{tipTitle}</div>
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
              const primaryDescal = a.categoria_descalificacion?.[0];
              const secondaryDescal = a.categoria_descalificacion?.slice(1) || [];
              return (
                <a key={a.id} href={`/analisis/${a.id}`} className="c4-item">
                  <div className="c4-item-left">
                    <span className="c4-item-date">{time}</span>
                    {primaryDescal && (
                      <span className="c4-item-source">{descalMap[primaryDescal] || "Razón no reconocida"}</span>
                    )}
                    {secondaryDescal.length > 0 && (
                      <span className="c1-secondary-descal">
                        {secondaryDescal.map(c => descalMap[c] || "Razón no reconocida").join(", ")}
                      </span>
                    )}
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

      {todayAnalyses.length === 0 && (
        <div className="c4-empty">
          <p>Aún no tienes llamadas hoy.</p>
          <p>Analiza tu primera llamada del día.</p>
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

      {/* CTA */}
      <a href="/analisis/nueva" className="btn-submit btn-terracota" style={{ textDecoration: "none", textAlign: "center" }}>
        Grabar llamada
      </a>

      {/* Full history link */}
      <a href="/semana" className="c5-back-link">Ver mi semana</a>
    </div>
  );
}
